// 契约参考实现（测试替身）：完整按 INTERFACE §0 传输层 + §1 四个端点实现一个
// HTTP handler，作为"可执行的契约说明书"。
//
// 作用：
//  1. 让 host 契约测试现在就能跑（node --test），逐条断言都能命中真实行为；
//  2. 作为验收基准——真实插件 host 半必须能过同一批断言。
// 切换真实插件：把各 host-rpc-*.test.mjs 顶部的
//   import { ROUTER } from './helpers/contract-host.mjs'
// 换成
//   import { ROUTER } from '<插件 host 半导出的 HTTP 路由>'
// 断言一行都不用改。
//
// 本文件只依据 INTERFACE.md 写，不含任何实现侧私有信息。

import { readFileSync, lstatSync, existsSync, writeFileSync } from 'node:fs'
import { join, resolve, basename, isAbsolute } from 'node:path'
import { homedir } from 'node:os'

export const MAX_BODY_BYTES = 2097152
export const MAX_SOURCE_BYTES = 1048576
const INSTRUCTION_CANDIDATES = ['AGENTS.md', 'CLAUDE.md']
const LOCAL_INSTRUCTION_CANDIDATES = ['AGENTS.local.md', 'CLAUDE.local.md']
const PROJECT_ROOT_MARKERS = ['.git']
const ENDPOINTS = new Set([
  '/ct/instructions.list',
  '/ct/instructions.read',
  '/ct/instructions.save',
  '/ct/prompts',
])

// —— 指令发现（§2.4，同步实现，供范围校验/列出）——

function resolveDshHomeLocal(configured, env = {}) {
  const raw = (configured && configured.trim()) || (env.DSH_HOME && env.DSH_HOME.trim())
  const base = raw || join(homedir(), '.dsh')
  return resolve(base)
}

function lstatMap(p) {
  // lstat 语义：不存在或不可读或符号链接 → null（符号链接拒收）
  try {
    const s = lstatSync(p)
    if (s.isSymbolicLink()) return null
    return s
  } catch {
    return null
  }
}

function findProjectRootSync(cwd) {
  let cur = resolve(cwd)
  for (;;) {
    for (const m of PROJECT_ROOT_MARKERS) {
      if (existsSync(join(cur, m))) return cur
    }
    const parent = resolve(cur, '..')
    if (parent === cur) return resolve(cwd)
    cur = parent
  }
}

function ancestorChain(root, cwd) {
  const chain = []
  const r = resolve(root)
  const c = resolve(cwd)
  if (!c.startsWith(r)) return [r, c]
  // 由宽到窄 root->cwd 完整链
  let cur = c
  const out = []
  while (true) {
    out.push(cur)
    if (cur === r) break
    const up = resolve(cur, '..')
    if (up === cur) break
    cur = up
  }
  out.reverse()
  return out
}

function discoverInstructions({ cwd, dshHome }) {
  const home = resolveDshHomeLocal(dshHome, {})
  const projectRoot = findProjectRootSync(cwd)
  const files = []
  const seen = new Set()
  const push = (path, displayPath, level, name) => {
    if (seen.has(path)) return
    const s = lstatMap(path)
    if (!s) return
    seen.add(path)
    files.push({ path, displayPath, level, name, sizeBytes: s.size, mtimeMs: s.mtimeMs })
  }
  // 全局
  push(join(home, 'AGENTS.md'), home === join(homedir(), '.dsh') ? '~/.dsh/AGENTS.md' : '$DSH_HOME/AGENTS.md', 'global', 'AGENTS.md')
  // 项目链
  const chain = ancestorChain(projectRoot, cwd)
  for (const dir of chain) {
    for (const name of [...INSTRUCTION_CANDIDATES]) {
      push(join(dir, name), relative(projectRoot, join(dir, name)), 'project', name)
    }
    for (const name of [...LOCAL_INSTRUCTION_CANDIDATES]) {
      push(join(dir, name), relative(projectRoot, join(dir, name)), 'local', name)
    }
  }
  return { dshHome: home, projectRoot, files }
}

function relative(root, p) {
  const rel = p.slice(root.length).replace(/^[\\/]/, '')
  return rel || ''
}

function isDiscoveredPath(inputPath, discovery) {
  const resolved = resolve(inputPath)
  return discovery.files.some((f) => f.path === resolved)
}

function validPath(p) {
  return typeof p === 'string' && isAbsolute(p) && ['AGENTS.md', 'CLAUDE.md', 'AGENTS.local.md', 'CLAUDE.local.md'].includes(basename(p))
}

// —— HTTP handler ——

