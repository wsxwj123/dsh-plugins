/**
 * Host RPC handler for dsh-composer-tools — the executable surface mounted on
 * `/ct` (PLAN §1.2 module 4). CREATED BY createCtHandler(ctx) which captures
 * ctx in a closure; the returned handler is exactly the `webServer.register`
 * callback.
 *
 * Judgment order is CONTRACT (INTERFACE §0 then §1) and must match
 * tests/acceptance/helpers/contractHost.mjs match-for-match:
 *   §0 (transport, in this order):
 *     1 trust fence       → 403 plain 'forbidden'
 *     2 not POST          → 405 header allow: POST, plain 'method not allowed'
 *     3 no method segment → 404 plain 'not found'
 *     4 body over 2MB     → 413 JSON {ok:false, code:'payload-too-large', ...}
 *     5 body read failure → 400 JSON {ok:false, code:'bad-request', message:'request body read failed'}
 *     6 invalid JSON      → 400 JSON {ok:false, code:'bad-request', message:'invalid JSON'}
 *     7 method not in table → 404 JSON {ok:false, error:'not found'}
 *   §1 (endpoints): /ct/instructions.list|read|save + /ct/prompts each with
 *     their own strict ordering (see doList/doRead/doSave/doPrompts).
 *
 * cordis discipline: ctx is held in the closure and ctx.logger.* is ALWAYS
 * fetched freshly at call site — never cached in a local across an async
 * callback. The async handler is fully guarded with try/catch and never
 * rejects.
 */

import fs from 'node:fs'
import path from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from 'cordis'
import { isTrustedCtRequest } from './trust-fence.js'
import {
  discoverInstructions,
  isDiscoveredPath,
  MAX_SOURCE_BYTES,
  type DiscoveryResult,
} from './instructions.js'
import { loadPrompts } from './prompts-store.js'

export const MAX_BODY_BYTES = 2097152

const ENDPOINTS = new Set(['/ct/instructions.list', '/ct/instructions.read', '/ct/instructions.save', '/ct/prompts'])

const INSTRUCTION_BASENAMES = new Set(['AGENTS.md', 'CLAUDE.md', 'AGENTS.local.md', 'CLAUDE.local.md'])

export interface CtHandlerOptions {
  /** Override dshHome for discovery (tests). Defaults to env/OS resolution. */
  dshHome?: string
  /** Injected prompt items (test harness). Omitted → real data/prompt-templates.json. */
  promptsItems?: import('./prompts-store.js').PromptItem[]
  /** Injected prompt-library failure (test harness). Omitted → real read path. */
  promptsError?: string
}

export interface CtHandler {
  (req: IncomingMessage, res: ServerResponse): Promise<void>
}

function sendJson(res: ServerResponse, status: number, json: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(json))
}

function sendPlain(res: ServerResponse, status: number, text: string, extraHeaders: Record<string, string> = {}): void {
  res.writeHead(status, extraHeaders)
  res.end(text)
}

function bodyIsObject(body: unknown): body is Record<string, unknown> {
  return typeof body === 'object' && body !== null && !Array.isArray(body)
}

export type BodyRead =
  | { ok: true; body: string }
  | { ok: false; code: 'read-failed' }
  | { ok: false; code: 'too-large' }

/**
 * Consume the raw request body (INTERFACE §0.4–0.5). NEVER rejects: a
 * mid-stream failure (client abort / transport error) resolves to
 * `{ ok:false, code:'read-failed' }` → 400; a body over `limit` (declared via
 * content-length OR actual streamed bytes) resolves to `{ ok:false,
 * code:'too-large' }` → 413 without buffering the excess. Byte-accurate on
 * raw Buffers, so multibyte UTF-8 cannot slip past the limit.
 */
