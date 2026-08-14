'use strict'

/**
 * summarizeToolInput：从 tool/call 的 arguments（JSON 字符串）提取精简安全摘要。
 *
 * 契约（INTERFACE §2.3）：
 *   - 按工具名前缀匹配，命中即用；未命中表项 → null（pet 兜底「运行中」）。
 *   - read/write/edit/insert/apply_patch → { file_path: basename(file_path|path) }
 *   - bash/shell/exec → { command: command|cmd 空格切首词 }
 *   - grep/search → { pattern: pattern|query 截断 24 }
 *   - web_search → { query: query 截断 22 }
 *   - 所有提取值额外截断 ≤24 字符；完整 arguments 绝不上外发路径。
 *   - 对象值缺省 / 非字符串 → null；非法 JSON → null。
 *   任何 (name, argumentsJSON) 组合都返回 object | null，不抛错。
 *
 * 模块仍沿用文件名 toolLabels.js（历史沿用，未改名）；职责已从「工具名→中文文案」
 * 改为「参数精简摘要提取」。唯一引用方是 agentWatcher.js。
 */

/** 截断到上限个 code unit（≤n 字符） */
function cap(value, n) {
  return value.length > n ? value.slice(0, n) : value
}

/** 取 args.file_path（或 .path）的 basename；非字符串/缺值 → null */
function pickBasename(args) {
  const raw = typeof args.file_path === 'string' ? args.file_path : typeof args.path === 'string' ? args.path : null
  if (raw === null) return null
  const base = raw.split('/').filter(Boolean).pop()
  if (base === undefined || base === '') return null
  return cap(base, 24)
}

/** 取 args.command（或 .cmd）空格切首词；非字符串/缺值 → null */
function pickCommand(args) {
  const raw = typeof args.command === 'string' ? args.command : typeof args.cmd === 'string' ? args.cmd : null
  if (raw === null) return null
  const words = raw.trim().split(/\s+/)
  const first = words[0]
  if (!first) return null
  return cap(first, 24)
}

/** 取 args.pattern（或 .query）截断 24；非字符串/缺值 → null */
function pickPattern(args) {
  const raw = typeof args.pattern === 'string' ? args.pattern : typeof args.query === 'string' ? args.query : null
  if (raw === null) return null
  return cap(raw, 24)
}

/** 取 args.query 截断 22；非字符串/缺值 → null */
function pickQuery(args) {
  const raw = typeof args.query === 'string' ? args.query : null
  if (raw === null) return null
  return cap(raw, 22)
}

const WRITE_PREFIXES = ['write', 'edit', 'insert', 'apply_patch']
const COMMAND_PREFIXES = ['bash', 'shell', 'exec']

/**
 * 提取 tool_input 精简安全摘要。
 * @param {string|undefined|null} name   原始工具名
 * @param {string|null|undefined} argsJSON  arguments 的 JSON 字符串
 * @returns {object|null}
 */
function summarizeToolInput(name, argsJSON) {
  if (typeof name !== 'string' || name.length === 0) return null
  if (typeof argsJSON !== 'string' || argsJSON.length === 0) return null

  let args
  try {
    args = JSON.parse(argsJSON)
  } catch (err) {
    return null // 非法 JSON：无摘要
  }
  if (typeof args !== 'object' || args === null || Array.isArray(args)) return null

  if (name.startsWith('read')) {
    const filePath = pickBasename(args)
    return filePath === null ? null : { file_path: filePath }
  }
  if (WRITE_PREFIXES.some((p) => name.startsWith(p))) {
    const filePath = pickBasename(args)
    return filePath === null ? null : { file_path: filePath }
  }
  if (COMMAND_PREFIXES.some((p) => name.startsWith(p))) {
    const command = pickCommand(args)
    return command === null ? null : { command: command }
  }
  if (name.startsWith('grep') || name.startsWith('search')) {
    const pattern = pickPattern(args)
    return pattern === null ? null : { pattern: pattern }
  }
  if (name.startsWith('web_search')) {
    const query = pickQuery(args)
    return query === null ? null : { query: query }
  }
  return null
}

module.exports = { summarizeToolInput }
