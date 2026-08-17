/**
 * Core /sm handler — the executable surface that the cordis node half mounts
 * (src/index.ts) and that the acceptance bridge tests drive. This factory
 * reproduces, match-for-match, the contract image in tests/acceptance/helpers.js
 * (same per-endpoint判定顺序, same idempotency truth values, same error codes,
 * same HTTP/JSON shape).
 *
 * Wire note (important): the /sm surface here is a RAW HTTP route — it returns
 * `{ ok: true, … }` directly and accepts a RAW body `{ id, cwd, title }`. That
 * is exactly what the locked acceptance suite asserts and what the browser
 * client half speaks. The official `connection.rpc.handle` envelope
 * (`{ type, rpcId, method, payload }` → `{ type, rpcId, result }`) is NOT the
 * /sm contract, so this plugin mounts its own raw prefix route and applies the
 * same loopback trust fence (src/trust-fence.ts). See the final report for the
 * plan-interface conflict this resolves.
 */

import fs from 'node:fs'
import path from 'node:path'
import { TrashStore, SESSION_MARKERS, hasSessionMarker } from './trash.js'
import { MAX_TITLE_LEN, WORKSPACE_DOMAIN } from './constants.js'
import {
  assertValidId,
  isStableSegment,
  lookupProjectDir,
  isInsideOrEqual,
  sessionSegment,
  type ProjectLookup,
} from './paths.js'

export interface ArchiveDomain {
  /**
   * `set` returns `Promise<void>` in the real runtime (dsh-storage-domain
   * `types/domain.d.ts`): the durable write is queued and the domain's in-memory
   * value is replaced only AFTER it lands. It MUST be awaited (F1) — an
   * un-awaited rejection reaches DSH's process-level `unhandledRejection`
   * handler, which exits the whole `dsh web` host. A backend whose `set` is
   * synchronous (in-memory stubs) is still supported: nothing is awaited then.
   */
  global: { get(): unknown; set(value: unknown): unknown }
}

export interface SmHandlerDeps {
  /** Absolute path of the sessions root (`~/.dsh/sessions`). */
  sessionsRoot: string
  /** The recycle-bin store (its root must be OUTSIDE sessionsRoot). */
  trash: TrashStore
  /**
   * Optional Node SessionStore (`ctx.sessions`). Its ONLY use is the
   * HOST-AUTHORITATIVE source of the session's cwd — `session.header.cwd`
   * (dsh-session's immutable SessionHeader) is the absolute working directory
   * the session was created with, which we prefer over the client-supplied
   * `cwd`. A freshly-created (just-messaged) session's client snapshot can
   * carry an absent/empty `byId.cwd`, but the live header never does.
   *
   * We deliberately do NOT use the live store to gate deletion on "running".
   * A live SessionStore entry means "the session has been opened/loaded", which
   * stays true long after the agent has finished — it is NOT the same as "the
   * AI is currently running a turn". That judgment lives on the client
   * (`byId.running` = the agent's `status === 'running'`), where it is precise;
   * the host simply deletes whatever the client asked to delete (the recycle-bin
   * move is recoverable, so a mid-turn session deleted by an API caller that
   * bypasses the client is a recoverable, accepted risk — see the delete guard
   * comment in doDelete).
   *
   * When absent (headless profiles without a session service), cwd resolution
   * simply falls back to the client-supplied `cwd`.
   */
  sessions?: { get(id: string): { header?: { cwd?: string } } | null | undefined }
  /**
   * Optional storage-domain facility: `get(WORKSPACE_DOMAIN)` returns the live,
   * already-open workspace DomainImpl. When the facility itself is absent the
   * write path degrades: unarchive → workspace-domain-unavailable, delete
   * step-2 → system-error (partial failure, retryable). Absent storageDomain
   * never crashes or hangs the plugin.
   */
  storageDomain?: { get(name: string): ArchiveDomain | null | undefined }
  /**
   * Read the current workspace global object `{initialized, workspaceIds,
   * archivedSessionIds}`. Returns `undefined` when the read FAILED (the
   * storage domain threw) — a sentinel that must NOT be conflated with an
   * empty global: callers map it to a retryable system-error instead of
   * continuing to write (I-1: a failed read must never be treated as "no
   * archive set", and must never be spread into the write payload, which
   * would clobber workspaceIds/initialized).
   */
  readWorkspaceGlobal(): Record<string, unknown> | undefined
  /**
   * Optional project-dir override for a cwd label. When absent (production),
   * the handler resolves `join(sessionsRoot, cwd)`. When present and returns a
   * directory, that directory is used and the same path-out-of-bounds gate
   * applies — used in tests to exercise the "cwd resolves outside sessions
   * root" rejection (the harness's projectCwdMap). Returning undefined falls
   * back to the default resolution.
   */
  projectDirOverride?: (cwd: string) => string | undefined
  /** Optional logger for the partial-failure / boundary paths. */
  log?: { warn(msg: string): void }
}

