/**
 * custom-skin.js — 自定义皮肤：受控包导入校验（契约 + 高危能力 + 容量） + registry
 * + 试穿/应用/删除/恢复（无 React 依赖，自包含，不 import 其它 src 模块以免破坏 build 内联）。
 *
 * 受控导入（INTERFACE §3）：skin.json + client.js + a11y.css 一律当「纯数据」校验，
 * 校验通过才写 storage；绝不执行包内注释/字符串内容。校验「先全量通过再 commit」，
 * 任何失败不落地、不改当前外观。
 *
 * 构造参数：
 *   storage        — 必填，{ getItem, setItem, removeItem }（浏览器传 localStorage）
 *   builtinSkins   — 必填，内置皮肤 manifest 列表（构建期内联 __SKIN_MANIFEST__）
 *   validate       — 可选，function(clientText) 契约+高危校验，默认用包内实现；
 *                    浏览器可传 skin-engine 的 validateCustomBundle 以复用同一扫描器
 *   engine         — 可选，createSkinEngine 实例；提供时应用会真实 activateSkin 该 bundle
 *   applyToken     — 预留（未来 a11y 注入），当前不用
 */

export const STORAGE_CUSTOM = 'skin-gallery-custom-v1'
export const STORAGE_CUSTOM_APPLIED = 'skin-gallery-custom-applied-v1'
export const STORAGE_SKIN = 'skin-gallery-skin-v1'
export const TRACK_KEY = 'dsh-appearance-track-v1'
export const MAX_BUNDLE_B64 = 256 * 1024 // btoa 后字节上限
export const MAX_CUSTOM_COUNT = 8

/** 错误契约（INTERFACE §5）。 */
export const ERR = {
  INVALID_JSON: 'ERR_IMPORT_INVALID_JSON',
  MISSING_FILE: 'ERR_SKIN_MISSING_FILE',
  BAD_META: 'ERR_SKIN_BAD_META',
  CONTRACT: 'ERR_SKIN_CONTRACT',
  DANGEROUS: 'ERR_SKIN_DANGEROUS',
  SIZE: 'ERR_SKIN_SIZE',
  COUNT: 'ERR_SKIN_COUNT',
  ID_CONFLICT: 'ERR_THEME_ID_CONFLICT',
  UNKNOWN_ID: 'ERR_UNKNOWN_ID',
}

const ID_RE = /^[a-z0-9][a-z0-9-_]{0,63}$/

/** UTF-8 安全的 base64 编码（btoa 只接受 Latin-1，中文等需先经 TextEncoder 转 UTF-8 字节）。 */
function toBase64Utf8(str) {
  const bytes = typeof TextEncoder !== 'undefined'
    ? new TextEncoder().encode(str)
    : Buffer.from(str, 'utf8')
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}

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

function readCustomItems(storage) {
  try {
    const raw = storage.getItem(STORAGE_CUSTOM)
    const data = raw ? JSON.parse(raw) : null
    if (data && typeof data === 'object' && Array.isArray(data.items)) return data.items
  } catch { /* 损坏则按空 registry 处理 */ }
  return []
}

