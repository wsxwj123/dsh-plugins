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
import { createSmHandler, archiveFromGlobal, type SmHandlerDeps, type ArchiveDomain } from './handler.js'
import { isTrustedSmRequest } from './trust-fence.js'

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
 * Build the /sm dispatch with a production storage-domain facility. Kept as a
 * separate exported function so tests can wire a real handler without booting
 * cordis, and so the archive read helpers stay in one place.
 */
export function makeHandler(
  deps: SmHandlerDeps,
): ReturnType<typeof createSmHandler> {
  return createSmHandler(deps)
}

export function apply(ctx: InjectedCtx, config: SessionManagerConfig = {}): void {
  const { sessionsRoot, trashRoot } = resolveRoots(config)
  // Hard safety invariant (INTERFACE §4 / PLAN risk 2): the trash half must not
  // sit inside the sessions root, or the host session scan would re-discover
  // moved sessions and "resurrect" them. We enforce it at startup.
  if (isTrashInside(sessionsRoot, trashRoot)) {
    ctx.logger.warn(
      `[session-manager] trash root ${trashRoot} is inside sessions root ${sessionsRoot}; refusing to enable recycle bin`,
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

  const trash = new TrashStore(trashRoot)

  /** Read the current workspace global object; {} when the domain is absent. */
  const readGlobal = (): Record<string, unknown> => {
    if (!storageDomain) return {}
    const domain = storageDomain.get('workspace')
    if (!domain || typeof domain.global?.get !== 'function') return {}
    try {
      const v = domain.global.get()
      return v && typeof v === 'object' ? (v as Record<string, unknown>) : {}
    } catch {
      return {}
    }
  }

  const deps: SmHandlerDeps = {
    sessionsRoot,
    trash,
    sessions, // optional; cwd resolution falls back to client cwd when undefined
    storageDomain, // optional; handler degrades archive paths when undefined
    readArchived: () => archiveFromGlobal(readGlobal()),
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

      const m = /^\/sm\/([^/?#]+)/.exec(req.url ?? '')
      const method = m ? m[1] : undefined
      if (!method) {
        res.writeHead(404)
        res.end('not found')
        return
      }

      // Consume a raw JSON body. Malformed JSON => 400 (contract §0).
      let raw = ''
      req.setEncoding('utf8')
      for await (const chunk of req) raw += chunk

      let body: unknown
      if (raw.length === 0) {
        body = undefined
      } else {
        try {
          body = JSON.parse(raw)
        } catch {
          res.writeHead(400, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ ok: false, code: 'bad-request', message: 'invalid JSON' }))
          return
        }
      }

      const result = handler.handle(method, req, body)
      res.writeHead(result.status, { 'content-type': 'application/json' })
      res.end(JSON.stringify(result.json))
    },
  }

  // Register the route under this plugin fiber; dispose on teardown.
  const dispose = webServer.register(route)
  ctx.effect(() => dispose)
}

/** Whether one root resolves inside another (startup guard). */
function isTrashInside(sessionsRoot: string, trashRoot: string): boolean {
  const s = path.resolve(sessionsRoot)
  const t = path.resolve(trashRoot)
  return t === s || t.startsWith(s + path.sep)
}
