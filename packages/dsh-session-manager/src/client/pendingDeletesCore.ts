/**
 * pendingDeletesCore — the pure, dependency-injected deferred-deletion state
 * machine (no browser globals, no bridge import). Kept in its own module so a
 * node unit test can import the compiled `lib/pendingDeletesCore.js` and drive
 * the queue/timers with a fake clock, exactly like the node-half unit tests
 * import `lib/handler.js`.
 *
 * Design (PLAN §5.5, re-based onto the pinned INTERFACE contract): deleting a
 * session does NOT fire `/sm/delete` immediately. Instead the session row is
 * hidden locally and an entry is parked here with a 10s deadline. While the
 * window is open the entry is `pending` and undoable; when the deadline passes
 * `fire()` invokes the injected host caller and the session is really moved to
 * the recycle bin.
 *
 * Why module scope: the countdown must survive React unmounts and sidebar view
 * switches (INTERFACE §1.2 step 3). The timers live in the module that owns a
 * `PendingDeletes` instance, never in a component, so switching panels does not
 * reset or drop the countdown.
 *
 * Contract note (deviation from a PLAN §5.5 suggestion, resolved toward the
 * locked INTERFACE §0/§1.4): PLAN suggested a `beforeunload` flush that fires
 * pending deletes on page exit. That directly contradicts the pinned behavior
 * "刷新清空 client pending，该会话未被实际删除，仍在列表（数据安全）" —
 * beforeunload also fires on refresh. The recycle bin move only EVER happens at
 * the deadline, inside this module; a page refresh simply drops the in-memory
 * queue and the host has not yet moved the file, so the session survives.
 *
 * Idempotency: `requestDelete` is a no-op when the id is already parked;
 * `fire` re-checks presence before executing. Multi-session parallel parking
 * is a natural Map property — one entry + one timer per id.
 */

/** The countdown window before a deletion becomes permanent (ms). P8: 10s → 5s. */
export const UNDO_WINDOW_MS = 5_000

/** How long a failed-fire entry stays visible in the rail (ms). */
export const FAILED_RETAIN_MS = 6_000

/** Lifecycle of one parked deletion. */
export type PendingState = 'pending' | 'failed'

export interface PendingEntry {
  id: string
  /** cwd label used to locate the session dir on the host. */
  cwd: string
  /** Display title shown in the rail to disambiguate multiple entries. */
  title: string
  /** Epoch ms at which the pending window expires (rail counts down to it). */
  deadline: number
  state: PendingState
  /** Set only for a `failed` entry: the host error code/message. */
  error?: string
}

/** Outcome of a fire() call, as returned to the state machine. */
export interface FireOutcome {
  ok: boolean
  code?: string
}

/** Injectable seams so unit tests run with a fake timer and a stubbed host. */
export interface PendingDeleteDeps {
  /** Actually send the delete; resolved once per fired entry. */
  fire: (entry: Pick<PendingEntry, 'id' | 'cwd' | 'title'>) => FireOutcome | Promise<FireOutcome>
  /** Wall-clock source (defaults to Date.now). */
  now?: () => number
  /** Schedule a callback after a delay; returns a cancel function. */
  schedule?: (cb: () => void, delay: number) => () => void
  /** Called after any state change so UI subscribers re-read the table. */
  onChange?: () => void
  /**
   * Persistent store for the set of session ids whose deletion has CONFIRMED
   * (fire returned ok). Exactly the ids that must keep their UI rows hidden
   * across mounts/refreshes even though the client's `sessions.list` still
   * carries them (host only re-scans its disk on a later refresh). Browser
   * wiring uses localStorage; tests inject an in-memory adapter.
   */
  storage?: { load(): string[]; save(ids: string[]): void }
}

export interface PendingDeletes {
  /**
   * Park a deletion. Multi-entry allowed (P9): each id rides its own window and
   * its own undo button. Returns `true` when a new entry is parked, and `false`
   * when the SAME id is already parked (idempotent no-op — no double window).
   */
  requestDelete(id: string, cwd: string, title: string): boolean
  /**
   * Cancel a still-waiting deletion (before its deadline). Only pending
   * entries are undoable; a fired/failing/dead entry returns false.
   */
  undo(id: string): boolean
  /** Subscribe to state changes. Returns an unsubscribe function. */
  subscribe(listener: () => void): () => void
  /** Current park table, oldest-window-first (stable insert order). */
  snapshot(): PendingEntry[]
  /** Read one entry (for DOM visibility reconciliation). */
  get(id: string): PendingEntry | undefined
  /** Whether an id currently has a live pending (undoable) entry. */
  isPending(id: string): boolean
  /** Whether a deletion for id has CONFIRMED on the host (keeps its row hidden). */
  isDeleted(id: string): boolean
  /** Fire the parked entry immediately (test/edge hook, bypasses the countdown). */
  fireNow(id: string): Promise<FireOutcome | undefined>
}

