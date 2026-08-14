/**
 * client-harness.mjs — client.js 轨道协调逻辑的测试底座。
 *
 * client.js 经 build.mjs 拼接注入常量（__SKIN_MANIFEST__ / __SKIN_BUNDLES__ /
 * __SKIN_A11Y__ / THEME_FAMILIES / React）后由 __ModuleLoader__ 加载。本文件在 Node
 * 里复刻该注入，并配合 fake document/localStorage/ctx/themeService/slots，让测试能
 * 调用 client.js 暴露的轨道协调 API（globalThis.__TG_SURFACE__ 注入面）。
 */

import { readFile } from 'node:fs/promises'
import { makeWindow, executeOnWindow } from './harness.mjs'

const ROOT = new URL('../../', import.meta.url) // packages/theme-gallery/
const SKIN_ORDER = ['qq98', 'ths', 'xp', 'blue-fantasy', 'dragon-heir', 'minecraft', 'whale-song', 'trading', 'miku']
const readText = (rel) => readFile(new URL(rel, ROOT), 'utf8')
const runOnWin = (win, code) => executeOnWindow(win, code)

/** 构建真实 manifest（与 build.mjs 一致）。 */
export async function buildManifest() {
  const out = []
  for (const id of SKIN_ORDER) {
    const meta = JSON.parse(await readText(`skins/${id}/skin.json`))
    out.push({
      id: meta.id, name: meta.name, nameEn: meta.nameEn, author: meta.author,
      tagline: meta.tagline, accent: meta.accent, bodyAttr: meta.bodyAttr, order: meta.order,
      package: meta.package, bundleFile: `skins/${id}/client.js`, a11yFile: `skins/${id}/a11y.css`,
      license: 'BSD-3-Clause',
    })
  }
  return out.sort((a, b) => a.order - b.order)
}

/** null-safe localStorage stub。 */
export function createStorage(initial = {}) {
  const store = new Map(Object.entries(initial))
  return {
    _map: store,
    getItem(k) { return store.has(k) ? store.get(k) : null },
    setItem(k, v) { store.set(k, String(v)) },
    removeItem(k) { store.delete(k) },
    clear() { store.clear() },
  }
}

/** fake theme service：overrideTokens 记录调用并返回可逆 disposer。 */
export function createThemeService() {
  const overrides = []
  return {
    overrides,
    overrideTokens(scope, tokens) {
      overrides.push({ scope, tokens })
      let removed = false
      return () => {
        if (removed) return
        removed = true
        const i = overrides.findIndex((o) => o.scope === scope)
        if (i >= 0) overrides.splice(i, 1)
      }
    },
  }
}

/** fake slots service：inject/register 记录注册。 */
export function createSlotsService() {
  const registered = []
  return {
    registered,
    inject(target, fn) { return fn },
    register(meta, component) { registered.push({ meta, component }); return () => {} },
  }
}

/** 从 themes.curated.js 提取 THEME_FAMILIES 数组（该文件为纯常量定义，以 `]` 收束）。 */
export function extractFamilies(src) {
  const m = src.match(/const THEME_FAMILIES = (\[[\s\S]*\])/)
  if (!m) throw new Error('无法解析 THEME_FAMILIES')
  // eslint-disable-next-line no-new-func
  return new Function(`return ${m[1]}`)()
}

/**
 * 组装并执行 client.js，返回 apply/协调 API/服务/副作用追踪。
 * @param {object} opts
 *  - useRealBundles: 是否用真实皮肤 bundle 文本（默认 true）
 *  - bundlesOverride / a11yOverride / manifestOverride / familiesOverride / storageOverride
 */
