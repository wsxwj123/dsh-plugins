/**
 * custom-skin.js — 自定义皮肤：受控包导入校验（契约 + 高危能力 + 容量） + registry
 * + 试穿/应用/删除/恢复（无 React 依赖，自包含，不 import 其它 src 模块以免破坏 build 内联）。
 *
 * 受控导入（INTERFACE §3）：skin.json + client.js + a11y.css 一律当「纯数据」校验，
 * 校验通过才写 storage；绝不执行包内注释/字符串内容。校验「先全量通过再 commit」，
 * 任何失败不落地、不改当前外观。
 *
 * 构造参数：
 *   storage        — 必填，{ getItem, setItem, removeItem }（浏览器传浏览器存储对象）
 *   builtinSkins   — 必填，内置皮肤 manifest 列表（构建期内联 __SKIN_MANIFEST__）
 *   validate       — 可选，function(clientText) 契约+高危校验，默认用包内实现；
 *                    浏览器可传 skin-engine 的 validateCustomBundle 以复用同一扫描器
 *   engine         — 可选，createSkinEngine 实例；提供时应用会真实 activateSkin 该 bundle
 *   applyToken     — 预留（未来 a11y 注入），当前不用
 */

// 键名带 skin-gallery 旧前缀是刻意的：老用户已导入的皮肤全文就存在这些键里，
// 改名 = 老用户丢数据（PLAN R6 失败模式 3）。合并进 appearance-gallery 后仍不许改。
export const SKIN_STORAGE_CUSTOM = 'skin-gallery-custom-v1'
export const SKIN_STORAGE_CUSTOM_APPLIED = 'skin-gallery-custom-applied-v1'
export const STORAGE_SKIN = 'skin-gallery-skin-v1'
export const SKIN_TRACK_KEY = 'dsh-appearance-track-v1'
export const MAX_BUNDLE_B64 = 262144 // btoa 后字节上限（256 KB，对外承诺常量）
export const MAX_CUSTOM_COUNT = 8
// a11y.css 独立门禁（INTERFACE §3.7）：a11y 文本不计入 256 KB 却与 bundleText 一起整文进
// 浏览器存储，无上限时一份超大 a11y 能顶爆整域配额，连带让已有主题/皮肤写不进去。
export const MAX_A11Y_BYTES = 65536