export interface SmResponse {
  status: number
  json: Record<string, unknown>
}

function ok(): SmResponse {
  return { status: 200, json: { ok: true } }
}

function fail(code: string, message: string, extra?: Record<string, unknown>): SmResponse {
  return { status: 200, json: { ok: false, code, message, ...extra } }
}

function bad(code: string, message: string): SmResponse {
  return { status: 400, json: { ok: false, code, message } }
}

function bodyIsObject(body: unknown): body is Record<string, unknown> {
  return typeof body === 'object' && body !== null && !Array.isArray(body)
}

/** A value that must be awaited (the real `domain.global.set` return). */
function isThenable(v: unknown): v is Promise<unknown> {
  return typeof (v as { then?: unknown } | null | undefined)?.then === 'function'
}

/**
 * Resolve the project dir for a delete, honoring an optional test override.
 * The override + the shared lookup cover the harness's projectCwdMap semantics.
 */
function resolveLookup(deps: SmHandlerDeps, cwd: unknown): ProjectLookup {
  const base = lookupProjectDir(deps.sessionsRoot, cwd)
  if (base.kind !== 'dir') return base
  if (typeof cwd === 'string' && deps.projectDirOverride) {
    const mapped = deps.projectDirOverride(cwd)
    if (mapped !== undefined) return { kind: 'dir', projectDir: mapped }
  }
  return base
}

/**
 * Create the /sm handler. `handle(method, req, body)` returns the HTTP status
 * + JSON to send for one request. The loopback trust fence is applied by the
 * route owner (src/index.ts); this function operates on already-trusted input.
 *
 * Await-able result (F1): the archive-set write goes through the storage domain,
 * whose real `set()` is asynchronous, so the endpoints that write it resolve
 * only after the write LANDS. `handle` therefore returns
 * `SmResponse | Promise<SmResponse>` and every caller must `await` it (awaiting
 * a plain object is a no-op, so a synchronous backend stays synchronous).
 */
