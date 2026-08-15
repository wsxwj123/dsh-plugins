/**
 * Node half of dsh-session-manager — a Cordis plugin.
 *
 * Responsibilities (PLAN §4 T2/T3):
 *  1. Mount the raw /sm/* RPC surface on the web server, protected by the
 *     loopback trust fence, with recycle-bin file operations
 *     (delete/restore/emptyTrash/trash) and the workspace archive-set write
 *     (delete-archived step-2 / unarchive).
 *  2. Services are declared in `inject` (webServer / storageDomain / sessions)
 *     and accessed BARE (cordis red line #1: an inject-declared service may be
 *     bare-accessed). The web profile shines all three, so route mounting works
 *     reliably — this mirrors the aionui-panel pattern (`inject: [webServer,
 *     ...]` + `ctx.webServer.register(...)`), which demonstrably mounts its
 *     routes on the real web profile.
 *
 * P7 note: an earlier attempt read services via `ctx.get` (and a
 * `ctx.root.get ?? ctx.get` fallback) with an EMPTY inject, on the premise that
 * absent services should degrade gracefully. It never mounted /sm (POST 405):
 * `get` walks the current ctx's isolate and the plugin's isolated ctx did not
 * carry the service symbols. Injecting the services (like aionui-panel) is the
 * correct, proven path. Cordis treats inject entries as hard activation
 * deps: a profile lacking these services leaves the plugin `pending` rather
 * than crashing load — acceptable, because this plugin is only installed in the
 * web profile where they all exist.
 */

import path from 'node:path'
import os from 'node:os'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from 'cordis'
import { TrashStore } from './trash.js'
import { createSmHandler, type SmHandlerDeps, type ArchiveDomain } from './handler.js'
import { isTrustedSmRequest } from './trust-fence.js'
import { isInsideOrEqual } from './paths.js'
import { WORKSPACE_DOMAIN } from './constants.js'

/** Minimal web-server service surface we depend on (injected => bare access). */
interface WebServerService {
  register(route: {
    kind: string
    path: string
    handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
  }): () => void
}

export const name = 'dsh-session-manager'

/**
 * Services this plugin needs. Injecting them makes them BARE-accessible (red
 * line #1 allows bare access to inject-declared services) and makes cordis
 * block activation until they're all active — the same wiring the aionui-panel
 * plugin uses to mount its routes reliably. `connection` is NOT needed: the
 * /sm route is a raw prefix route mounted directly on webServer (not a
 * connection.rpc envelope).
 */
export const inject: readonly string[] = ['webServer', 'storageDomain', 'sessions']

/** The host services this plugin injects. Bare access is legal because each is
 *  declared in `inject` (cordis injects them into the fiber scope). */
interface InjectedServices {
  webServer: WebServerService
  storageDomain: { get(name: string): ArchiveDomain | null | undefined }
  sessions: { get(id: string): { header?: { cwd?: string } } | null | undefined }
}
type InjectedCtx = Context & InjectedServices

export interface SessionManagerConfig {
  /** Sessions root; defaults to `~/.dsh/sessions`. */
  sessionsRoot?: string
  /** Recycle-bin root; must be OUTSIDE sessionsRoot. Env SM_TRASH_ROOT wins. */
  trashRoot?: string
}

/** Resolve effective roots: CLI/config -> env override -> DSH defaults. */
export function resolveRoots(config: SessionManagerConfig) {
  const home = os.homedir()
  const sessionsRoot = config.sessionsRoot ?? path.join(home, '.dsh', 'sessions')
  const trashRoot =
    process.env.SM_TRASH_ROOT?.trim() ||
    config.trashRoot ||
    path.join(home, '.dsh', 'session-manager-trash')
  return { sessionsRoot, trashRoot }
}

/**
 * Absolute locations that must never serve as the trash root, even if a
 * misconfigured `SM_TRASH_ROOT` / config points at them (SECURITY-REPORT S1).
 * The startup check is the PRIMARY defense: empty() recursively removes the
 * root's contents, so a root aimed at (or containing) user/system data would
 * turn "empty trash" into a destructive delete of unrelated files.
 */
const SYSTEM_TRASH_ROOT_DENYLIST = [
  '/tmp', '/var', '/var/tmp', '/usr', '/etc', '/bin', '/sbin', '/lib', '/opt',
  '/System', '/Library', '/Applications', '/private',
  'C:\\Windows', 'C:\\Program Files', 'C:\\Program Files (x86)', 'C:\\ProgramData', 'C:\\Users',
]

