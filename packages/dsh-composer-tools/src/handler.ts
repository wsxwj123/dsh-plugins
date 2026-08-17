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
 *   §1 (endpoints): /ct/instructions.list|read|save|create|delete + /ct/prompts each with
 *     their own strict ordering (see doList/doRead/doSave/doCreate/doDelete/doPrompts).
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
  createGlobalAgentsTemplate,
  createProjectAgentsTemplate,
  discoverInstructions,
  dshHomeAgentsTarget,
  isDiscoveredPath,
  MAX_SOURCE_BYTES,
  projectRootAgentsTarget,
  type DiscoveryResult,
} from './instructions.js'
import { loadPrompts } from './prompts-store.js'

export const MAX_BODY_BYTES = 2097152

const ENDPOINTS = new Set(['/ct/instructions.list', '/ct/instructions.read', '/ct/instructions.save', '/ct/instructions.create', '/ct/instructions.delete', '/ct/prompts'])

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
  return {
    status: 200,
    json: {
      ok: true,
      dshHome: disc.dshHome,
      projectRoot: disc.projectRoot,
      projectRootFound: disc.projectRootFound,
      canCreateRootAgents: disc.canCreateRootAgents,
      canCreateGlobalAgents: disc.canCreateGlobalAgents,
      files: disc.files,
    },
  }
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
  // 安全审计建议：发现（lstat 拒 symlink）与最终写入之间若目标被换成符号链接，
  // writeFileSync 会跟随写入其指向处。写前复核一次，消除该竞态窗口（低危加固）。
  if (st.isSymbolicLink()) {
    return { status: 200, json: { ok: false, code: 'path-out-of-scope', message: 'path is not among the instruction files discovered for cwd' } }
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

/**
 * §1.5 instructions.create — 新建指令文件（scope 'project' | 'global'，缺省 project）。
 * body 仅 cwd + 可选 scope；目标路径由 host 按 scope + 发现结果严格推导
 * （project → realpath(projectRoot)/AGENTS.md；global → realpath(dshHome)/AGENTS.md），
 * 不接收客户端传来的任何目标路径。
 */
function doCreate(body: unknown, opts: CtHandlerOptions): { status: number; json: unknown } {
  const obj = body as Record<string, unknown>
  const cwd = obj?.cwd
  if (typeof cwd !== 'string' || cwd.trim().length === 0 || !path.isAbsolute(cwd)) {
    return { status: 400, json: { ok: false, code: 'invalid-cwd', message: 'invalid cwd: must be an absolute path string' } }
  }
  // 判定 3：scope 若提供必须 ∈ {'project','global'}，缺省视为 'project'（向后兼容）。
  const rawScope = obj?.scope
  if (rawScope !== undefined && rawScope !== 'project' && rawScope !== 'global') {
    return { status: 400, json: { ok: false, code: 'invalid-scope', message: 'invalid scope: must be "project" or "global"' } }
  }
  const scope: 'project' | 'global' = rawScope === 'global' ? 'global' : 'project'
  // 判定 4：现场发现。scope=project 时无真项目根（cwd→fs 根链无 '.git' 标记）不落盘；
  // scope=global 无此前置（dshHome 为 host 解析的固定目录）。
  const disc = discoverInstructions({ cwd, dshHome: opts.dshHome })
  if (scope === 'project' && disc.projectRootFound !== true) {
    return {
      status: 200,
      json: {
        ok: false,
        code: 'no-project-root',
        message: 'no project root found for cwd: no .git marker on the path up to the fs root',
      },
    }
  }
  // 判定 5：目录链 symlink 防护（写前 realpath，杜绝"字符在范围内、物理越界"）。
  // 两分支的 realpathSync 抛错（目录被删/不可读）均 → system-error（不发明新错误码）。
  // project 分支另以 realRoot 复核 '.git' 标记为准（与发现对同一物理位置判定一致），
  // 复核失败 → path-out-of-scope；不要求 realRoot 与字符级 projectRoot 字符串相等
  // （经 symlink 访问的合法项目是正常用法）。
  let target: string
  if (scope === 'project') {
    let realRoot: string
    try {
      target = projectRootAgentsTarget(disc.projectRoot) // realpath(projectRoot)/AGENTS.md
      realRoot = path.dirname(target)
    } catch (err) {
      return { status: 200, json: { ok: false, code: 'system-error', message: String(err) } }
    }
    let hasMarker = false
    try {
      fs.lstatSync(path.join(realRoot, '.git'))
      hasMarker = true
    } catch {
      hasMarker = false
    }
    if (!hasMarker) {
      return {
        status: 200,
        json: {
          ok: false,
          code: 'path-out-of-scope',
          message: 'project root resolves outside the discovered instruction scope',
        },
      }
    }
  } else {
    try {
      target = dshHomeAgentsTarget(disc.dshHome) // realpath(dshHome)/AGENTS.md
    } catch (err) {
      return { status: 200, json: { ok: false, code: 'system-error', message: String(err) } }
    }
  }
  // 返回给 client 的 path 用词法路径（project: projectRoot/AGENTS.md；global:
  // dshHome/AGENTS.md）——与发现集合的词法成员一致，create 产物才能被后续 save 的
  // 发现成员比对命中（发现用词法路径指向同一物理位置）。无 symlink 时词法=物理。
  const responsePath = path.join(scope === 'project' ? disc.projectRoot : disc.dshHome, 'AGENTS.md')
  // 判定 6：原子创建（O_CREAT|O_EXCL，无 TOCTOU）。EEXIST → path-exists（文案按 scope）；
  // 其余 IO → system-error。绝不覆盖、绝不跟随符号链接写入。
  const content = scope === 'project' ? createProjectAgentsTemplate() : createGlobalAgentsTemplate()
  try {
    fs.writeFileSync(target, content, { flag: 'wx' })
  } catch (err) {
    const e = err as NodeJS.ErrnoException
    if (e && e.code === 'EEXIST') {
      return {
        status: 200,
        json: {
          ok: false,
          code: 'path-exists',
          message:
            scope === 'project'
              ? 'project-level AGENTS.md already exists; create refused to overwrite'
              : 'global AGENTS.md already exists; create refused to overwrite',
        },
      }
    }
    return { status: 200, json: { ok: false, code: 'system-error', message: String(err) } }
  }
  // 判定 7：写后重新 lstat 取新 mtime（可直接作 save 基线）。
  let st
  try {
    st = fs.lstatSync(target)
  } catch {
    st = null
  }
  return { status: 200, json: { ok: true, path: responsePath, content, mtimeMs: st ? st.mtimeMs : 0 } }
}

/**
 * 并发会合窗口（§1.6 契约补充的并发语义）：并发双删同一 path 必须恰好
 * "一 ok 一 file-not-found"，其中 file-not-found 来自后到者 unlink 命中 ENOENT。
 * 该机制物理上要求两个并发请求都在文件仍存在时通过全部闸门、然后再 unlink——
 * node 同一事件循环内各 HTTP 请求的同步段是逐个串行执行的，若闸门（发现/复核）
 * 与 unlink 之间不让出事件循环，后到请求的实时发现会先命中 path-out-of-scope，
 * 契约描述的"unlink ENOENT → file-not-found"窗口永远不会出现。在写前复核与
 * unlink 之间让出一个短宏观任务窗口，并发到达的同路径 delete 即都能通过闸门：
 * 先醒者 unlink 成功（ok），后醒者 ENOENT（file-not-found）。顺序调用不受影响：
 * 第二个请求到达时文件已删，实时发现照样先命中 path-out-of-scope。
 */
const DELETE_RENDEZVOUS_MS = 25

/**
 * §1.6 instructions.delete — 删除指令文件（发现集合内任意 level：全局/项目级/local）。
 * 三闸门：basename 白名单(400) + 发现集合成员比对(path-out-of-scope) +
 * 父目录链 realpath 包含性校验（防目录链 symlink 物理越界），写前 lstat 复核防 TOCTOU。
 */
async function doDelete(body: unknown, opts: CtHandlerOptions): Promise<{ status: number; json: unknown }> {
  const obj = body as Record<string, unknown>
  const cwd = obj?.cwd
  if (typeof cwd !== 'string' || cwd.trim().length === 0 || !path.isAbsolute(cwd)) {
    return { status: 400, json: { ok: false, code: 'invalid-cwd', message: 'invalid cwd: must be an absolute path string' } }
  }
  const p = obj?.path
  if (typeof p !== 'string' || !path.isAbsolute(p) || !INSTRUCTION_BASENAMES.has(path.basename(p))) {
    return { status: 400, json: { ok: false, code: 'invalid-path', message: 'invalid path: must be an absolute path to AGENTS.md / CLAUDE.md / AGENTS.local.md / CLAUDE.local.md' } }
  }
  // 判定 4：范围校验——现场重跑发现，目标必须在发现结果绝对路径集合内
  // （发现已拒收 symlink，集合成员必非符号链接）。
  const discovery = discoverInstructions({ cwd, dshHome: opts.dshHome })
  if (!isDiscoveredPath(p, discovery)) {
    return { status: 200, json: { ok: false, code: 'path-out-of-scope', message: 'path is not among the instruction files discovered for cwd' } }
  }
  // 判定 5：父目录链 realpath 包含性校验。字符级成员比对只拦最终组件 symlink，
  // 拦不住"父目录链某层是指向项目根外的 symlink"（unlink 会物理删除范围外文件）。
  // realParent 必须落在按文件 level 取的合法物理前缀内（global → realpath(dshHome)，
  // 其他 → realpath(projectRoot)）；realpath 抛错（目录被删/不可读）→ system-error。
  const discovered = discovery.files.find((f) => f.path === path.resolve(p))
  let realParent: string
  let realPrefix: string
  try {
    realParent = fs.realpathSync(path.dirname(p))
    realPrefix = fs.realpathSync(discovered?.level === 'global' ? discovery.dshHome : discovery.projectRoot)
  } catch (err) {
    return { status: 200, json: { ok: false, code: 'system-error', message: String(err) } }
  }
  if (realParent !== realPrefix && !realParent.startsWith(realPrefix + path.sep)) {
    return { status: 200, json: { ok: false, code: 'path-out-of-scope', message: 'path is not among the instruction files discovered for cwd' } }
  }
  // 判定 6：写前复核（防 TOCTOU）。列出后被删 → file-not-found；发现后到删除前
  // 被换成符号链接 → path-out-of-scope（绝不跟随符号链接删除）。
  let st
  try {
    st = fs.lstatSync(p)
  } catch {
    return { status: 200, json: { ok: false, code: 'file-not-found', message: 'instruction file not found' } }
  }
  if (st.isSymbolicLink()) {
    return { status: 200, json: { ok: false, code: 'path-out-of-scope', message: 'path is not among the instruction files discovered for cwd' } }
  }
  // 判定 7 前置：并发会合窗口（见 DELETE_RENDEZVOUS_MS 注释）——让并发到达的同路径
  // delete 都在文件仍存在时通过上方闸门，契约的"一 ok 一 file-not-found"才可能成立。
  await new Promise((resolve) => setTimeout(resolve, DELETE_RENDEZVOUS_MS))
  // 判定 7：删除。并发双删同一 path：后到者 unlink 命中 ENOENT → file-not-found
  // （契约：恰一 ok 一 file-not-found，永不双 ok、永不双删）；其余 IO → system-error。
  try {
    fs.unlinkSync(p)
  } catch (err) {
    const e = err as NodeJS.ErrnoException
    if (e && e.code === 'ENOENT') {
      return { status: 200, json: { ok: false, code: 'file-not-found', message: 'instruction file not found' } }
    }
    return { status: 200, json: { ok: false, code: 'system-error', message: String(err) } }
  }
  return { status: 200, json: { ok: true } }
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
        } else if (pathname === '/ct/instructions.create') {
          result = doCreate(body, opts)
        } else if (pathname === '/ct/instructions.delete') {
          result = await doDelete(body, opts)
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