export function createSmHandler(deps: SmHandlerDeps): {
  handle(method: string | null | undefined, req: unknown, body: unknown): SmResponse | Promise<SmResponse>
} {
  const log = deps.log ?? { warn: () => {} }

  /**
   * The archive read-modify-write chain (H2). `readWorkspaceGlobal` reads the
   * domain's IN-MEMORY value, which the domain replaces only after its durable
   * write lands — so two overlapping requests would both read the pre-write
   * snapshot and the first one's change would be silently reverted (lost
   * update). Non-null while a write is in flight: the next read-modify-write
   * then waits for it instead of reading a stale snapshot.
   *
   * ponytail: one chain for the single workspace global is enough — per-key
   * locks only matter if this ever writes more than one domain object.
   */
  let archiveWriteInFlight: Promise<SmResponse> | null = null

  /** Run a read-modify-write of the archive set, serialized behind any in-flight write. */
  function withArchiveChain(run: () => SmResponse | Promise<SmResponse>): SmResponse | Promise<SmResponse> {
    const inFlight = archiveWriteInFlight
    if (inFlight === null) return run()
    // inFlight never rejects (both handlers are attached in commitArchive), but
    // pass `run` as the rejection handler too so a future change cannot stall
    // the queue.
    return inFlight.then(run, run)
  }

  /**
   * Write the archive payload and map the outcome to a response. Awaits the
   * write when the backend returned a thenable (real runtime) — which is also
   * what attaches the rejection handler that keeps a failed write from killing
   * the host process (F1).
   */
  function commitArchive(
    domain: ArchiveDomain,
    payload: Record<string, unknown>,
    onFail: (err: unknown) => SmResponse,
  ): SmResponse | Promise<SmResponse> {
    let result: unknown
    try {
      result = domain.global.set(payload)
    } catch (err) {
      return onFail(err)
    }
    if (!isThenable(result)) return ok()
    const responded = result.then(() => ok(), onFail)
    archiveWriteInFlight = responded
    // Release the queue once this write settles, so a later request can again
    // take the synchronous fast path.
    void responded.then(() => {
      if (archiveWriteInFlight === responded) archiveWriteInFlight = null
    })
    return responded
  }

  // ---- /sm/delete ----
  function doDelete(_req: unknown, body: unknown): SmResponse | Promise<SmResponse> {
    if (!bodyIsObject(body)) return bad('bad-request', 'body must be an object')

    const { id, cwd, title, force } = body as { id?: unknown; cwd?: unknown; title?: unknown; force?: unknown }

    // 400-level input validation (INTERFACE §3.1).
    if (!assertValidId(id)) return bad('invalid-id', 'invalid id')
    if (cwd !== undefined && cwd !== null && typeof cwd !== 'string') {
      return bad('invalid-cwd', 'invalid cwd')
    }
    if (title !== undefined && title !== null) {
      if (typeof title !== 'string' || title.length > MAX_TITLE_LEN) {
        return bad('invalid-title', 'invalid title')
      }
    }
    // `force` must be a boolean when provided (otherwise the request is malformed).
    // It is now a COMPATIBILITY no-op: the running-in-progress judgment moved to
    // the client (`byId.running`), so the host no longer uses force to gate
    // deletion. We still validate the type so a malformed caller is refused
    // (contract-stable), but a well-typed `force` has no effect on the outcome.
    if (force !== undefined && typeof force !== 'boolean') {
      return bad('invalid-force', 'invalid force')
    }

    // Host-authoritative cwd. Read the live Session (once) from the injected
    // store for PROJECT-DIR RESOLUTION ONLY — never as a "running" gate (a live
    // entry means "opened/loaded", which outlives the agent's actual turn). A
    // live session's `header.cwd` is the absolute cwd it was created with
    // (dsh-session SessionHeader), more trustworthy than the client `cwd` — a
    // just-created session's client snapshot may carry an absent/empty
    // byId.cwd. When the session is not in the store (old session) or its header
    // lacks cwd, we fall back to the client `cwd`.
    const liveSession = deps.sessions?.get(id as string)
    const liveCwd =
      liveSession &&
      typeof (liveSession as { header?: { cwd?: unknown } }).header?.cwd === 'string' &&
      (liveSession as { header: { cwd: string } }).header.cwd.length > 0
        ? (liveSession as { header: { cwd: string } }).header.cwd
        : undefined
    const effectiveCwd: unknown = liveCwd ?? cwd

    // Locate the project dir from the effective cwd (honoring an optional test
    // override map; bounds still apply after).
    const proj = resolveLookup(deps, effectiveCwd)
    if (proj.kind === 'invalid') return bad('invalid-cwd', 'invalid cwd')
    if (proj.kind === 'not-found') return fail('session-dir-not-found', 'project dir not found')

    // Boundary gates (200-level). An id that is not a stable literal segment,
    // or a target resolving outside the sessions root, is refused with NO
    // move.
    if (!isStableSegment(id as string)) {
      return fail('path-out-of-bounds', 'id escapes segment encoding')
    }
    const targetDir = sessionSegment(proj.projectDir, id as string)
    if (!isInsideOrEqual(deps.sessionsRoot, targetDir)) {
      return fail('path-out-of-bounds', 'target outside sessions root')
    }

    // NOTE (running-session risk): we deliberately do NOT refuse deletion when
    // `deps.sessions.get(id)` returns a live Session. A live entry means the
    // session was opened/loaded — it stays live long after the agent finished,
    // so it cannot distinguish "AI is replying" from "idle". The
    // running-in-progress judgment lives on the client (`byId.running` =
    // `agent.status === 'running'`, see the client half), which prompts before
    // deleting a genuinely running session. If a caller bypasses the client and
    // hits /sm/delete directly on a session whose agent is mid-turn, the
    // directory moves to the recycle bin (recoverable) while the agent may still
    // write to it. That is an accepted, recoverable risk: the recycle-bin move
    // never destroys the on-disk content, and a mid-turn delete already requires
    // the client's explicit confirmation.

    // Source missing. Three cases:
    //  - already in the trash          → idempotent-complete, run archive step-2
    //  - live but not persisted        → the session exists only in the in-memory
    //    Session object (its dir was never flushed to `~/.dsh/sessions`). There
    //    is no on-disk artifact to move, and its events are ephemeral (gone on
    //    restart). Treat the delete as effective: return ok so the client hides
    //    it. We deliberately do NOT try to detach/dispose the live SessionStore
    //    entry — dsh-session exposes no public remove-by-id API (detach is bound
    //    to the creating fiber's own effect), and the store entry drains on
    //    process restart anyway. A live-but-not-persisted session that is
    //    genuinely mid-turn has the same recoverable risk as the persisted case
    //    above; the client's `byId.running` confirm is the gate.
    //  - neither live nor persisted     → a genuine not-found (unchanged).
    if (!fs.existsSync(targetDir)) {
      if (deps.trash.hasItem(id as string)) return doArchivedCleanup(id as string)
      if (liveSession) return doArchivedCleanup(id as string)
      return fail('session-dir-not-found', 'session dir not found')
    }

    // The dir exists — INTERFACE §3.1 step 3 requires a session marker INSIDE
    // it before anything is moved. Both the compressed (session.jsonl.zstd) and
    // the plaintext (session.jsonl, `compression:'none'` deployments) names
    // count (M3). A same-named non-session directory must never be pulled into
    // the trash (S-3): refuse with a distinct code so the client keeps the row
    // and nothing is ever bulk-moved by a title/id collision.
    if (!hasSessionMarker(targetDir)) {
      return fail('not-a-session', `target dir is not a session (no ${SESSION_MARKERS.join(' / ')})`)
    }

    // Move the whole directory into the trash.
    try {
      deps.trash.moveToTrash(targetDir, {
        id: id as string,
        originalDir: targetDir,
        title: typeof title === 'string' ? title : null,
        projectKey: path.basename(proj.projectDir),
      })
    } catch (err) {
      return fail('system-error', String(err))
    }

    return doArchivedCleanup(id as string)
  }

  // Delete-step-2 for archived sessions: drop the id from the archive set.
  // The workspace global is read ONCE (I-1): both the "is archived" judgment
  // and the write payload derive from the same snapshot, so a second read can
  // never return a stale/failed `{}` that would clobber workspaceIds/initialized.
  //
  // Partial failure (I-3): every failure branch below carries `moved: true` —
  // doArchivedCleanup is only ever reached when the delete step-1 is effective
  // (dir moved / already in trash / live-but-not-persisted), so the response
  // must be distinguishable from a pure move failure (plain `system-error`,
  // nothing happened). The client branches on `moved` to keep the row hidden
  // and offer a "cleanup pending, retry" recovery instead of restoring a
  // session whose dir is already gone (INTERFACE §2.4).
  function doArchivedCleanup(id: string): SmResponse | Promise<SmResponse> {
    return withArchiveChain(() => {
      const global = deps.readWorkspaceGlobal()
      // A failed read is NOT the same as "not archived" — surface it as a
      // retryable partial failure instead of silently skipping the cleanup (the
      // old `catch { return {} }` turned read failure into a permanent ghost
      // row with no recovery signal).
      if (global === undefined) {
        log.warn(`archive cleanup for ${id}: workspace global unreadable; retry to complete`)
        return fail('system-error', 'archive state unreadable; file already moved, retry to complete', { moved: true })
      }
      const archived = archiveFromGlobal(global)
      if (!archived.includes(id)) return ok()

      const domain = deps.storageDomain?.get(WORKSPACE_DOMAIN)
      if (domain === null || domain === undefined) {
        log.warn(`archive cleanup for ${id}: workspace domain unavailable after file moved; retry to complete`)
        return fail('system-error', 'archive cleanup failed; file already moved, retry to complete', { moved: true })
      }
      return commitArchive(domain, { ...global, archivedSessionIds: archived.filter((x) => x !== id) }, (err) => {
        log.warn(`archive cleanup for ${id} failed: ${String(err)}`)
        return fail('system-error', String(err), { moved: true })
      })
    })
  }

  // ---- /sm/restore ----
  function doRestore(_req: unknown, body: unknown): SmResponse {
    if (!bodyIsObject(body)) return bad('bad-request', 'body must be an object')
    const { id } = body as { id?: unknown }
    if (!assertValidId(id)) return bad('invalid-id', 'invalid id')

    const rec = deps.trash.readRecord(id as string)
    // Judgment order per INTERFACE §3.2: no record → not-in-trash; record
    // present but original dir occupied → restore-target-exists (refuse, never
    // overwrite); otherwise move it back.
    if (rec === null) return fail('not-in-trash', 'no such trash entry')
    if (fs.existsSync(rec.originalDir)) {
      return fail('restore-target-exists', 'original dir occupied; refusing to overwrite')
    }
    if (!deps.trash.hasItem(rec.id)) {
      return fail('system-error', 'trash entry dir missing')
    }
    try {
      deps.trash.restoreItem(rec)
      return ok()
    } catch (err) {
      return fail('system-error', String(err))
    }
  }

  // ---- /sm/emptyTrash ----
  function doEmptyTrash(_req: unknown, body: unknown): SmResponse {
    if (!bodyIsObject(body) || body.confirm !== true) {
      return bad('confirmation-required', 'confirm:true required')
    }
    try {
      const failed = deps.trash.empty()
      if (failed.length > 0) {
        log.warn(`emptyTrash partial failure on: ${failed.join(', ')}`)
        return fail('system-error', `could not remove: ${failed.join(', ')}`)
      }
      return ok()
    } catch (err) {
      return fail('system-error', String(err))
    }
  }

  // ---- /sm/unarchive ----
  function doUnarchive(_req: unknown, body: unknown): SmResponse | Promise<SmResponse> {
    if (!bodyIsObject(body)) return bad('bad-request', 'body must be an object')
    const { id } = body as { id?: unknown }
    if (!assertValidId(id)) return bad('invalid-id', 'invalid id')

    return withArchiveChain(() => {
      // Domain availability is checked FIRST, before reading the set. An absent
      // storageDomain read via ?. yields undefined, so the degradation is the
      // same "workspace-domain-unavailable" as when get(WORKSPACE_DOMAIN) returns null.
      const domain = deps.storageDomain?.get(WORKSPACE_DOMAIN)
      if (domain === null || domain === undefined) {
        return fail('workspace-domain-unavailable', 'workspace storage domain unavailable')
      }
      // Single read (I-1): derive "is archived" and the write payload from the
      // same snapshot. A read failure (undefined) is a retryable system-error —
      // never treated as an empty global (which would clobber the other fields
      // on write). H2: the read happens INSIDE the chain, so a queued unarchive
      // sees the previous write's result instead of the pre-write snapshot.
      const global = deps.readWorkspaceGlobal()
      if (global === undefined) {
        return fail('system-error', 'workspace global unreadable; retry')
      }
      const archived = archiveFromGlobal(global)
      if (!archived.includes(id as string)) return ok() // idempotent no-op

      return commitArchive(domain, { ...global, archivedSessionIds: archived.filter((x) => x !== id) }, (err) =>
        fail('system-error', String(err)),
      )
    })
  }

  // ---- /sm/trash ----
  function doTrash(): SmResponse {
    return {
      status: 200,
      json: {
        ok: true,
        items: deps.trash.records().map((r) => ({
          id: r.id,
          title: r.title ?? undefined,
          deadline: r.deletedAt,
        })),
      },
    }
  }

  return {
    handle(method, _req, body): SmResponse | Promise<SmResponse> {
      switch (method) {
        case 'delete':
          return doDelete(_req, body)
        case 'restore':
          return doRestore(_req, body)
        case 'emptyTrash':
          return doEmptyTrash(_req, body)
        case 'unarchive':
          return doUnarchive(_req, body)
        case 'trash':
          return doTrash()
        default:
          return { status: 404, json: { ok: false, error: 'not found' } }
      }
    },
  }
}

/**
 * Data helpers for the workspace archive domain, so src/index.ts can wire a
 * production storage-domain facility into the handler without re-deriving the
 * field names.
 */
export function archiveFromGlobal(global: Record<string, unknown> | null | undefined): string[] {
  if (!global || typeof global !== 'object') return []
  const a = (global as Record<string, unknown>).archivedSessionIds
  return Array.isArray(a) ? (a as string[]) : []
}
