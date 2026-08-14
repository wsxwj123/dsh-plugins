/**
 * Node half of dsh-session-manager — a Cordis plugin.
 *
 * Responsibilities (PLAN §4 T2/T3):
 *  1. Mount the raw /sm/* RPC surface on the web server, protected by the
 *     loopback trust fence, with recycle-bin file operations
 *     (delete/restore/emptyTrash/trash) and the workspace archive-set write
 *     (delete-archived step-2 / unarchive).
 *  2. Use ONLY core ctx members (logger/get/effect/on/emit). Every service
 *     (storageDomain / sessions / webServer) is read through `ctx.get` (never
 *     bare), so a missing service degrades to a logged no-op instead of
 *     blocking plugin activation.
 *
 * Cordis access discipline (the dsh-pet-bridge crash lesson): we never touch a
 * service property bare — `ctx.<service>` outside the inject list throws
 * "cannot get property without inject". And this plugin deliberately keeps its
 * `inject` EMPTY so it never becomes a hard activation dependency: cordis waits
 * on injected services, so injecting one that a headless profile lacks leaves
 * the plugin `pending` forever and fails the whole profile load (the e2e
 * startup crash). Everything is an optional `ctx.get`, presence-gated.
 */

import path from 'node:path'
import os from 'node:os'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from 'cordis'
import { TrashStore } from './trash.js'
import { createSmHandler, archiveFromGlobal, type SmHandlerDeps } from './handler.js'
import { isTrustedSmRequest } from './trust-fence.js'

/** Minimal web-server service surface we depend on (via optional ctx.get). */
interface WebServerService {
  register(route: {
    kind: string
    path: string
    handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
  }): () => void
}

/** storage-domain facility shape read via ctx.get (optional). */
interface StorageDomainService {
  get(name: string): { global: { get(): unknown; set(value: unknown): unknown } } | null | undefined
}

/** node SessionStore shape read via ctx.get (optional). */
interface SessionsService {
  get(id: string): unknown
}

export const name = 'dsh-session-manager'

/**
 * Deliberately empty. Cordis treats inject entries as hard activation
 * dependencies (absent service → plugin `.pending` forever → whole profile load
 * fails). To survive headless profiles that lack storageDomain/sessions, every
 * service is read optionally via ctx.get instead. Presence is checked at
 * apply() time; a missing service degrades the affected endpoints (documented
 * on each) without crashing or hanging activation.
 */
export const inject: readonly string[] = []

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

export function apply(ctx: Context, config: SessionManagerConfig = {}): void {
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

  // All services are optional reads. Each degrades independently:
  //   storageDomain missing -> unarchive => workspace-domain-unavailable,
  //                             delete-archived step-2 => system-error (partial)
  //   sessions     missing -> delete running-session guard skipped
  //   webServer    missing -> /sm routes not mounted (logged)
  const storageDomain = ctx.get('storageDomain') as StorageDomainService | undefined
  const sessions = ctx.get('sessions') as SessionsService | undefined

  if (!storageDomain) {
    ctx.logger.warn(
      '[session-manager] storageDomain service unavailable; archive write (unarchive / delete-of-archived) will degrade to workspace-domain-unavailable / system-error',
    )
  }
  if (!sessions) {
    ctx.logger.warn(
      '[session-manager] sessions service unavailable; running-session guard is skipped and deletes proceed',
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
    sessions, // optional; handler degrades running-guard when undefined
    storageDomain, // optional; handler degrades archive paths when undefined
    readArchived: () => archiveFromGlobal(readGlobal()),
    readWorkspaceGlobal: readGlobal,
    log: { warn: (m) => ctx.logger.warn(`[session-manager] ${m}`) },
  }
  const handler = createSmHandler(deps)

  // Recycle-bin enables a raw /sm/* route. We fetch the web server optionally
  // (never bare) so that if it is absent we degrade gracefully.
  const webServer = ctx.get('webServer') as WebServerService | undefined

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