/**
 * Why `trashRoot` is unsafe as the recycle-bin root, or null when it is safe.
 * Rejects: the filesystem root, the home directory, any ANCESTOR of home
 * (e.g. /Users, /home, C:\Users — empty() would reach real user data), the
 * system temp dir, and the known system directories above.
 */
export function trashRootUnsafeReason(trashRoot: string, home: string = os.homedir()): string | null {
  const resolved = path.resolve(trashRoot)
  if (resolved === path.parse(resolved).root) return 'the filesystem root'
  if (resolved === path.resolve(home)) return 'the home directory'
  if (isInsideOrEqual(resolved, home)) return 'an ancestor of the home directory'
  if (resolved === path.resolve(os.tmpdir())) return 'the system temp directory'
  for (const sys of SYSTEM_TRASH_ROOT_DENYLIST) {
    if (path.resolve(sys) === resolved) return `the system directory ${sys}`
  }
  return null
}

/** Max /sm request body in BYTES; larger bodies are refused 413 (S2). */
export const MAX_BODY_BYTES = 64 * 1024

export type BodyRead =
  | { ok: true; body: string }
  | { ok: false; code: 'read-failed' }
  | { ok: false; code: 'too-large' }

/**
 * Consume the raw request body (I-4 + S2). NEVER rejects: a mid-stream failure
 * — client abort (ECONNRESET) or a transport error — resolves to
 * `{ ok:false, code:'read-failed' }`, which the route maps to a structured
 * 400. A body that exceeds `limit` resolves to `{ ok:false, code:'too-large' }`
 * (route maps it to 413) WITHOUT buffering the excess. The count is
 * byte-accurate: raw Buffers are measured, so multibyte UTF-8 payloads cannot
 * slip past the limit.
 */
export async function readRequestBody(req: IncomingMessage, limit: number = MAX_BODY_BYTES): Promise<BodyRead> {
  // Cheap early rejection when the caller declared the size up-front.
  const declared = Number(req.headers['content-length'])
  if (Number.isFinite(declared) && declared > limit) return { ok: false, code: 'too-large' }
  try {
    const chunks: Buffer[] = []
    let size = 0
    for await (const chunk of req) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      size += buf.byteLength
      if (size > limit) return { ok: false, code: 'too-large' }
      chunks.push(buf)
    }
    return { ok: true, body: Buffer.concat(chunks).toString('utf8') }
  } catch {
    return { ok: false, code: 'read-failed' }
  }
}

function sendJson(res: ServerResponse, status: number, json: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(json))
}

