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
import { TrashStore } from './trash.js'
import {
  assertValidId,
  isStableSegment,
  lookupProjectDir,
  isInsideOrEqual,
  sessionSegment,
  type ProjectLookup,
} from './paths.js'

export interface ArchiveDomain {
  global: { get(): unknown; set(value: unknown): unknown }
}

export interface SmHandlerDeps {
  /** Absolute path of the sessions root (`~/.dsh/sessions`). */
  sessionsRoot: string
  /** The recycle-bin store (its root must be OUTSIDE sessionsRoot). */
  trash: TrashStore
  /**
   * Optional Node SessionStore: truthy when the id is currently running /
   * live. When absent (headless profiles without a session service), the
   * running-session guard is skipped and delete proceeds — the guard is a
   * safety enhancement, not a functional requirement (INTERFACE §4), so we
   * degrade to "run without it" rather than refuse to delete.
   */
  sessions?: { get(id: string): unknown | null | undefined }
  /**
   * Optional storage-domain facility: `get('workspace')` returns the live,
   * already-open workspace DomainImpl. When the facility itself is absent the
   * write path degrades: unarchive → workspace-domain-unavailable, delete
   * step-2 → system-error (partial failure, retryable). Absent storageDomain
   * never crashes or hangs the plugin.
   */
  storageDomain?: { get(name: string): ArchiveDomain | null | undefined }
  /** Read the current archivedSessionIds set (never touches the write domain). */
  readArchived(): string[]
  /** Read the current workspace global object `{initialized, workspaceIds, archivedSessionIds}`. */
  readWorkspaceGlobal(): Record<string, unknown>
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

function fail(code: string, message: string): SmResponse {
  return { status: 200, json: { ok: false, code, message } }
}

function bad(code: string, message: string): SmResponse {
  return { status: 400, json: { ok: false, code, message } }
}

function bodyIsObject(body: unknown): body is Record<string, unknown> {
  return typeof body === 'object' && body !== null && !Array.isArray(body)
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
 */
export function createSmHandler(deps: SmHandlerDeps): {
  handle(method: string | null | undefined, req: unknown, body: unknown): SmResponse
} {
  const log = deps.log ?? { warn: () => {} }

  // ---- /sm/delete ----
  function doDelete(_req: unknown, body: unknown): SmResponse {
    if (!bodyIsObject(body)) return bad('bad-request', 'body must be an object')

    const { id, cwd, title, force } = body as { id?: unknown; cwd?: unknown; title?: unknown; force?: unknown }

    // 400-level input validation (INTERFACE §3.1).
    if (!assertValidId(id)) return bad('invalid-id', 'invalid id')
    if (cwd !== undefined && cwd !== null && typeof cwd !== 'string') {
      return bad('invalid-cwd', 'invalid cwd')
    }
    if (title !== undefined && title !== null) {
      if (typeof title !== 'string' || title.length > 256) {
        return bad('invalid-title', 'invalid title')
      }
    }
    // `force` must be a boolean when provided (otherwise the request is malformed).
    if (force !== undefined && typeof force !== 'boolean') {
      return bad('invalid-force', 'invalid force')
    }

    // Locate the project dir (honoring an optional test override map; bounds
    // still apply after).
    const proj = resolveLookup(deps, cwd)
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

    // Running-session guard (host-side, not only the client). Optional at the
    // handler level: when no session service is supplied we cannot know if the
    // target is live, so the guard is skipped (delete proceeds) rather than
    // crashing — the guard is a safety enhancement, not a hard gate.
    // `force:true` opts into deleting a live (running) session: the file moves
    // to the recycle bin anyway (recoverable). WITHOUT force a live session is
    // still refused with the stable `session-running` code (contract unchanged).
    if (deps.sessions?.get(id as string) && force !== true) {
      return fail('session-running', 'session is running')
    }

    // Source missing: if already in the trash → idempotent-complete, run the
    // archive step-2; else a genuine not-found.
    if (!fs.existsSync(targetDir)) {
      if (deps.trash.hasItem(id as string)) return doArchivedCleanup(id as string)
      return fail('session-dir-not-found', 'session dir not found')
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
  // Reads the archive set independently of the write domain (so an otherwise
  // non-archived delete stays a pure no-op), then requires the write domain.
  // Partial failure → system-error while the file is already moved (retryable).
  function doArchivedCleanup(id: string): SmResponse {
    if (!deps.readArchived().includes(id)) return ok()

    const domain = deps.storageDomain?.get('workspace')
    if (domain === null || domain === undefined) {
      log.warn(`archive cleanup for ${id}: workspace domain unavailable after file moved; retry to complete`)
      return fail('system-error', 'archive cleanup failed; file already moved, retry to complete')
    }
    try {
      const current = deps.readWorkspaceGlobal()
      const next = deps.readArchived().filter((x) => x !== id)
      domain.global.set({ ...current, archivedSessionIds: next })
      return ok()
    } catch (err) {
      log.warn(`archive cleanup for ${id} failed: ${String(err)}`)
      return fail('system-error', String(err))
    }
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
  function doUnarchive(_req: unknown, body: unknown): SmResponse {
    if (!bodyIsObject(body)) return bad('bad-request', 'body must be an object')
    const { id } = body as { id?: unknown }
    if (!assertValidId(id)) return bad('invalid-id', 'invalid id')

    // Domain availability is checked FIRST, before reading the set. An absent
    // storageDomain read via ?. yields undefined, so the degradation is the
    // same "workspace-domain-unavailable" as when get('workspace') returns null.
    const domain = deps.storageDomain?.get('workspace')
    if (domain === null || domain === undefined) {
      return fail('workspace-domain-unavailable', 'workspace storage domain unavailable')
    }
    const archived = deps.readArchived()
    if (!archived.includes(id as string)) return ok() // idempotent no-op

    try {
      const current = deps.readWorkspaceGlobal()
      const next = archived.filter((x) => x !== id)
      domain.global.set({ ...current, archivedSessionIds: next })
      return ok()
    } catch (err) {
      return fail('system-error', String(err))
    }
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
    handle(method, _req, body): SmResponse {
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
