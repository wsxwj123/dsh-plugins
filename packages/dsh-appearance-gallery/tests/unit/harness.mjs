/**
 * harness.mjs — 皮肤引擎单元测试底座。
 *
 * 提供一个满足官方 dsh-client-modules 契约的 fake 模块系统 + 最小 DOM stub，
 * 供测试在 Node 环境创建 createSkinEngine 并驱动真实皮肤 bundle 的
 * __ModuleLoader__.load → import(materialize) → apply 全链路。
 *
 * fake modules 契约（对齐 dsh-client-modules ClientModuleSystem）：
 *   - window.__ModuleLoader__ = { load({id, factory}) }：只注册，重复注册抛错。
 *   - import(spec)：seed → memoized → registered factory(materialize) → 抛错。
 *   - invalidate(id)：删 factory + cache。
 *   - materialize 时把 factory 执行后注入的 <style> 计入 styles 记录。
 *
 * 注意：这里的 system 是**直接注入**给 createSkinEngine 的（引擎只认参数，不读全局）。
 * 真实宿主里同一个实例，新宿主（≥ 0.1.0-rc.8）经 cordis service `ctx.modules` 拿，
 * 旧宿主经 `window.__DSH_MODULES__` 拿；那一层的取法在 apply 层，由
 * tests/unit/resolve-modules.test.mjs 单独覆盖，本底座不重复模拟。
 */

import { createRequire } from 'node:module'

// ---- fake window + ClientModuleSystem 替身（旧宿主形状：window.__DSH_MODULES__）----
export function createModules() {
  const seed = new Map()
  const factories = new Map()
  const loadCache = new Map()
  const styleRecords = new Map()
  const system = {
    loadCache,
    factories,
    seed,
    registerStatic(id, m) { seed.set(id, m) },
    import(specifier) {
      if (seed.has(specifier)) return seed.get(specifier)
      if (loadCache.has(specifier)) return loadCache.get(specifier)
      if (!factories.has(specifier)) throw new Error(`import: no factory for "${specifier}"`)
      const exports = factories.get(specifier)(makeRequire(system))
      loadCache.set(specifier, exports)
      return exports
    },
    invalidate(id) { factories.delete(id); loadCache.delete(id); styleRecords.delete(id) },
    _factories() { return factories },
    _styleRecords() { return styleRecords },
  }
  // window.__ModuleLoader__ loads a factory (registration only).
  const ModuleLoader = { load({ id, factory }) { if (factories.has(id)) throw new Error(`duplicate factory registration for "${id}"`); factories.set(id, factory) } }
  return { system, ModuleLoader, styleRecords }
}

function makeRequire(system) {
  return (spec) => {
    if (system.seed.has(spec)) return system.seed.get(spec)
    if (system.loadCache.has(spec)) return system.loadCache.get(spec)
    if (system.factories.has(spec)) { const ex = system.factories.get(spec)(makeRequire(system)); system.loadCache.set(spec, ex); return ex }
    throw new Error(`require: missed module table "${spec}"`)
  }
}

// camelCase -> kebab, 对齐浏览器 dataset 到 data-*/dataset 的映射。
function camelToKebab(s) { return s.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase()) }
function kebabToCamel(s) { return s.replace(/-([a-z])/g, (_, c) => c.toUpperCase()) }