export function apply(ctx: InjectedCtx, config: SessionManagerConfig = {}): void {
  const { sessionsRoot, trashRoot } = resolveRoots(config)
  // Hard safety invariant (INTERFACE §4 / PLAN risk 2): the trash half must not
  // sit inside the sessions root, or the host session scan would re-discover
  // moved sessions and "resurrect" them. We enforce it at startup. (S-1: reuse
  // the shared isInsideOrEqual from paths.ts instead of a duplicated copy.)
  if (isInsideOrEqual(sessionsRoot, trashRoot)) {
    ctx.logger.warn(
      `[session-manager] trash root ${trashRoot} is inside sessions root ${sessionsRoot}; refusing to enable recycle bin`,
    )
    return
  }

  // SECURITY-REPORT S1: refuse to enable the recycle bin when the configured
  // trash root is the filesystem root, the home dir, an ancestor of home, the
  // temp dir, or a known system directory — a mis-set SM_TRASH_ROOT must never
  // turn empty() into a recursive delete of unrelated data. Checked BEFORE the
  // TrashStore constructor (which mkdirs the root), so a refused root is never
  // created either.
  const unsafe = trashRootUnsafeReason(trashRoot)
  if (unsafe !== null) {
    ctx.logger.warn(
      `[session-manager] trash root ${trashRoot} is ${unsafe}; refusing to enable recycle bin`,
    )
    return
  }

  // Injected services are guaranteed present on the web profile; bare access is
  // cordis-legal because they're all declared in `inject`.
  const storageDomain = ctx.storageDomain
  const sessions = ctx.sessions

  if (!storageDomain) {
    ctx.logger.warn(
      '[session-manager] storageDomain service unavailable; archive write (unarchive / delete-of-archived) will degrade to workspace-domain-unavailable / system-error',
    )
  }
  if (!sessions) {
    ctx.logger.warn(
      '[session-manager] sessions service unavailable; host-authoritative cwd resolution is skipped and deletes use the client-supplied cwd',
    )
  }

  const trash = new TrashStore(trashRoot, {
    // S-6: leave a warn trace when a metadata record is corrupt instead of
    // silently treating it as missing.
    log: { warn: (m) => ctx.logger.warn(`[session-manager] ${m}`) },
  })

  /**
   * Read the current workspace global object. I-1: a THROWN read (storage
   * fault) returns the `undefined` sentinel — distinguishable from "domain
   * absent / empty global" (`{}`). The handler maps `undefined` to a retryable
   * system-error and never spreads it into a write payload, so a read failure
   * can no longer silently skip archive cleanup or clobber workspaceIds/
   * initialized with `{ ...{}, archivedSessionIds }`.
   */
  const readGlobal = (): Record<string, unknown> | undefined => {
    if (!storageDomain) return {}
    const domain = storageDomain.get(WORKSPACE_DOMAIN)
    if (!domain || typeof domain.global?.get !== 'function') return {}
    try {
      const v = domain.global.get()
      return v && typeof v === 'object' ? (v as Record<string, unknown>) : {}
    } catch {
      return undefined
    }
  }

  const deps: SmHandlerDeps = {
    sessionsRoot,
    trash,
    sessions, // optional; cwd resolution falls back to client cwd when undefined
    storageDomain, // optional; handler degrades archive paths when undefined
    readWorkspaceGlobal: readGlobal,
    log: { warn: (m) => ctx.logger.warn(`[session-manager] ${m}`) },
  }
  const handler = createSmHandler(deps)

  // Mount the raw /sm/* route on the injected web server. BARE access is legal
  // (webServer is declared in `inject`) — this is the aionui-panel wiring that
  // reliably mounts routes on the web profile. cordis blocks apply() until the
  // injected services are active, so webServer is present here by construction.
  const webServer = ctx.webServer

  if (!webServer || typeof webServer.register !== 'function') {
    ctx.logger.warn('[session-manager] webServer service unavailable; /sm routes are not mounted')
    return
  }

  const route = {
    kind: 'prefix',
    path: '/sm',
    handler: async (req: IncomingMessage, res: ServerResponse) => {
      // Loopback trust fence (same guarantees as connection.rpc.handle
      // authority:'loopback'): refuse non-loopback Host / cross-site / foreign
      // Origin before any handler work.
      if (!isTrustedSmRequest(req)) {
        res.writeHead(403)
        res.end('forbidden')
        return
      }

      // S3: /sm is a POST-only RPC surface (the browser bridge always POSTs —
      // bridgeCore.postJson hard-codes method:'POST'). Every other HTTP method
      // is refused 405 BEFORE any body read or handler work, so a GET/PUT/
      // OPTIONS can never reach a handler with a side effect.
      if (req.method !== 'POST') {
        res.writeHead(405, { allow: 'POST' })
        res.end('method not allowed')
        return
      }

      const m = /^\/sm\/([^/?#]+)/.exec(req.url ?? '')
      const method = m ? m[1] : undefined
      if (!method) {
        res.writeHead(404)
        res.end('not found')
        return
      }

      // I-4: this async route handler must NEVER reject. Everything below is
      // guarded — a body stream that dies mid-read (client abort / transport
      // error), a malformed payload, or a response write onto a dead socket
      // all end in a structured 400 instead of an unhandled rejection.
      try {
        const read = await readRequestBody(req)
        if (!read.ok) {
          if (read.code === 'read-failed') {
            sendJson(res, 400, { ok: false, code: 'bad-request', message: 'request body read failed' })
            return
          }
          sendJson(res, 413, { ok: false, code: 'payload-too-large', message: `request body exceeds ${MAX_BODY_BYTES} bytes` })
          return
        }
        const raw = read.body

        let body: unknown
        if (raw.length === 0) {
          body = undefined
        } else {
          try {
            body = JSON.parse(raw)
          } catch {
            sendJson(res, 400, { ok: false, code: 'bad-request', message: 'invalid JSON' })
            return
          }
        }

        const result = handler.handle(method, req, body)
        res.writeHead(result.status, { 'content-type': 'application/json' })
        res.end(JSON.stringify(result.json))
      } catch (err) {
        // Residual failures (dispatch bug, response write on a dead socket)
        // must not escape the async handler either.
        try {
          if (!res.headersSent) {
            res.writeHead(400, { 'content-type': 'application/json' })
          }
          res.end(JSON.stringify({ ok: false, code: 'bad-request', message: 'request failed' }))
        } catch {
          /* socket already gone — nothing left to send */
        }
      }
    },
  }

  // Register the route under this plugin fiber; dispose on teardown.
  const dispose = webServer.register(route)
  ctx.effect(() => dispose)
}
