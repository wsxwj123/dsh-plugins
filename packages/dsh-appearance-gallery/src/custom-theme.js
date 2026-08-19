/**
 * custom-theme.js — 自定义主题：JSON 导入校验 + registry + 试穿/应用/删除/恢复（无 React 依赖）。
 *
 * CSS-only 设计：整个导入只做 JSON.parse + 字段校验 + CSS 变量注入，绝不执行 JS。
 * 校验「先全量通过再 commit」：任何失败不落地、不改当前外观。
 * 存储键见 INTERFACE §1.2；轨道互斥写键 dsh-appearance-track-v1 见 INTERFACE §3.6。
 *
 * 本文件自包含（不在文件内 import 其它 src 模块，以免破坏 build 内联），
 * 轨道键读写以本地小助手实现，与 skin-gallery 侧同键（dsh-appearance-track-v1）同语义。
 *
 * 构造参数：
 *   storage        — 必填，{ getItem, setItem, removeItem }（浏览器传浏览器存储对象，测试传内存替身）
 *   builtinThemes  — 必填，内置主题数组，每项至少含 { id, label }（浏览器传 THEME_FAMILIES）
 *   applyTokens    — 可选，function(tokens) 在试穿/应用时被调用，浏览器接线到 themeService.overrideTokens；
 *                    纯逻辑测试省略。
 */

export const STORAGE_CUSTOM = 'theme-gallery-custom-v1'
export const STORAGE_CUSTOM_APPLIED = 'theme-gallery-custom-applied-v1'
export const STORAGE_FAMILY = 'theme-gallery-family-v5'
// 私有标记：用户是否已主动选择过外观（含切到内置兜底）。区分
// 「未触碰的原生 jade 默认 → getCustomAppliedId 返回 null」与
// 「删除 applied 自定义项后显式回 jade → 返回 'jade'」两种同底层状态。
export const STORAGE_TOUCHED = 'theme-gallery-custom-touched-v1'
export const TRACK_KEY = 'dsh-appearance-track-v1'
export const DEFAULT_THEME_ID = 'jade'

/** 错误契约：统一 { code, message }，导入/操作失败不改当前外观。 */
export const ERR = {
  INVALID_JSON: 'ERR_IMPORT_INVALID_JSON',
  MISSING_FIELD: 'ERR_THEME_MISSING_FIELD',
  BAD_TOKEN: 'ERR_THEME_BAD_TOKEN',
  ID_CONFLICT: 'ERR_THEME_ID_CONFLICT',
  UNKNOWN_ID: 'ERR_UNKNOWN_ID',
}

const ID_RE = /^[a-z0-9][a-z0-9-_]{0,63}$/

function fail(code, message) {
  const err = new Error(message)
  err.code = code
  return err
}

function readTrack(storage) {
  try {
    const raw = storage.getItem(TRACK_KEY)
    return raw === 'theme' || raw === 'skin' ? raw : ''
  } catch { return '' }
}

function writeTrack(storage, value) {
  try {
    if (value === 'theme' || value === 'skin') storage.setItem(TRACK_KEY, value)
    else storage.removeItem(TRACK_KEY)
  } catch { /* 存储不可用则忽略 */ }
}

// 解析记忆化（PLAN G5）：registry 原文未变就复用上次的 parse 结果。
// 按 raw 字符串比对而不是「写时失效」——跨标签页改动也不会读到脏数据。
// 皮肤侧另有一份同形状实现（custom-skin.js），刻意不抽公共 helper：抽了要新增文件并改
// build 拼接顺序，收益不抵；两侧各有一条 P6 单测防「改一边忘一边」。
const themeParseMemo = new WeakMap()

function readCustomItems(storage) {
  let raw = null
  try { raw = storage.getItem(STORAGE_CUSTOM) } catch { return [] }
  const memo = themeParseMemo.get(storage)
  if (memo !== undefined && memo.raw === raw) return memo.items
  let items = []
  try {
    const data = raw ? JSON.parse(raw) : null
    if (data && typeof data === 'object' && Array.isArray(data.items)) items = data.items
  } catch { /* 损坏则按空 registry 处理 */ }
  themeParseMemo.set(storage, { raw, items })
  return items
}