export async function loadClient(opts = {}) {
  const {
    useRealBundles = true,
    bundlesOverride = null,
    a11yOverride = null,
    manifestOverride = null,
    familiesOverride = null,
    storageOverride = null,
    executeScript = null,
  } = opts

  const manifest = manifestOverride ?? await buildManifest()
  const bundlesMap = bundlesOverride ?? {}
  const a11yMap = a11yOverride ?? {}
  if (useRealBundles) {
    for (const id of SKIN_ORDER) {
      if (!(id in bundlesMap)) bundlesMap[id] = await readText(`skins/${id}/client.js`)
      if (!(id in a11yMap)) {
        try { a11yMap[id] = await readText(`skins/${id}/a11y.css`) } catch { a11yMap[id] = '' }
      }
    }
  }

  // 主题族 + React + 常量注入。
  const familiesList = familiesOverride ?? extractFamilies(await readText('src/themes.curated.js'))
  const storageObj = storageOverride ?? createStorage()

  const win = makeWindow()
  const modulesObj = win.__DSH_MODULES__
  const prior = {
    modules: globalThis.__DSH_MODULES__,
    storage: globalThis.localStorage,
    document: globalThis.document,
    surface: globalThis.__TG_SURFACE__,
    exec: globalThis.__TG_EXEC_SCRIPT__,
    mutationObserver: globalThis.MutationObserver,
  }
  globalThis.__DSH_MODULES__ = modulesObj
  globalThis.localStorage = storageObj
  globalThis.document = win.document
  // 皮肤 bundle（miku/xp/dragon-heir 等）裸用 MutationObserver；测试环境注入 stub。
  globalThis.MutationObserver = class { constructor() {} observe() {} disconnect() {} takeRecords() { return [] } }
  // 默认脚本执行：经 fake window 真实注册到 __ModuleLoader__；测试可覆盖。
  const effectiveExec = executeScript ?? ((code) => runOnWin(win, code))
  if (executeScript || true) globalThis.__TG_EXEC_SCRIPT__ = effectiveExec

  let surface = null
  globalThis.__TG_SURFACE__ = (api) => { surface = api }

  const clientSrc = await readText('src/client.js')
  const engineSrc = await readText('src/skin-engine.js')
  const a11yModuleSrc = await readText('src/skin-a11y.js')
  const stripExports = (s) => s
    .replace(/^export\s+default\s+/gm, 'return ')
    .replace(/^export\s+/gm, '')
    .replace(/\bexport\s*\{[^}]*\}\s*$/gm, '')
  const preamble = [
    `const __SKIN_MANIFEST__ = ${JSON.stringify(manifest)};`,
    `const __SKIN_BUNDLES__ = ${JSON.stringify(bundlesMap)};`,
    `const __SKIN_A11Y__ = ${JSON.stringify(a11yMap)};`,
    `const THEME_FAMILIES = ${JSON.stringify(familiesList)};`,
    `const React = (() => { const ce = (t,p,...c) => ({type:t,props:p||null,children:c}); return { createElement: ce, useState: () => [undefined, ()=>()=>{}], useEffect: () => {}, useMemo: (f) => f() }; })();`,
  ]
  const code = preamble.join('\n')
    + '\n' + stripExports(engineSrc)
    + '\n' + stripExports(a11yModuleSrc)
    + '\n' + clientSrc
  // eslint-disable-next-line no-new-func
  new Function('document', 'window', code)(win.document, win)

  delete globalThis.__TG_SURFACE__
  if (!surface) throw new Error('client.js 未暴露 __TG_SURFACE__ 协调 API')

  const theme = createThemeService()
  const slots = createSlotsService()
  const disposers = []
  const ctx = {
    get(name) { return name === 'theme' ? theme : name === 'slots' ? slots : undefined },
    effect(fn) { const d = fn(); if (typeof d === 'function') disposers.push(d) },
    _disposeAll() { for (let i = disposers.length - 1; i >= 0; i--) { try { disposers[i]() } catch {} } disposers.length = 0 },
  }

  // 触发插件 apply：注入 CSS、建立 activeThemeService/slots、启动恢复、挂停止钩子。
  if (typeof surface.apply === 'function') {
    await surface.apply(ctx)
  }

  return {
    api: surface,
    theme,
    slots,
    ctx,
    manifest,
    storage: storageObj,
    win,
    disposers,
    document: win.document,
    apply: surface.apply,
    cleanup() {
      globalThis.__DSH_MODULES__ = prior.modules
      globalThis.localStorage = prior.storage
      globalThis.document = prior.document
      globalThis.__TG_SURFACE__ = prior.surface
      if (executeScript) delete globalThis.__TG_EXEC_SCRIPT__
      else globalThis.__TG_EXEC_SCRIPT__ = prior.exec
      globalThis.MutationObserver = prior.mutationObserver
    },
  }
}
