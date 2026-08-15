/**
 * Loopback trust fence for every /ct/* request.
 *
 * This is a faithful port of the official `isTrustedApiRequest` predicate
 * (dsh-client-connection/lib/index.js) that `connection.rpc.handle('…', …,
 * { authority: 'loopback' })` applies to `/api` and its own channels. We
 * reproduce it here because the /ct surface is a raw HTTP route (see the wire
 * note in src/handler.ts) and must enforce the same security guarantees:
 *   - the Host header must name a loopback authority (localhost / 127/8 / [::1])
 *   - a cross-site Sec-Fetch-Site header is refused
 *   - a present Origin must be same-origin with the Host
 * Anything else is 403, before any handler work runs.
 */

import type { IncomingMessage } from 'node:http'
import { isLoopbackHostname, parseAuthority } from './http-util.js'

/**
 * Decide whether an HTTP (node http.IncomingMessage) /ct request may reach the
 * composer-tools handler. Match-for-match with the official predicate for the
 * loopback-only case (trustedHosts = []).
 */
export function isTrustedCtRequest(req: IncomingMessage): boolean {
  const host = req.headers['host']
  if (typeof host !== 'string' || host.length === 0) return false
  const hostUrl = parseAuthority(host)
  if (hostUrl === undefined) return false
  if (!isLoopbackHostname(hostUrl.hostname)) return false

  const secFetchSite = req.headers['sec-fetch-site']
  if (typeof secFetchSite === 'string' && secFetchSite.toLowerCase() === 'cross-site') return false

  const origin = req.headers['origin']
  if (origin === undefined || origin === null) return true
  try {
    return new URL(String(origin)).host === hostUrl.host
  } catch {
    return false
  }
}