export function createPendingDeletes(deps: PendingDeleteDeps): PendingDeletes {
  const now = deps.now ?? (() => Date.now())
  const schedule = deps.schedule ?? ((cb, delay) => {
    const t = setTimeout(cb, delay)
    return () => clearTimeout(t)
  })
  const onChange = deps.onChange ?? (() => {})

  const map = new Map<string, PendingEntry>()
  /** One active timer per entry (allows parallel per-id windows). */
  const timers = new Map<string, () => void>()
  const listeners = new Set<() => void>()
  /**
   * Stable snapshot cache. `snapshot()` must return the SAME array reference
   * while the map is unchanged: a fresh array each call makes useSyncExternalStore
   * believe the store changed every render → React error #185 (Maximum update
   * depth exceeded) → the overlay root that reads it crashes on mount. We
   * rebuild the array once per mutation and return the cached reference until
   * the next mutation.
   */
  let cached: PendingEntry[] | null = null

  const invalidateCache = (): void => {
    cached = null
  }

  // Confirmed-deleted session ids: a fire that returned ok must keep its UI row
  // hidden even after the pending entry is gone AND across refreshes (the host
  // moves the directory; the client list still shows the id until a re-pull).
  const storage = deps.storage
  const deletedIds = new Set<string>(storage?.load() ?? [])
  const persistDeleted = (): void => {
    // Fire-and-forget: the store is best-effort (browser localStorage). Never
    // throw into the fire path over a storage error.
    try {
      storage?.save(Array.from(deletedIds))
    } catch {
      /* non-fatal */
    }
  }

  const notify = (): void => {
    onChange()
    for (const l of listeners) l()
  }

  /** Remove an entry and its timer. Returns the removed entry. */
  const drop = (id: string): PendingEntry | undefined => {
    const entry = map.get(id)
    timers.get(id)?.()
    timers.delete(id)
    map.delete(id)
    invalidateCache()
    return entry
  }

  const park = (entry: PendingEntry): void => {
    map.set(entry.id, entry)
    invalidateCache()
    const cancel = schedule(() => {
      // Best-effort: remove the timer record, then fire if still live.
      timers.delete(entry.id)
      void fire(entry.id)
    }, Math.max(0, entry.deadline - now()))
    timers.set(entry.id, cancel)
  }

  /** Fire one entry: move it past its window by invoking the host. */
  async function fire(id: string): Promise<FireOutcome | undefined> {
    // Idempotency + undo race guard: only a currently-parked entry fires.
    if (!map.has(id)) return undefined
    const entry = map.get(id)!
    if (entry.state === 'failed') return undefined
    // The window is over: drop the undoable entry before awaiting the host so
    // an in-flight fire cannot be undone mid-request.
    drop(id)
    let outcome: FireOutcome
    try {
      outcome = await deps.fire({ id: entry.id, cwd: entry.cwd, title: entry.title })
    } catch (err) {
      outcome = { ok: false, code: String(err) }
    }
    if (!outcome.ok) {
      // Real/failed delete (system-error, session-running, http-error): keep
      // the entry visible as a failure so the UI can re-show the session and
      // surface the reason. Auto-clear after a short retain window.
      const failed: PendingEntry = {
        id: entry.id,
        cwd: entry.cwd,
        title: entry.title,
        deadline: entry.deadline,
        state: 'failed',
        error: outcome.code,
      }
      map.set(failed.id, failed)
      invalidateCache() // direct map mutation must also drop the snapshot cache
      const cancel = schedule(() => {
        if (map.get(failed.id)?.state === 'failed') {
          drop(failed.id)
          notify()
        }
      }, FAILED_RETAIN_MS)
      timers.set(failed.id, cancel)
      notify()
    } else {
      // SUCCESS: the host confirmed the delete (directory moved to the
      // recycle bin). Record the id as DELETED so its UI row stays hidden even
      // though the client list still carries it (client source persists until a
      // later re-pull). Persist so a refresh keeps the row hidden.
      deletedIds.add(entry.id)
      persistDeleted()
      notify()
    }
    return outcome
  }

  /** Immediately fire whatever is parked for id (test/edge hook). */
  async function fireNow(id: string): Promise<FireOutcome | undefined> {
    if (!map.has(id)) return undefined
    return fire(id)
  }

  return {
    requestDelete(id, cwd, title) {
      // Same id already parked -> reject (idempotent no-op; multi-entry, P9).
      if (map.has(id)) return false
      park({ id, cwd, title, deadline: now() + UNDO_WINDOW_MS, state: 'pending' })
      notify()
      return true
    },
    undo(id) {
      const entry = map.get(id)
      if (!entry || entry.state !== 'pending') return false
      drop(id)
      // Defensive: a restored session must not stay flagged as deleted. In
      // practice an id only lands in deletedIds AFTER a successful fire (which
      // made it un-undoable), so this is a safety net, not the normal path.
      if (deletedIds.delete(id)) persistDeleted()
      notify()
      return true
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    // Cached: returns the SAME array reference until the map changes, so
    // useSyncExternalStore getSnapshot is stable between mutations (no #185).
    snapshot: () => {
      if (cached === null) cached = Array.from(map.values())
      return cached
    },
    get: (id) => map.get(id),
    isPending: (id) => map.get(id)?.state === 'pending',
    isDeleted: (id) => deletedIds.has(id),
    fireNow,
  }
}

/** In-memory storage adapter (tests, and a no-op fallback for non-web runs). */
export function memoryStorage(initial: string[] = []): NonNullable<PendingDeleteDeps['storage']> {
  let ids = [...initial]
  return {
    load: () => ids,
    save: (next) => {
      ids = [...next]
    },
  }
}