function send(res, status, bodyObj, extraHeaders = {}) {
  res.statusCode = status
  if (bodyObj !== undefined) {
    res.setHeader('content-type', 'application/json')
  }
  for (const [k, v] of Object.entries(extraHeaders)) res.setHeader(k, v)
  res.end(typeof bodyObj === 'string' ? bodyObj : JSON.stringify(bodyObj))
}

export const ROUTER = async (req, res, ctx) => {
  // ctx 可选：{ dshHome } 便于测试注入
  // §0.1 trust fence：Host 非 loopback 或 Sec-Fetch-Site cross-site 或 Origin 与 Host 不同源 → 403
  const host = req.headers.host || ''
  const isLoopback = host.startsWith('127.0.0.1') || host.startsWith('localhost') || host.startsWith('[::1]')
  const sfs = req.headers['sec-fetch-site']
  const origin = req.headers.origin
  const fenceFail = !isLoopback || (sfs === 'cross-site') || (origin && origin !== `http://${host}`)
  if (fenceFail) {
    res.statusCode = 403
    res.end('forbidden')
    return
  }
  // §0.2 非 POST
  if ((req.method || '').toUpperCase() !== 'POST') {
    res.statusCode = 405
    res.setHeader('allow', 'POST')
    res.end('method not allowed')
    return
  }
  // §0.3 无方法名
  const path = (req.url || '').split('?')[0]
  if (!path.startsWith('/ct/') || path === '/ct/') {
    res.statusCode = 404
    res.end('not found')
    return
  }
  // 读 body
  const chunks = []
  let size = 0
  for await (const c of req) {
    size += c.length
    if (size > MAX_BODY_BYTES) {
      send(res, 413, { ok: false, code: 'payload-too-large', message: 'request body exceeds 2097152 bytes' })
      return
    }
    chunks.push(c)
  }
  const raw = Buffer.concat(chunks)
  let body = undefined
  if (raw.length > 0) {
    try {
      body = JSON.parse(raw.toString('utf8'))
    } catch {
      send(res, 400, { ok: false, code: 'bad-request', message: 'invalid JSON' })
      return
    }
  }
  // §0.7 方法名不存在
  if (!ENDPOINTS.has(path)) {
    send(res, 404, { ok: false, error: 'not found' })
    return
  }
  // §1 各端点
  if (path === '/ct/prompts') {
    return handlePrompts(req, res, body, ctx)
  }
  // 其余端点要求 body 为对象
  if (!(body !== null && typeof body === 'object' && !Array.isArray(body))) {
    send(res, 400, { ok: false, code: 'bad-request', message: 'body must be an object' })
    return
  }
  const cwd = body.cwd
  if (typeof cwd !== 'string' || !cwd.trim() || !isAbsolute(cwd)) {
    send(res, 400, { ok: false, code: 'invalid-cwd', message: 'invalid cwd: must be an absolute path string' })
    return
  }
  if (path === '/ct/instructions.list') {
    const disc = discoverInstructions({ cwd, dshHome: ctx && ctx.dshHome })
    send(res, 200, { ok: true, dshHome: disc.dshHome, projectRoot: disc.projectRoot, files: disc.files })
    return
  }
  if (path === '/ct/instructions.read') {
    return handleRead(req, res, body, cwd, ctx)
  }
  if (path === '/ct/instructions.save') {
    return handleSave(req, res, body, cwd, ctx)
  }
}

function handleRead(req, res, body, cwd, ctx) {
  const p = body.path
  const discovery = discoverInstructions({ cwd, dshHome: ctx && ctx.dshHome })
  if (typeof p !== 'string' || !isAbsolute(p) || !['AGENTS.md', 'CLAUDE.md', 'AGENTS.local.md', 'CLAUDE.local.md'].includes(basename(p))) {
    send(res, 400, { ok: false, code: 'invalid-path', message: 'invalid path: must be an absolute path to AGENTS.md / CLAUDE.md / AGENTS.local.md / CLAUDE.local.md' })
    return
  }
  if (!isDiscoveredPath(p, discovery)) {
    send(res, 200, { ok: false, code: 'path-out-of-scope', message: 'path is not among the instruction files discovered for cwd' })
    return
  }
  const ps = lstatMap(p)
  if (!ps) {
    send(res, 200, { ok: false, code: 'file-not-found', message: 'instruction file not found' })
    return
  }
  let buf
  try {
    buf = readFileSync(p)
  } catch (err) {
    send(res, 200, { ok: false, code: 'system-error', message: String(err) })
    return
  }
  const truncated = buf.length > MAX_SOURCE_BYTES
  let content
  if (!truncated) {
    content = buf.toString('utf8')
  } else {
    // 最长合法 utf8 前缀：不超过 MAX_SOURCE_BYTES 字节，且不在多字节字符中间切断。
    // 用 fatal:true 解码，失败则回退一个字节重试（最多回退到一个单字节起点）。
    const { TextDecoder } = require2nd()
    let end = MAX_SOURCE_BYTES
    while (end > 0) {
      try {
        content = new TextDecoder('utf-8', { fatal: true }).decode(buf.subarray(0, end))
        break
      } catch {
        end--
        continue
      }
    }
  }
  send(res, 200, { ok: true, path: p, content, mtimeMs: ps.mtimeMs, truncated })
}