function writeCustomItems(storage, items) {
  try { storage.setItem(STORAGE_CUSTOM, JSON.stringify({ version: 1, items })) } catch {}
  themeParseMemo.delete(storage) // 写后作废，下一次读重新解析
}

/**
 * 剥前导 UTF-8 BOM（INTERFACE §3.6 第 0 步）：Windows 记事本 / PowerShell `>` 重定向默认写 BOM，
 * 不剥就让用户拿到一个看不懂的 JSON 错。纯容错，不放松任何安全闸——BOM 不携带语义。
 * 只对要 JSON.parse 的文本剥；client.js / a11y.css 一律不动。
 */
function stripBom(text) {
  return typeof text === 'string' && text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

function readScoped(storage, key, fallback = '') {
  try { return storage.getItem(key) || fallback } catch { return fallback }
}

function writeScoped(storage, key, value) {
  try { storage.setItem(key, value) } catch {}
}

function removeScoped(storage, key) {
  try { storage.removeItem(key) } catch {}
}

/** 校验单个 token：键必须以 `--dsw-` 开头，值是 { light, dark } 非空字符串。 */
function isValidToken(key, value) {
  if (typeof key !== 'string' || !key.startsWith('--dsw-')) return false
  if (!value || typeof value !== 'object') return false
  return typeof value.light === 'string' && value.light.length > 0 &&
    typeof value.dark === 'string' && value.dark.length > 0
}

function sanitizeValue(str) {
  const s = String(str)
  // CSS 变量值为字符串字面量；防「拼错成 rule」：拒绝含右花括号或形如 `;xxx` 的内容。
  if (s.includes('}') || (s.includes(';') && s.indexOf(';') < s.length - 1)) {
    throw fail(ERR.BAD_TOKEN, 'token 值含危险字符')
  }
  return s
}

/** 全量校验主题 JSON 形状；通过则返回归一化条目，否则抛带 code 的错。 */
export function validateTheme(jsonText, builtinIds) {
  let parsed
  try {
    parsed = JSON.parse(stripBom(jsonText))
  } catch {
    throw fail(ERR.INVALID_JSON, 'JSON 解析失败')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw fail(ERR.INVALID_JSON, '主题必须是 JSON 对象')
  }
  const { id, label, tokens } = parsed
  if (typeof id !== 'string' || id.length === 0 || typeof label !== 'string' || label.length === 0 ||
    !tokens || typeof tokens !== 'object' || Array.isArray(tokens) || Object.keys(tokens).length === 0) {
    throw fail(ERR.MISSING_FIELD, '主题必须含非空 id / label / tokens')
  }
  if (!ID_RE.test(id)) throw fail(ERR.MISSING_FIELD, `非法 id: ${id}`)
  if (label.length > 80) throw fail(ERR.MISSING_FIELD, 'label 不能超过 80 字符')
  if ((builtinIds || []).includes(id)) {
    throw fail(ERR.ID_CONFLICT, `id 与内置主题冲突: ${id}`)
  }
  const cleanTokens = {}
  for (const [key, value] of Object.entries(tokens)) {
    if (!isValidToken(key, value)) throw fail(ERR.BAD_TOKEN, `非法 token: ${key}`)
    cleanTokens[key] = { light: sanitizeValue(value.light), dark: sanitizeValue(value.dark) }
  }
  return { id, label, tokens: cleanTokens }
}

/** 创建自定义主题公开 API。返回扁平函数集（UI 即测试面，见 INTERFACE §4.1）。 */
export function createCustomThemeApi({ storage, builtinThemes, applyTokens }) {
  if (!storage || typeof storage.getItem !== 'function') throw new Error('custom-theme: storage required')
  const builtinIds = (builtinThemes || []).map((t) => t.id)

  function resolveBuiltin(id) {
    return (builtinThemes || []).find((t) => t.id === id) || null
  }

  /** 应用某外观（内置或自定义）的 token override；浏览器接线真实 themeService。 */
  function paint(tokens, themeId) {
    if (typeof applyTokens === 'function') applyTokens(tokens, themeId)
  }

  function getThemes() {
    return (builtinThemes || []).map((t) => ({ id: t.id, label: t.label }))
  }

  function getCustomThemes() {
    return readCustomItems(storage).map((item) => ({ id: item.id, label: item.label, tokens: item.tokens }))
  }

  function findByCustomId(id) {
    return readCustomItems(storage).find((item) => item.id === id) || null
  }

  /** 当前生效外观 id：自定义 applied 优先；未触碰的原生默认返回 null，已触碰则回内置 family。 */
  function getCustomAppliedId() {
    const applied = readScoped(storage, STORAGE_CUSTOM_APPLIED, '')
    if (applied && findByCustomId(applied)) return applied
    const touched = readScoped(storage, STORAGE_TOUCHED, '') === '1'
    if (!touched) return null
    return readScoped(storage, STORAGE_FAMILY, DEFAULT_THEME_ID) || DEFAULT_THEME_ID
  }

  async function importCustomTheme(jsonText) {
    const item = validateTheme(jsonText, builtinIds) // 先全量校验，失败即抛
    const items = readCustomItems(storage)
    const idx = items.findIndex((x) => x.id === item.id)
    const next = items.slice()
    if (idx >= 0) next[idx] = item // 重复 id 覆盖（保留原位）
    else next.push(item)
    writeCustomItems(storage, next) // 校验通过才 commit
    return { id: item.id, label: item.label, tokens: item.tokens }
  }

  function previewCustomTheme(id) {
    const item = findByCustomId(id)
    if (!item) throw fail(ERR.UNKNOWN_ID, `未知自定义主题: ${id}`)
    paint(item.tokens, item.id) // 不写 applied 键（刷新即丢、关面板即撤销）
  }

  function applyCustomTheme(id) {
    const item = findByCustomId(id)
    if (!item) throw fail(ERR.UNKNOWN_ID, `未知自定义主题: ${id}`)
    paint(item.tokens, item.id)
    writeScoped(storage, STORAGE_CUSTOM_APPLIED, id)
    writeScoped(storage, STORAGE_FAMILY, '')
    writeScoped(storage, STORAGE_TOUCHED, '1')
    writeTrack(storage, 'theme')
  }

  function deleteCustomTheme(id) {
    if (builtinIds.includes(id)) return // 内置不可删（D5）
    const items = readCustomItems(storage)
    if (!items.some((x) => x.id === id)) return
    writeCustomItems(storage, items.filter((x) => x.id !== id))
    const applied = readScoped(storage, STORAGE_CUSTOM_APPLIED, '')
    if (applied === id) {
      // 删除正被应用的项 → 回内置默认 jade（D1）
      writeScoped(storage, STORAGE_CUSTOM_APPLIED, '')
      writeScoped(storage, STORAGE_FAMILY, DEFAULT_THEME_ID)
      writeScoped(storage, STORAGE_TOUCHED, '1')
      writeTrack(storage, 'theme')
      const jade = resolveBuiltin(DEFAULT_THEME_ID)
      if (jade) paint(jade.tokens, jade.id)
    }
  }

  function restoreDefaultTheme() {
    writeCustomItems(storage, [])
    writeScoped(storage, STORAGE_CUSTOM_APPLIED, '')
    writeScoped(storage, STORAGE_FAMILY, DEFAULT_THEME_ID)
    removeScoped(storage, STORAGE_TOUCHED)
    writeTrack(storage, 'theme')
    const jade = resolveBuiltin(DEFAULT_THEME_ID)
    if (jade) paint(jade.tokens, jade.id)
  }

  function activateFamily(id) {
    const family = resolveBuiltin(id)
    if (!family) return
    writeScoped(storage, STORAGE_CUSTOM_APPLIED, '')
    writeScoped(storage, STORAGE_FAMILY, id)
    writeScoped(storage, STORAGE_TOUCHED, '1')
    writeTrack(storage, 'theme')
    paint(family.tokens, family.id)
  }

  function getAppearanceTrack() {
    return readTrack(storage)
  }

  function setAppearanceTrack(value) {
    writeTrack(storage, value)
  }

  return {
    importCustomTheme,
    previewCustomTheme,
    applyCustomTheme,
    deleteCustomTheme,
    restoreDefaultTheme,
    getCustomThemes,
    getCustomAppliedId,
    getThemes,
    activateFamily,
    getAppearanceTrack,
    setAppearanceTrack,
  }
}