// ---- minimal element ----
function makeElement(tag, registry) {
  const attrs = new Map()
  let datasetTarget = {}
  let detached = false
  const node = {
    tag,
    dataset: {},
    _running: typeof registry === 'function' ? registry : null,
    style: { setProperty() {}, getPropertyValue() { return '' }, removeProperty() {} },
    classList: { add() {}, remove() {}, contains() { return false } },
    _children: [],
    children: [],
    parentNode: null,
    attributes: new Map(),
    setAttribute(k, v) { attrs.set(k, String(v)); node.attributes.set(k, String(v)) },
    getAttribute(k) { return attrs.has(k) ? attrs.get(k) : null },
    hasAttribute(k) { return attrs.has(k) },
    removeAttribute(k) { attrs.delete(k); node.attributes.delete(k) },
    append(...els) {
      for (const e of els) { e.parentNode = node; node._children.push(e) }
      node.children = node._children
    },
    appendChild(e) { e.parentNode = node; node._children.push(e); node.children = node._children; return e },
    remove() {
      if (detached) return
      detached = true
      if (registry) { const i = registry.indexOf(node); if (i >= 0) registry.splice(i, 1) }
      const p = node.parentNode
      if (p) { p._children = p._children.filter((c) => c !== node); p.children = p._children; node.parentNode = null }
    },
    textContent: '',
    innerHTML: '',
    insertBefore() {},
    firstChild: null,
  }
  // dataset <=> data-* 属性 联动（对齐浏览器行为）：
  node.dataset = new Proxy(datasetTarget, {
    get(t, k) { return k in t ? t[k] : (attrs.get('data-' + camelToKebab(String(k))) ?? undefined) },
    set(t, k, v) {
      t[k] = v
      if (v === '' ) attrs.set('data-' + camelToKebab(String(k)), '')
      else if (typeof v !== 'undefined' && v !== null) attrs.set('data-' + camelToKebab(String(k)), String(v))
      else attrs.delete('data-' + camelToKebab(String(k)))
      node.attributes = attrs
      return true
    },
    deleteProperty(t, k) {
      delete t[k]
      attrs.delete('data-' + camelToKebab(String(k)))
      node.attributes = attrs
      return true
    },
  })
  return node
}

/** Minimal document: body with dataset, head; querySelector/S everything in-memory. */
export function createDoc() {
  const all = []
  const body = makeElement('body', all)
  const head = makeElement('head', all)
  body._ownStyles = []
  const document = {
    body,
    head,
    title: 'DSH',
    createElement(tag) { const el = makeElement(tag, all); all.push(el); return el },
    createTextNode(t) { return { textContent: String(t) } },
    querySelector(sel) { return queryAll(sel)[0] || null },
    querySelectorAll(sel) { return queryAll(sel) },
  }
  function queryAll(sel) {
    if (sel.includes(',')) {
      // 逗号复合选择器：取并集。
      const seen = new Set()
      const out = []
      for (const part of sel.split(',')) {
        for (const el of querySingle(part.trim())) {
          if (!seen.has(el)) { seen.add(el); out.push(el) }
        }
      }
      return out
    }
    return querySingle(sel)
  }
  function querySingle(sel) {
    if (sel === 'style') return all.filter((e) => e.tag === 'style')
    // 属性值选择器（支持 data-plugin / data-plugin-css / data-theme-gallery-a11y / 无值布尔属性）。
    const val = /^style\[([a-z0-9-]+)=["']?([^"']+)["']?\]$/.exec(sel)
    if (val) return all.filter((e) => e.tag === 'style' && e.getAttribute(val[1]) === val[2])
    const bool = /^style\[[a-z0-9-]+\]$/.exec(sel)
    if (bool) return all.filter((e) => e.tag === 'style' && e.hasAttribute(sel.slice(6, -1)))
    return [] // 其它选择器无匹配（浏览器语义：未知 attr 选择器无匹配元素）
  }
  return { document, all, queryAll }
}

/** Build a window-like global with modules + document + MutationObserver stub. */
export function makeWindow({ installModules = true } = {}) {
  const { document } = createDoc()
  const { system, ModuleLoader } = createModules()
  const win = {
    __DSH_MODULES__: system,
    __ModuleLoader__: ModuleLoader,
    document,
    MutationObserver: class { constructor(cb) { this.cb = cb } observe() {} disconnect() {} takeRecords() { return [] } },
  }
  if (installModules) {
    // 皮肤 bundle 只消费 window.__ModuleLoader__.load；__DSH_MODULES__ 留在 win 上是为了
    // 忠实还原旧宿主的 window 形状（新宿主该实例改由 ctx.modules 提供，引擎那层无差别）。
    win.globalThis = win
  }
  return win
}

/** 在给定的 window 全局执行一个 bundle 文本（等价 Blob script 注入）。 */
export function executeOnWindow(win, code) {
  const fn = new Function('window', 'globalThis', 'document', code)
  fn(win, win, win.document)
}

/** 等域 assert 助手。 */
export function assertMany(assert, pairs) {
  for (const [actual, expected, msg] of pairs) {
    assert.strictEqual(actual, expected, msg)
  }
}