function require2nd() {
  return { TextDecoder }
}

function handleSave(req, res, body, cwd, ctx) {
  const p = body.path
  const content = body.content
  const expMtime = body.expectedMtimeMs
  const atb = body.allowTruncatedBase
  const discovery = discoverInstructions({ cwd, dshHome: ctx && ctx.dshHome })
  if (typeof p !== 'string' || !isAbsolute(p) || !['AGENTS.md', 'CLAUDE.md', 'AGENTS.local.md', 'CLAUDE.local.md'].includes(basename(p))) {
    send(res, 400, { ok: false, code: 'invalid-path', message: 'invalid path: must be an absolute path to AGENTS.md / CLAUDE.md / AGENTS.local.md / CLAUDE.local.md' })
    return
  }
  if (typeof content !== 'string' || Buffer.byteLength(content, 'utf8') > MAX_SOURCE_BYTES) {
    send(res, 400, { ok: false, code: 'invalid-content', message: 'invalid content: must be a string of at most 1048576 utf8 bytes' })
    return
  }
  if (typeof expMtime !== 'number' || !Number.isFinite(expMtime) || expMtime < 0) {
    send(res, 400, { ok: false, code: 'invalid-mtime', message: 'invalid expectedMtimeMs: must be a finite non-negative number' })
    return
  }
  if (atb !== undefined && typeof atb !== 'boolean') {
    send(res, 400, { ok: false, code: 'invalid-allow-truncated-base', message: 'invalid allowTruncatedBase: must be a boolean' })
    return
  }
  if (!isDiscoveredPath(p, discovery)) {
    send(res, 200, { ok: false, code: 'path-out-of-scope', message: 'path is not among the instruction files discovered for cwd' })
    return
  }
  const ps = lstatMap(p)
  if (!ps) {
    send(res, 200, { ok: false, code: 'file-not-found', message: 'instruction file not found' })
    return
  }
  if (ps.size > MAX_SOURCE_BYTES && atb !== true) {
    send(res, 200, { ok: false, code: 'file-truncated', message: 'file exceeds 1048576 bytes; saving a truncated base would silently drop the tail — edit it with an external editor, or resend with allowTruncatedBase:true' })
    return
  }
  if (ps.mtimeMs !== expMtime) {
    send(res, 200, { ok: false, code: 'mtime-conflict', message: 'file changed on disk since it was read', currentMtimeMs: ps.mtimeMs })
    return
  }
  try {
    writeFileSync(p, content, 'utf8')
  } catch (err) {
    send(res, 200, { ok: false, code: 'system-error', message: String(err) })
    return
  }
  const ns = lstatMap(p)
  send(res, 200, { ok: true, mtimeMs: ns ? ns.mtimeMs : 0 })
}

function handlePrompts(req, res, body, ctx = {}) {
  if (body !== undefined && !(body !== null && typeof body === 'object' && !Array.isArray(body))) {
    send(res, 400, { ok: false, code: 'bad-request', message: 'body must be an object' })
    return
  }
  // 数据文件不可读（测试注入 promptsError 以验证该分支）→ system-error
  if (ctx.promptsError) {
    send(res, 200, { ok: false, code: 'system-error', message: 'prompt library unavailable: ' + ctx.promptsError })
    return
  }
  // 正常：source + items（\r\n 归一为 \n 在真实实现做；此处给样例）
  const items = (ctx.promptsItems || []).map((it) => ({
    id: it.id,
    name: it.name,
    description: (it.description || '').replace(/\r\n/g, '\n'),
    prompt: (it.prompt || '').replace(/\r\n/g, '\n'),
    emoji: it.emoji,
    group: it.group,
  }))
  const ok = {
    ok: true,
    source: { name: 'Cherry Studio agents-zh.json', url: 'https://github.com/CherryHQ/cherry-studio', license: 'AGPL-3.0' },
    items,
  }
  send(res, 200, ok)
}

// 导出纯函数供 §2.4 单测复用（同文件）
export { resolveDshHomeLocal, findProjectRootSync, ancestorChain, discoverInstructions, isDiscoveredPath }
export const constants = { MAX_BODY_BYTES, MAX_SOURCE_BYTES, INSTRUCTION_CANDIDATES, LOCAL_INSTRUCTION_CANDIDATES, PROJECT_ROOT_MARKERS }
