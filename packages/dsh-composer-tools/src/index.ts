/**
 * dsh-composer-tools — node (host) half, a Cordis plugin.
 *
 * Responsibilities (PLAN §1.2):
 *  1. Mount the raw /ct/* RPC surface on the web server via
 *     `ctx.webServer.register({ kind:'prefix', path:'/ct', handler })`, protected
 *     by the loopback trust fence and the transport contract (INTERFACE §0).
 *  2. `webServer` is declared in `inject`, so it is BARE-accessible — the
 *     aionui-panel pattern that reliably mounts routes on the web profile.
 *     cordis blocks activation until it is active; if it is somehow still
 *     unavailable, we degrade with a warn and do not crash.
 *  3. The route is registered under this plugin fiber and disposed via
 *     `ctx.effect` on teardown, so uninstall/reload leaves no stragglers.
 *
 * cordis red lines: `ctx.logger` is always fetched fresh at the call site
 * (never cached across an async callback); the async handler never rejects.
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from 'cordis'
import { createCtHandler, type CtHandlerOptions } from './handler.js'

/** Minimal web-server service surface we depend on (injected => bare access). */
interface WebServerService {
  register(route: {
    kind: string
    path: string
    handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
  }): () => void
}

export const name = 'dsh-composer-tools'

/** Services this plugin needs (bare-accessible since declared in inject). */
export const inject: readonly string[] = ['webServer']

interface InjectedServices {
  webServer: WebServerService
}
type InjectedCtx = Context & InjectedServices

export interface ComposerToolsConfig {
  /** Optional override for the instruction-discovery dshHome (tests). */
  dshHome?: string
}

export function apply(ctx: InjectedCtx, config: ComposerToolsConfig = {}): void {
  const opts: CtHandlerOptions = config.dshHome ? { dshHome: config.dshHome } : {}

  const handler = createCtHandler(ctx, opts)

  // Mount the raw /ct/* route. webServer is declared in `inject`, so by
  // construction it is present here when apply() runs; we still guard the
  // boundary so an unexpected absence degrades instead of crashing.
  const webServer = ctx.webServer
  if (!webServer || typeof webServer.register !== 'function') {
    ctx.logger.warn('[dsh-composer-tools] webServer service unavailable; /ct routes are not mounted')
    return
  }

  let dispose: () => void
  try {
    dispose = webServer.register({ kind: 'prefix', path: '/ct', handler })
  } catch (err) {
    ctx.logger.warn('[dsh-composer-tools] failed to mount /ct routes: %s', String(err))
    return
  }

  // Register onto the dispose chain so teardown removes the route.
  ctx.effect(() => dispose)
}