export async function readRequestBody(req: IncomingMessage, limit: number = MAX_BODY_BYTES): Promise<BodyRead> {
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

/** §1.1 instructions.list */
function doList(body: unknown, opts: CtHandlerOptions): { status: number; json: unknown } {
  const cwd = (body as Record<string, unknown>)?.cwd
  if (typeof cwd !== 'string' || cwd.trim().length === 0 || !path.isAbsolute(cwd)) {
    return { status: 400, json: { ok: false, code: 'invalid-cwd', message: 'invalid cwd: must be an absolute path string' } }
  }
  const disc = discoverInstructions({ cwd, dshHome: opts.dshHome })
  return { status: 200, json: { ok: true, dshHome: disc.dshHome, projectRoot: disc.projectRoot, files: disc.files } }
}

/** §1.2 instructions.read */
function doRead(body: unknown, opts: CtHandlerOptions): { status: number; json: unknown } {
  const cwd = (body as Record<string, unknown>)?.cwd
  if (typeof cwd !== 'string' || cwd.trim().length === 0 || !path.isAbsolute(cwd)) {
    return { status: 400, json: { ok: false, code: 'invalid-cwd', message: 'invalid cwd: must be an absolute path string' } }
  }
  const p = (body as Record<string, unknown>)?.path
  if (typeof p !== 'string' || !path.isAbsolute(p) || !INSTRUCTION_BASENAMES.has(path.basename(p))) {
    return { status: 400, json: { ok: false, code: 'invalid-path', message: 'invalid path: must be an absolute path to AGENTS.md / CLAUDE.md / AGENTS.local.md / CLAUDE.local.md' } }
  }
  const discovery = discoverInstructions({ cwd, dshHome: opts.dshHome })
  return doReadInScope(p, discovery)
}

function doReadInScope(p: string, discovery: DiscoveryResult): { status: number; json: unknown } {
  if (!isDiscoveredPath(p, discovery)) {
    return { status: 200, json: { ok: false, code: 'path-out-of-scope', message: 'path is not among the instruction files discovered for cwd' } }
  }
  let st
  try {
    st = fs.lstatSync(p)
  } catch {
    return { status: 200, json: { ok: false, code: 'file-not-found', message: 'instruction file not found' } }
  }
  let buf: Buffer
  try {
    buf = fs.readFileSync(p)
  } catch (err) {
    return { status: 200, json: { ok: false, code: 'system-error', message: String(err) } }
  }
  const truncated = buf.length > MAX_SOURCE_BYTES
  const content = truncated ? longestValidUtf8Prefix(buf, MAX_SOURCE_BYTES) : buf.toString('utf8')
  return { status: 200, json: { ok: true, path: p, content, mtimeMs: st.mtimeMs, truncated } }
}

/**
 * Longest prefix of `buf` that decodes to valid utf8 and whose byte length is
 * no more than `maxBytes`. Does not split a multibyte character.
 */
function longestValidUtf8Prefix(buf: Buffer, maxBytes: number): string {
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let end = maxBytes
  while (end > 0) {
    try {
      return decoder.decode(buf.subarray(0, end))
    } catch {
      end--
    }
  }
  return ''
}

/** §1.3 instructions.save */
function doSave(body: unknown, opts: CtHandlerOptions): { status: number; json: unknown } {
  const obj = body as Record<string, unknown>
  const cwd = obj?.cwd
  if (typeof cwd !== 'string' || cwd.trim().length === 0 || !path.isAbsolute(cwd)) {
    return { status: 400, json: { ok: false, code: 'invalid-cwd', message: 'invalid cwd: must be an absolute path string' } }
  }
  const p = obj?.path
  if (typeof p !== 'string' || !path.isAbsolute(p) || !INSTRUCTION_BASENAMES.has(path.basename(p))) {
    return { status: 400, json: { ok: false, code: 'invalid-path', message: 'invalid path: must be an absolute path to AGENTS.md / CLAUDE.md / AGENTS.local.md / CLAUDE.local.md' } }
  }
  const content = obj?.content
  if (typeof content !== 'string' || Buffer.byteLength(content, 'utf8') > MAX_SOURCE_BYTES) {
    return { status: 400, json: { ok: false, code: 'invalid-content', message: 'invalid content: must be a string of at most 1048576 utf8 bytes' } }
  }
  const expectedMtimeMs = obj?.expectedMtimeMs
  if (typeof expectedMtimeMs !== 'number' || !Number.isFinite(expectedMtimeMs) || expectedMtimeMs < 0) {
    return { status: 400, json: { ok: false, code: 'invalid-mtime', message: 'invalid expectedMtimeMs: must be a finite non-negative number' } }
  }
  const allowTruncatedBase = obj?.allowTruncatedBase
  if (allowTruncatedBase !== undefined && typeof allowTruncatedBase !== 'boolean') {
    return { status: 400, json: { ok: false, code: 'invalid-allow-truncated-base', message: 'invalid allowTruncatedBase: must be a boolean' } }
  }

  const discovery = discoverInstructions({ cwd, dshHome: opts.dshHome })
  if (!isDiscoveredPath(p, discovery)) {
    return { status: 200, json: { ok: false, code: 'path-out-of-scope', message: 'path is not among the instruction files discovered for cwd' } }
  }
  let st
  try {
    st = fs.lstatSync(p)
  } catch {
    return { status: 200, json: { ok: false, code: 'file-not-found', message: 'instruction file not found' } }
  }
  if (st.size > MAX_SOURCE_BYTES && allowTruncatedBase !== true) {
    return { status: 200, json: { ok: false, code: 'file-truncated', message: 'file exceeds 1048576 bytes; saving a truncated base would silently drop the tail — edit it with an external editor, or resend with allowTruncatedBase:true' } }
  }
  if (st.mtimeMs !== expectedMtimeMs) {
    return { status: 200, json: { ok: false, code: 'mtime-conflict', message: 'file changed on disk since it was read', currentMtimeMs: st.mtimeMs } }
  }
  try {
    fs.writeFileSync(p, content, 'utf8')
  } catch (err) {
    return { status: 200, json: { ok: false, code: 'system-error', message: String(err) } }
  }
  let newSt
  try {
    newSt = fs.lstatSync(p)
  } catch {
    newSt = null
  }
  return { status: 200, json: { ok: true, mtimeMs: newSt ? newSt.mtimeMs : 0 } }
}

/** §1.4 prompts — empty body or {} both accepted; otherwise must be an object. */
async function doPrompts(body: unknown, opts: CtHandlerOptions): Promise<{ status: number; json: unknown }> {
  if (body !== undefined && !bodyIsObject(body)) {
    return { status: 400, json: { ok: false, code: 'bad-request', message: 'body must be an object' } }
  }
  const out = await loadPrompts(opts.promptsItems, opts.promptsError)
  return out.ok ? { status: 200, json: out.json } : { status: 200, json: out.json }
}

/**
 * Create the /ct handler. `ctx` is captured so ctx.logger.* is fetched afresh
 * at every call site (never cached across an async callback — cordis red line).
 */
export function createCtHandler(ctx: Context, opts: CtHandlerOptions = {}): CtHandler {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    try {
      // §0.1 trust fence
      if (!isTrustedCtRequest(req)) {
        sendPlain(res, 403, 'forbidden')
        return
      }
      // §0.2 POST only
      if (req.method !== 'POST') {
        sendPlain(res, 405, 'method not allowed', { allow: 'POST' })
        return
      }
      // §0.3 method-name segment
      const m = /^\/ct\/([^/?#]+)/.exec(req.url ?? '')
      const pathname = m ? `/ct/${m[1]}` : undefined
      if (!pathname) {
        sendPlain(res, 404, 'not found')
        return
      }

      // §0.4–0.6 body read + JSON parse (guarded, never rejects)
      const read = await readRequestBody(req, MAX_BODY_BYTES)
      if (!read.ok) {
        if (read.code === 'read-failed') {
          sendJson(res, 400, { ok: false, code: 'bad-request', message: 'request body read failed' })
          return
        }
        sendJson(res, 413, { ok: false, code: 'payload-too-large', message: `request body exceeds ${MAX_BODY_BYTES} bytes` })
        return
      }
      let body: unknown
      if (read.body.length === 0) {
        body = undefined
      } else {
        try {
          body = JSON.parse(read.body)
        } catch {
          sendJson(res, 400, { ok: false, code: 'bad-request', message: 'invalid JSON' })
          return
        }
      }

      // §0.7 endpoint table
      if (!ENDPOINTS.has(pathname)) {
        sendJson(res, 404, { ok: false, error: 'not found' })
        return
      }

      // dispatch
      let result: { status: number; json: unknown }
      if (pathname === '/ct/prompts') {
        result = await doPrompts(body, opts)
      } else {
        if (!bodyIsObject(body)) {
          result = { status: 400, json: { ok: false, code: 'bad-request', message: 'body must be an object' } }
        } else if (pathname === '/ct/instructions.list') {
          result = doList(body, opts)
        } else if (pathname === '/ct/instructions.read') {
          result = doRead(body, opts)
        } else {
          result = doSave(body, opts)
        }
      }
      sendJson(res, result.status, result.json)
    } catch (err) {
      // Never reject, never leak an unhandled rejection out of the async route.
      ctx.logger.error('[composer-tools] /ct request failed: %s', String(err))
      try {
        if (!res.headersSent) {
          sendJson(res, 400, { ok: false, code: 'bad-request', message: 'request failed' })
        } else {
          res.end()
        }
      } catch {
        /* socket already gone */
      }
    }
  }
}