function writeCustomItems(storage, items) {
  try { storage.setItem(STORAGE_CUSTOM, JSON.stringify({ version: 1, items })) } catch {}
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

// ---- client.js 契约 + 高危静态校验（与 skin-engine.validateCustomBundle 同源逻辑）----
const CTX_WHITELIST = new Set(['effect', 'get'])
const DANGEROUS_PATTERNS = [
  'eval(', 'new Function(', 'import(', 'require(', '<script src=',
  'fetch(', 'XMLHttpRequest(', 'WebSocket(', 'localStorage', 'sessionStorage',
  'document.cookie', 'chrome.runtime',
]

function parenBalanced(text) {
  let depth = 0
  for (const ch of text) {
    if (ch === '(') depth++
    else if (ch === ')') { depth--; if (depth < 0) return false }
  }
  return depth === 0
}

/** 包内默认 JS 扫描器（可被 createCustomSkinApi 的 validate 参数覆盖以复用引擎副本）。 */
export function validateBundle(clientText) {
  if (typeof clientText !== 'string' || clientText.length === 0) {
    throw fail(ERR.CONTRACT, 'client.js 为空或缺失')
  }
  const hasLoader = clientText.includes('window.__ModuleLoader__.load({') && clientText.includes('factory')
  if (!hasLoader || !parenBalanced(clientText)) {
    throw fail(ERR.CONTRACT, '缺失 __ModuleLoader__.load 契约或括号不配平')
  }
  for (const pat of DANGEROUS_PATTERNS) {
    if (clientText.includes(pat)) throw fail(ERR.DANGEROUS, `client.js 含高危能力: ${pat}`)
  }
  if (!/\bapply\s*(\{|:)/.test(clientText) && !/function\s+apply/.test(clientText)) {
    throw fail(ERR.CONTRACT, 'client.js 未导出 apply')
  }
  const ctxRe = /ctx\.([A-Za-z_$][\w$]*)/g
  let m
  const bad = []
  while ((m = ctxRe.exec(clientText)) !== null) {
    if (!CTX_WHITELIST.has(m[1])) bad.push(m[1])
  }
  if (bad.length > 0) throw fail(ERR.CONTRACT, `apply 使用白名单外 ctx.${bad[0]}`)
  return true
}

/** 校验 skin.json 元数据；通过返回归一化元数据，否则抛带 code 的错。 */
function validateSkinMeta(skinText, builtinIds) {
  let parsed
  try {
    parsed = JSON.parse(skinText)
  } catch {
    throw fail(ERR.INVALID_JSON, 'skin.json 解析失败')
  }
  if (typeof parsed !== 'object' || parsed === null) throw fail(ERR.INVALID_JSON, 'skin.json 必须是 JSON 对象')
  const { id, name, author, license } = parsed
  if (typeof id !== 'string' || id.length === 0 || typeof name !== 'string' || name.length === 0 ||
    typeof author !== 'string' || author.length === 0 || typeof license !== 'string' || license.length === 0) {
    throw fail(ERR.BAD_META, 'skin.json 缺 id/name/author/license（author 与 license 必填）')
  }
  if (!ID_RE.test(id)) throw fail(ERR.BAD_META, `非法 id: ${id}`)
  if (builtinIds.includes(id)) throw fail(ERR.ID_CONFLICT, `id 与内置皮肤冲突: ${id}`)
  return {
    id, name, author, license,
    accent: typeof parsed.accent === 'string' ? parsed.accent : '',
    bodyAttr: typeof parsed.bodyAttr === 'string' ? parsed.bodyAttr : `data-dsh-${id}`,
    order: typeof parsed.order === 'number' ? parsed.order : undefined,
  }
}

/**
 * 创建自定义皮肤公开 API。返回扁平函数集（UI 即测试面，见 INTERFACE §4.2）。
 */
export function createCustomSkinApi({ storage, builtinSkins, validate, engine }) {
  if (!storage || typeof storage.getItem !== 'function') throw new Error('custom-skin: storage required')
  const builtinIds = (builtinSkins || []).map((s) => s.id)
  const validateBundleFn = typeof validate === 'function' ? validate : validateBundle

  // 归一化内置条目：确保 license/author/package 可读，且不带 source:'custom'。
  const builtinEntries = (builtinSkins || []).map((s) => ({
    id: s.id, name: s.name, nameEn: s.nameEn || '', author: s.author,
    tagline: s.tagline || '', accent: s.accent || '', bodyAttr: s.bodyAttr || `data-dsh-${s.id}`,
    order: s.order, package: s.package, license: s.license || 'BSD-3-Clause',
  }))

  function getCustomItems() {
    return readCustomItems(storage)
  }

  function buildSkinList() {
    const customs = getCustomItems().map((item) => ({
      id: item.id, name: item.name, nameEn: item.nameEn || '', author: item.author,
      license: item.license, accent: item.accent, bodyAttr: item.bodyAttr,
      order: item.order, package: item.id, source: 'custom', bundleText: item.bundleText, a11yText: item.a11yText || '',
    }))
    return builtinEntries.concat(customs)
  }

  function getSkins() {
    return buildSkinList().slice().sort((a, b) => a.order - b.order)
  }

  function findByCustomId(id) {
    return getCustomItems().find((item) => item.id === id) || null
  }

  /** 当前激活皮肤：自定义 applied 优先，否则内置 skin-v1；无则 { '', false }。 */
  function currentSkinState() {
    const customApplied = readScoped(storage, STORAGE_CUSTOM_APPLIED, '')
    if (customApplied && findByCustomId(customApplied)) return { skinId: customApplied, active: true }
    const builtinApplied = readScoped(storage, STORAGE_SKIN, '')
    if (builtinApplied && builtinIds.includes(builtinApplied)) return { skinId: builtinApplied, active: true }
    return { skinId: '', active: false }
  }

  function registerBundle(item) {
    // 接入真实引擎（可选）：注册动态 bundle 使其可被 activateSkin 执行。
    if (engine && typeof engine.registerCustomBundle === 'function') {
      engine.registerCustomBundle(item)
    }
  }

  function deactivateRuntime() {
    if (engine && typeof engine.deactivateSkin === 'function') engine.deactivateSkin()
  }

  async function importCustomSkin({ skin, client, a11y } = {}) {
    // 1) 缺文件
    if (!skin || !client || client.length === 0) throw fail(ERR.MISSING_FILE, '缺 skin.json 或 client.js')
    // 2) 元数据（含 id 冲突）
    const meta = validateSkinMeta(skin, builtinIds)
    // 3) 契约 + 高危
    validateBundleFn(client)
    // 4) 容量：UTF-8 安全的 btoa(皮肤元数据 + client) 不超 256KB
    const bundleSize = toBase64Utf8(skin + client).length
    if (bundleSize > MAX_BUNDLE_B64) throw fail(ERR.SIZE, '自定义皮肤包超 256KB')
    // 5) 数量：新增项后 ≤ 8
    const items = getCustomItems()
    const existing = items.some((x) => x.id === meta.id)
    if (!existing && items.length >= MAX_CUSTOM_COUNT) throw fail(ERR.COUNT, `自定义皮肤最多 ${MAX_CUSTOM_COUNT} 个`)
    // 6) 全量通过 → commit
    const item = {
      id: meta.id, name: meta.name, nameEn: meta.nameEn || '', author: meta.author,
      license: meta.license, accent: meta.accent, bodyAttr: meta.bodyAttr,
      order: typeof meta.order === 'number' ? meta.order : 100 + items.length,
      source: 'custom', bundleText: client, a11yText: typeof a11y === 'string' ? a11y : '',
    }
    const next = items.slice()
    const idx = items.findIndex((x) => x.id === meta.id)
    if (idx >= 0) next[idx] = item
    else next.push(item)
    writeCustomItems(storage, next)
    registerBundle(item)
    return { ...item }
  }

  function previewCustomSkin(id) {
    const item = findByCustomId(id)
    if (!item) throw fail(ERR.UNKNOWN_ID, `未知自定义皮肤: ${id}`)
    deactivateRuntime()
    registerBundle(item)
    if (engine && typeof engine.activateSkin === 'function') {
      const entry = getSkins().find((s) => s.id === id)
      if (entry) { void engine.activateSkin(entry) }
    }
    // preview 不写 applied 键（A3）
  }

  function applyCustomSkin(id) {
    const item = findByCustomId(id)
    if (!item) throw fail(ERR.UNKNOWN_ID, `未知自定义皮肤: ${id}`)
    deactivateRuntime()
    registerBundle(item)
    if (engine && typeof engine.activateSkin === 'function') {
      const entry = getSkins().find((s) => s.id === id)
      if (entry) { void engine.activateSkin(entry) }
    }
    writeScoped(storage, STORAGE_CUSTOM_APPLIED, id)
    writeScoped(storage, STORAGE_SKIN, '') // 清内置
    writeTrack(storage, 'skin')
  }

  function deleteCustomSkin(id) {
    if (builtinIds.includes(id)) return // 内置不可删（D5）
    const items = getCustomItems()
    if (!items.some((x) => x.id === id)) return
    writeCustomItems(storage, items.filter((x) => x.id !== id))
    const applied = readScoped(storage, STORAGE_CUSTOM_APPLIED, '')
    if (applied === id) {
      writeScoped(storage, STORAGE_CUSTOM_APPLIED, '')
      writeScoped(storage, STORAGE_SKIN, '') // 回 none
      writeTrack(storage, 'skin')
      deactivateRuntime()
    }
  }

  function restoreDefaultSkin() {
    writeCustomItems(storage, [])
    writeScoped(storage, STORAGE_CUSTOM_APPLIED, '')
    writeScoped(storage, STORAGE_SKIN, '')
    writeTrack(storage, 'skin')
    deactivateRuntime()
  }

  function activateSkin(id) {
    // 内置激活（现有语义保留）：激活 + 持久化
    if (!builtinIds.includes(id)) throw fail(ERR.UNKNOWN_ID, `未知内置皮肤: ${id}`)
    deactivateRuntime()
    if (engine && typeof engine.activateSkin === 'function') {
      const entry = getSkins().find((s) => s.id === id)
      if (entry) { void engine.activateSkin(entry) }
    }
    writeScoped(storage, STORAGE_SKIN, id)
    writeScoped(storage, STORAGE_CUSTOM_APPLIED, '')
    writeTrack(storage, 'skin')
  }

  function previewSkin(id) {
    if (!builtinIds.includes(id)) throw fail(ERR.UNKNOWN_ID, `未知内置皮肤: ${id}`)
    deactivateRuntime()
    if (engine && typeof engine.activateSkin === 'function') {
      const entry = getSkins().find((s) => s.id === id)
      if (entry) { void engine.activateSkin(entry) }
    }
  }

  function clearSkin() {
    writeScoped(storage, STORAGE_SKIN, '')
    writeScoped(storage, STORAGE_CUSTOM_APPLIED, '')
    deactivateRuntime()
  }

  function teardownSkins() {
    // 只清运行时副作用，不删 storage registry（INTERFACE §3.6）
    if (engine && typeof engine.teardownSkins === 'function') engine.teardownSkins()
  }

  function getAppearanceTrack() {
    return readTrack(storage)
  }

  return {
    importCustomSkin,
    previewCustomSkin,
    applyCustomSkin,
    deleteCustomSkin,
    restoreDefaultSkin,
    getSkins,
    currentSkinState,
    registerCustomBundle: registerBundle,
    teardownSkins,
    activateSkin,
    previewSkin,
    applySkin: activateSkin,
    clearSkin,
    getAppearanceTrack,
  }
}
