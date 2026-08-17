/**
 * ensureTurnLoaded — the single-flight unloaded-turn load loop.
 *
 * Clicking an unloaded rail line starts a loop that pages older history
 * (`session.loadOlder()`) until the target turn appears in the snapshot or a
 * hard stop is reached. All loop logic lives here (可单测): TurnRail only
 * calls `ensureTurnLoaded` and scrolls by the result.
 *
 * Single-flight: at most ONE loop runs at a time. A second request either
 * joins the running loop (same session + token + turnId) or replaces it
 * (different target); replaced/cancelled loops resolve with `'会话切换'` and
 * never write to the new target's window.
 *
 * Termination (INTERFACE §2.4):
 *   1. target turn key appears in `snapshot.chat.locations.turns` → '达成';
 *   2. `hasMore === false` (host authority) → '到最老';
 *   3. `loadOlder` executed `MAX_LOAD_PAGES` times → '超限';
 *   4. `openState !== 'open'` → '到最老' (cannot load older);
 *   5. token no longer current (session switched / cancelled) → '会话切换'.
 *
 * Note on 重要 4: at the snapshot API level a host-authoritative `hasMore:
 * false` and the client's discontinuity fallback are the same boolean, so
 * `'到最老'` covers both and a desensitized warning is always logged when the
 * loop stops without reaching the target — never treated as a success.
 */
import type { ChatSnapshot, EnsureLoadedResult, SessionFace } from './context-types.ts'

/** Page cap for one load loop (INTERFACE §4). */
export const MAX_LOAD_PAGES = 40

export interface EnsureTurnLoadedArgs {
  session: SessionFace
  /** 1-based turn number to reach (line index i ↔ turnId i+1). */
  turnId: number
  /** Opaque session token minted per bound session; invalidates the loop. */
  token: unknown
}

interface ActiveLoop {
  session: SessionFace
  token: unknown
  turnId: number
  page: number
  resolve: (result: EnsureLoadedResult) => void
  settle: (result: EnsureLoadedResult) => void
  done: boolean
}

let active: ActiveLoop | null = null

function targetInSnapshot(chat: ChatSnapshot | undefined, turnId: number): boolean {
  const keys = chat?.locations?.turns?.get(turnId)
  return keys !== undefined && keys.length > 0
}

function fail(loop: ActiveLoop, result: EnsureLoadedResult): void {
  if (loop.done) return
  loop.done = true
  if (active === loop) active = null
  loop.settle(result)
}

/** Run one loop; never more than one at a time (single-flight). */
async function runLoop(loop: ActiveLoop): Promise<void> {
  while (active === loop && !loop.done) {
    const snap = loop.session.snapshotCache

    // 1. Target reached.
    if (targetInSnapshot(snap.chat, loop.turnId)) {
      fail(loop, '达成')
      return
    }
    // 4. Session not open — nothing more can be loaded.
    if (snap.openState !== undefined && snap.openState !== 'open') {
      console.warn('[dsh-turn-scrubber] loadOlder skipped: session not open')
      fail(loop, '到最老')
      return
    }
    // A page is already in flight (a replaced/cancelled loop's loadOlder has
    // not landed yet). loadOlder() no-ops while loadingOlder, so spinning would
    // burn the page budget and falsely hit the cap — instead yield one tick and
    // re-read the fresh snapshot once the in-flight page commits (single-flight
    // guarantee: only ONE loadOlder write is ever in progress at a time).
    if (snap.loadingOlder === true) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
      continue
    }
    // 2. Host says there is no older history. (Client fallback false is the
    //    same boolean at this API level; the warning above covers both.)
    if (snap.hasMore === false) {
      console.warn('[dsh-turn-scrubber] unloaded turn not reachable: hasMore=false')
      fail(loop, '到最老')
      return
    }
    // 3. Page cap.
    if (loop.page >= MAX_LOAD_PAGES) {
      console.warn(`[dsh-turn-scrubber] load loop stopped after ${MAX_LOAD_PAGES} pages`)
      fail(loop, '超限')
      return
    }

    // loadOlder() itself no-ops while loadingOlder / closed / !hasMore, so a
    // busy store is re-checked on the next iteration instead of racing.
    await loop.session.loadOlder()
    loop.page++
    if (active !== loop || loop.done) {
      // Replaced or cancelled while the page was in flight — the response
      // must not be written to the new session's window; loadOlder already
      // bound to the old session store, nothing else to clean up here.
      fail(loop, '会话切换')
      return
    }
  }
  // Loop was replaced/cancelled externally (active switched) without our
  // settle — report the switch to the waiter.
  if (!loop.done) fail(loop, '会话切换')
}

/**
 * Ensure the target turn is present in the loaded snapshot, paging older
 * history as needed (single-flight, see module doc).
 * @returns the load-loop outcome; on '达成' the caller may scroll to the
 *          turn key now present in `snapshot.chat.locations.turns`.
 */
export function ensureTurnLoaded({ session, turnId, token }: EnsureTurnLoadedArgs): Promise<EnsureLoadedResult> {
  // Fast path: already loaded.
  if (targetInSnapshot(session.snapshotCache.chat, turnId)) return Promise.resolve('已加载')

  // Join a running loop for the exact same request.
  if (active !== null && active.session === session && active.token === token && active.turnId === turnId && !active.done) {
    return new Promise<EnsureLoadedResult>((resolve) => {
      const original = active!.settle
      active!.settle = (result) => {
        original(result)
        resolve(result)
      }
    })
  }

  // Replace any previous loop (different target / session / token).
  if (active !== null) fail(active, '会话切换')

  return new Promise<EnsureLoadedResult>((resolve) => {
    const loop: ActiveLoop = {
      session,
      token,
      turnId,
      page: 0,
      resolve,
      settle: resolve,
      done: false,
    }
    active = loop
    // Fire-and-forget: the loop settles the promise on every exit path.
    void runLoop(loop)
  })
}

/**
 * Terminate any active load loop for a given session (session switch /
 * teardown). The loop resolves its waiter with `'会话切换'`; subsequent
 * responses are discarded by the loop's own active-check.
 */
export function cancelTurnLoads(session: SessionFace): void {
  if (active !== null && active.session === session) fail(active, '会话切换')
}

/** Terminate whatever loop is active (plugin dispose). */
export function cancelAllTurnLoads(): void {
  if (active !== null) fail(active, '会话切换')
}

/** Test/query hook: whether a load loop is currently running. */
export function isTurnLoadActive(): boolean {
  return active !== null && !active.done
}