/** 错误契约（INTERFACE §5）。 */
export const SKIN_ERR = {
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

const SKIN_ID_RE = /^[a-z0-9][a-z0-9-_]{0,63}$/
// A7-2：bodyAttr 会被直接喂给 body.removeAttribute() 与 querySelectorAll('[' + attr + ']')，
// 非法属性名会在激活/卸载路径上抛 InvalidCharacterError / 选择器 SyntaxError。
const BODY_ATTR_RE = /^data-[a-z0-9-]{1,64}$/
// A7-4：a11y 的 url() 只允许 data: 与同目录相对路径；下列前缀一律拒（含 UNC 与 file:）。
const A11Y_URL_BLOCKED = ['http', '//', '\\\\', 'file:', 'ftp', 'ws']

/** UTF-8 安全的 base64 编码（btoa 只接受 Latin-1，中文等需先经 TextEncoder 转 UTF-8 字节）。 */
function toBase64Utf8(str) {
  const bytes = typeof TextEncoder !== 'undefined'
    ? new TextEncoder().encode(str)
    : Buffer.from(str, 'utf8')
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}

function skinFail(code, message) {
  const err = new Error(message)
  err.code = code
  return err
}

function readSkinTrack(storage) {
  try {
    const raw = storage.getItem(SKIN_TRACK_KEY)
    return raw === 'theme' || raw === 'skin' ? raw : ''
  } catch { return '' }
}

function writeSkinTrack(storage, value) {
  try {
    if (value === 'theme' || value === 'skin') storage.setItem(SKIN_TRACK_KEY, value)
    else storage.removeItem(SKIN_TRACK_KEY)
  } catch { /* 存储不可用则忽略 */ }
}

// 解析记忆化（PLAN G5）：registry 原文未变就复用上次的 parse 结果。registry 里存的是皮肤
// client.js 全文（可达 MB 级），一次 render 原本至少全量 parse 两遍。按 raw 比对而不是
// 「写时失效」，跨标签页改动也不会读到脏数据。主题侧另有一份同形状实现（custom-theme.js）。
const skinParseMemo = new WeakMap()

function readSkinItems(storage) {
  let raw = null
  try { raw = storage.getItem(SKIN_STORAGE_CUSTOM) } catch { return [] }
  const memo = skinParseMemo.get(storage)
  if (memo !== undefined && memo.raw === raw) return memo.items
  let items = []
  try {
    const data = raw ? JSON.parse(raw) : null
    if (data && typeof data === 'object' && Array.isArray(data.items)) items = data.items
  } catch { /* 损坏则按空 registry 处理 */ }
  skinParseMemo.set(storage, { raw, items })
  return items
}

function writeSkinItems(storage, items) {
  try { storage.setItem(SKIN_STORAGE_CUSTOM, JSON.stringify({ version: 1, items })) } catch {}
  skinParseMemo.delete(storage) // 写后作废，下一次读重新解析
}

/** 剥前导 UTF-8 BOM（INTERFACE §3.7 第 2 步）；只对要 JSON.parse 的 skin.json 文本用。 */
function stripSkinBom(text) {
  return typeof text === 'string' && text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

function readSkinScoped(storage, key, fallback = '') {
  try { return storage.getItem(key) || fallback } catch { return fallback }
}

function writeSkinScoped(storage, key, value) {
  try { storage.setItem(key, value) } catch {}
}

function removeSkinScoped(storage, key) {
  try { storage.removeItem(key) } catch {}
}

// ---- client.js 契约 + 高危静态校验（与 skin-engine.validateCustomBundle 同源逻辑）----
const CTX_WHITELIST = ['effect', 'get']
const DANGEROUS_PATTERNS = [
  'eval(', 'new Function(', 'import(', 'require(', '<script src=',
  'fetch(', 'XMLHttpRequest(', 'WebSocket(', 'localStorage', 'sessionStorage',
  'document.cookie', 'chrome.runtime',
]

/**
 * 浏览器 storage 句柄。刻意放在本文件（而不是 client.js）：12 条黑名单的静态门禁按
 * 「首次出现顺序」断言，把这个全局引用留在黑名单数组之后，才不会打乱那条顺序断言。
 */
export function browserStorage() {
  try { return localStorage } catch { return null }
}

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
    throw skinFail(SKIN_ERR.CONTRACT, 'client.js 为空或缺失')
  }
  const hasLoader = clientText.includes('window.__ModuleLoader__.load({') && clientText.includes('factory')
  if (!hasLoader || !parenBalanced(clientText)) {
    throw skinFail(SKIN_ERR.CONTRACT, '缺失 __ModuleLoader__.load 契约或括号不配平')
  }
  for (const pat of DANGEROUS_PATTERNS) {
    if (clientText.includes(pat)) throw skinFail(SKIN_ERR.DANGEROUS, `client.js 含高危能力: ${pat}`)
  }
  if (!/\bapply\s*(\{|:)/.test(clientText) && !/function\s+apply/.test(clientText)) {
    throw skinFail(SKIN_ERR.CONTRACT, 'client.js 未导出 apply')
  }
  const ctxRe = /ctx\.([A-Za-z_$][\w$]*)/g
  let m
  const bad = []
  while ((m = ctxRe.exec(clientText)) !== null) {
    if (!CTX_WHITELIST.includes(m[1])) bad.push(m[1])
  }
  if (bad.length > 0) throw skinFail(SKIN_ERR.CONTRACT, `apply 使用白名单外 ctx.${bad[0]}`)
  return true
}

/**
 * a11y.css 门禁（INTERFACE §3.7）：长度上限 + 禁 @import + 禁远程/本地文件 url()。
 * 非字符串按缺省处理（沿用现状的静默降级，不新增错误码）。
 */
function validateA11y(a11yText) {
  if (typeof a11yText !== 'string' || a11yText.length === 0) return ''
  const bytes = typeof TextEncoder !== 'undefined'
    ? new TextEncoder().encode(a11yText).length
    : Buffer.byteLength(a11yText, 'utf8')
  if (bytes > MAX_A11Y_BYTES) throw skinFail(SKIN_ERR.SIZE, `a11y.css 超 ${MAX_A11Y_BYTES} 字节`)
  if (a11yText.includes('@import')) throw skinFail(SKIN_ERR.DANGEROUS, 'a11y.css 禁止 @import')
  // url( 后允许引号与空白，再比对被禁前缀
  const urlRe = /url\(\s*['"]?\s*([^'")]*)/gi
  let hit
  while ((hit = urlRe.exec(a11yText)) !== null) {
    const target = hit[1]
    for (const prefix of A11Y_URL_BLOCKED) {
      if (target.toLowerCase().startsWith(prefix)) {
        throw skinFail(SKIN_ERR.DANGEROUS, `a11y.css 含外部资源 url(${prefix}…)`)
      }
    }
  }
  return a11yText
}

/** 校验 skin.json 元数据；通过返回归一化元数据，否则抛带 code 的错。 */
function validateSkinMeta(skinText, builtinIds) {
  let parsed
  try {
    parsed = JSON.parse(stripSkinBom(skinText))
  } catch {
    throw skinFail(SKIN_ERR.INVALID_JSON, 'skin.json 解析失败')
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw skinFail(SKIN_ERR.INVALID_JSON, 'skin.json 必须是 JSON 对象')
  }
  const { id, name, author, license } = parsed
  if (typeof id !== 'string' || id.length === 0 || typeof name !== 'string' || name.length === 0 ||
    typeof author !== 'string' || author.length === 0 || typeof license !== 'string' || license.length === 0) {
    throw skinFail(SKIN_ERR.BAD_META, 'skin.json 缺 id/name/author/license（author 与 license 必填）')
  }
  if (!SKIN_ID_RE.test(id)) throw skinFail(SKIN_ERR.BAD_META, `非法 id: ${id}`)
  // A7-2：bodyAttr 只要存在（!== undefined）即进入格式检查，非字符串同样判 BAD_META
  if (parsed.bodyAttr !== undefined &&
    (typeof parsed.bodyAttr !== 'string' || !BODY_ATTR_RE.test(parsed.bodyAttr))) {
    throw skinFail(SKIN_ERR.BAD_META, `非法 bodyAttr: ${String(parsed.bodyAttr)}`)
  }
  if (builtinIds.includes(id)) throw skinFail(SKIN_ERR.ID_CONFLICT, `id 与内置皮肤冲突: ${id}`)
  return {
    id, name, author, license,
    nameEn: typeof parsed.nameEn === 'string' ? parsed.nameEn : '',
    tagline: typeof parsed.tagline === 'string' ? parsed.tagline : '',
    accent: typeof parsed.accent === 'string' ? parsed.accent : '',
    bodyAttr: typeof parsed.bodyAttr === 'string' ? parsed.bodyAttr : `data-dsh-${id}`,
    order: typeof parsed.order === 'number' ? parsed.order : undefined,
  }
}

/**
 * 创建自定义皮肤公开 API。返回扁平函数集（UI 即测试面，见 INTERFACE §4.2）。
 */
export function createCustomSkinApi({ storage, builtinSkins, validate, engine, isLiveSkin, activate }) {
  if (!storage || typeof storage.getItem !== 'function') throw new Error('custom-skin: storage required')
  const builtinIds = (builtinSkins || []).map((s) => s.id)
  const validateBundleFn = typeof validate === 'function' ? validate : validateBundle
  // 真实激活由 apply 层注入（带串行化闸 + a11y 注入）；缺省退回引擎直连，纯逻辑测试可省略。
  const activateEntry = typeof activate === 'function'
    ? activate
    : async (entry) => {
      if (engine && typeof engine.activateSkin === 'function') await engine.activateSkin(entry)
    }
  // 「被覆盖的 id 是否正生效」——applied 键之外还要算上试穿中的那个（apply 层注入）
  const isLive = typeof isLiveSkin === 'function'
    ? isLiveSkin
    : (id) => readSkinScoped(storage, SKIN_STORAGE_CUSTOM_APPLIED, '') === id

  // 归一化内置条目：确保 license/author/package 可读，且不带 source:'custom'。
  const builtinEntries = (builtinSkins || []).map((s) => ({
    id: s.id, name: s.name, nameEn: s.nameEn || '', author: s.author,
    tagline: s.tagline || '', accent: s.accent || '', bodyAttr: s.bodyAttr || `data-dsh-${s.id}`,
    order: s.order, package: s.package, license: s.license || 'BSD-3-Clause',
  }))

  function getCustomItems() {
    return readSkinItems(storage)
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

  /** 只要自定义项（面板的删除清单与验收面都按这个口径读）。 */
  function getCustomSkins() {
    return getCustomItems().map((item) => ({
      id: item.id, name: item.name, nameEn: item.nameEn || '', author: item.author,
      license: item.license, accent: item.accent, bodyAttr: item.bodyAttr,
      order: item.order, package: item.id, source: 'custom',
      bundleText: item.bundleText, a11yText: item.a11yText || '',
    }))
  }

  function findByCustomId(id) {
    return getCustomItems().find((item) => item.id === id) || null
  }

  /** 当前激活皮肤：自定义 applied 优先，否则内置 skin-v1；无则 { '', false }。 */
  function currentSkinState() {
    const customApplied = readSkinScoped(storage, SKIN_STORAGE_CUSTOM_APPLIED, '')
    if (customApplied && findByCustomId(customApplied)) return { skinId: customApplied, active: true }
    const builtinApplied = readSkinScoped(storage, STORAGE_SKIN, '')
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
    // 校验顺序即 INTERFACE §3.7 的 1–14 步，短路在第一处失败；全量通过才 commit。
    // 1) 缺文件
    if (!skin || !client || client.length === 0) throw skinFail(SKIN_ERR.MISSING_FILE, '缺 skin.json 或 client.js')
    // 2–5) 元数据（含 BOM 剥离、id 正则、bodyAttr 正则、id 冲突）
    const meta = validateSkinMeta(skin, builtinIds)
    // 6–10) 契约 + 高危
    validateBundleFn(client)
    // 11) 容量：UTF-8 安全的 btoa(皮肤元数据 + client) 不超 256KB
    const bundleSize = toBase64Utf8(skin + client).length
    if (bundleSize > MAX_BUNDLE_B64) throw skinFail(SKIN_ERR.SIZE, '自定义皮肤包超 256KB')
    // 12–13) a11y 长度 / @import / 外部 url()
    const a11yText = validateA11y(a11y)
    // 14) 数量：新增项后 ≤ 8
    const items = getCustomItems()
    const existing = items.some((x) => x.id === meta.id)
    if (!existing && items.length >= MAX_CUSTOM_COUNT) throw skinFail(SKIN_ERR.COUNT, `自定义皮肤最多 ${MAX_CUSTOM_COUNT} 个`)
    // 全量通过 → commit
    const item = {
      id: meta.id, name: meta.name, nameEn: meta.nameEn || '', author: meta.author,
      license: meta.license, accent: meta.accent, bodyAttr: meta.bodyAttr,
      order: typeof meta.order === 'number' ? meta.order : 100 + items.length,
      source: 'custom', bundleText: client, a11yText,
    }
    const next = items.slice()
    const idx = items.findIndex((x) => x.id === meta.id)
    if (idx >= 0) next[idx] = item
    else next.push(item)
    writeSkinItems(storage, next)
    registerBundle(item)
    // 覆盖的正是当前生效项（applied 或试穿中）→ 立刻用新 bundle 重激活，
    // 否则开发者「改代码→重新导入」看不到变化（INTERFACE §3.7 覆盖语义）。
    if (isLive(item.id)) {
      deactivateRuntime() // invalidate 掉旧 bundle，否则引擎对同 id 是幂等 no-op，新代码不会跑
      await applyCustomSkin(item.id)
    }
    return { ...item }
  }

  async function previewCustomSkin(id) {
    const item = findByCustomId(id)
    if (!item) throw skinFail(SKIN_ERR.UNKNOWN_ID, `未知自定义皮肤: ${id}`)
    registerBundle(item)
    const entry = getSkins().find((s) => s.id === id)
    if (entry) await activateEntry(entry)
    // preview 不写 applied 键（刷新即丢、关面板即撤销）
  }

  async function applyCustomSkin(id) {
    const item = findByCustomId(id)
    if (!item) throw skinFail(SKIN_ERR.UNKNOWN_ID, `未知自定义皮肤: ${id}`)
    registerBundle(item)
    const entry = getSkins().find((s) => s.id === id)
    if (entry) await activateEntry(entry) // 失败即抛，下面的 applied 键不写
    writeSkinScoped(storage, SKIN_STORAGE_CUSTOM_APPLIED, id)
    writeSkinScoped(storage, STORAGE_SKIN, '') // 清内置
    writeSkinTrack(storage, 'skin')
  }

  function deleteCustomSkin(id) {
    if (builtinIds.includes(id)) return // 内置不可删（D5）
    const items = getCustomItems()
    if (!items.some((x) => x.id === id)) return
    writeSkinItems(storage, items.filter((x) => x.id !== id))
    const applied = readSkinScoped(storage, SKIN_STORAGE_CUSTOM_APPLIED, '')
    if (applied === id) {
      writeSkinScoped(storage, SKIN_STORAGE_CUSTOM_APPLIED, '')
      writeSkinScoped(storage, STORAGE_SKIN, '') // 回 none
      writeSkinTrack(storage, 'skin')
      deactivateRuntime()
    }
  }

  function restoreDefaultSkin() {
    writeSkinItems(storage, [])
    writeSkinScoped(storage, SKIN_STORAGE_CUSTOM_APPLIED, '')
    writeSkinScoped(storage, STORAGE_SKIN, '')
    writeSkinTrack(storage, 'skin')
    deactivateRuntime()
  }

  async function activateSkin(id) {
    // 内置激活（现有语义保留）：激活 + 持久化。未知 id 抛错，与主题内置的静默 no-op 刻意不同。
    if (!builtinIds.includes(id)) throw skinFail(SKIN_ERR.UNKNOWN_ID, `未知内置皮肤: ${id}`)
    const entry = getSkins().find((s) => s.id === id)
    if (entry) await activateEntry(entry) // 失败即抛，下面的 applied 键不写
    writeSkinScoped(storage, STORAGE_SKIN, id)
    writeSkinScoped(storage, SKIN_STORAGE_CUSTOM_APPLIED, '')
    writeSkinTrack(storage, 'skin')
  }

  async function previewSkin(id) {
    if (!builtinIds.includes(id)) throw skinFail(SKIN_ERR.UNKNOWN_ID, `未知内置皮肤: ${id}`)
    const entry = getSkins().find((s) => s.id === id)
    if (entry) await activateEntry(entry)
  }

  function clearSkin() {
    removeSkinScoped(storage, STORAGE_SKIN) // §3.4：clearSkin 走 removeItem
    deactivateRuntime()
  }

  function teardownSkins() {
    // 只清运行时副作用，不删 storage registry（INTERFACE §3.6）
    if (engine && typeof engine.teardownSkins === 'function') engine.teardownSkins()
  }

  function getAppearanceTrack() {
    return readSkinTrack(storage)
  }

  return {
    importCustomSkin,
    previewCustomSkin,
    applyCustomSkin,
    deleteCustomSkin,
    restoreDefaultSkin,
    getSkins,
    getCustomSkins,
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

// 模块级标识符带 SKIN_ 前缀是为了让 build.mjs 把本文件与 custom-theme.js 拼进同一个
// factory 作用域时不撞名（两侧都要有 STORAGE_CUSTOM / TRACK_KEY / ERR）。
// 对外（ESM import 与 INTERFACE §3.9 导出清单）仍是不带前缀的契约名。
export {
  SKIN_STORAGE_CUSTOM as STORAGE_CUSTOM,
  SKIN_STORAGE_CUSTOM_APPLIED as STORAGE_CUSTOM_APPLIED,
  SKIN_TRACK_KEY as TRACK_KEY,
  SKIN_ERR as ERR,
}
