/**
 * client.js — apply 层接线（INTERFACE §3.0 状态归属表）。
 *
 * 这里持有：皮肤引擎实例、启动恢复、teardownSkins、token override 句柄、激活串行化闸、
 * 试穿态与 revertPreview。面板只拿 UI 态。引擎建在这一层是硬约定：
 * 若建在懒挂载的面板里，用户刷新后不打开面板皮肤就不生效。
 *
 * 依赖一律经 deps 注入（applyWith）：浏览器侧由 apply(ctx) 用真实全局拼出来，Node 侧
 * 验收测试塞替身。src 文件被 build.mjs 拼进同一个 factory 作用域，import 行由构建期剥掉。
 */
import { THEME_FAMILIES } from './themes.curated.js'
// 注意：这些 import 会被 build.mjs 剥掉，拼接后靠同一 factory 作用域里的同名标识符解析。
// 因此只能按被导入模块里**真实的模块级名字**引用，不许在 import 处起别名。
import { createCustomThemeApi, STORAGE_CUSTOM_APPLIED, STORAGE_FAMILY, DEFAULT_THEME_ID, TRACK_KEY } from './custom-theme.js'
import { createSkinEngine, validateCustomBundle } from './skin-engine.js'
import { createCustomSkinApi, browserStorage, SKIN_STORAGE_CUSTOM_APPLIED, STORAGE_SKIN } from './custom-skin.js'
import { createA11yInjector } from './skin-a11y.js'
import { createThemePanel } from './panel-theme.js'
import { createSkinPanel } from './panel-skin.js'

const STYLE_MARK = 'data-appearance-gallery'
/** 槽位 id（INTERFACE §3.1）。同时作为入口 DOM 的 data-slot-id，供 e2e 定位；与包目录名解耦。 */
const SLOT_ID = 'appearance-gallery'
/** 旧包注入的 style 标记；命中说明用户没卸旧插件，两套引擎会互相打架 */
const LEGACY_STYLE_SELECTOR = 'style[data-theme-gallery], style[data-skin-gallery], style[data-skin-entry]'
const LEGACY_CONFLICT_TEXT = '检测到旧版 theme-gallery / skin-gallery 仍已安装，请先卸载，否则外观会冲突'
const SUMMARY_THEME_PREFIX = '精选主题 · '
const SUMMARY_SKIN_PREFIX = '完整皮肤 · '

const CSS = `
  .appearance-entry { display: grid; gap: 8px; padding: 4px 0; }
  .appearance-summary { color: var(--dsw-alias-label-primary); font-size: 13px; }
  .appearance-legacy-warn { color: var(--dsw-alias-state-error-primary); font-size: 12px; line-height: 18px; }
  .appearance-open, .appearance-back { justify-self: start; min-height: 32px; padding: 0 12px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 9px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); cursor: pointer; font: inherit; font-size: 12px; }
  .appearance-open:hover, .appearance-back:hover { border-color: var(--dsw-alias-brand-primary); }
  .appearance-panel { display: grid; gap: 18px; padding-top: 6px; }
  .theme-gallery-root { display: grid; gap: 11px; padding: 4px 0; }
  .theme-gallery-heading { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
  .theme-gallery-title { color: var(--dsw-alias-label-primary); font-size: 14px; font-weight: 600; }
  .theme-gallery-count { color: var(--dsw-alias-label-secondary); font-size: 12px; }
  .theme-gallery-hint { color: var(--dsw-alias-label-secondary); font-size: 11px; line-height: 17px; }
  .theme-gallery-search { box-sizing: border-box; width: 100%; height: 34px; padding: 0 11px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 9px; outline: none; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); font: inherit; font-size: 12px; }
  .theme-gallery-search:focus { border-color: var(--dsw-alias-brand-primary); box-shadow: 0 0 0 2px color-mix(in srgb, var(--dsw-alias-brand-primary) 18%, transparent); }
  .theme-gallery-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 7px; padding: 2px; }
  .theme-gallery-card { display: grid; grid-template-columns: 32px minmax(0, 1fr); align-items: center; gap: 8px; min-width: 0; padding: 8px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); cursor: pointer; font: inherit; text-align: left; }
  .theme-gallery-card:hover { border-color: var(--dsw-alias-brand-primary); }
  .theme-gallery-card.is-active { border-color: var(--dsw-alias-brand-primary); box-shadow: 0 0 0 2px color-mix(in srgb, var(--dsw-alias-brand-primary) 20%, transparent); }
  .theme-gallery-swatches { display: grid; grid-template-columns: 1fr 1fr; width: 30px; height: 22px; overflow: hidden; border-radius: 6px; border: 1px solid rgba(127,127,127,.3); }
  .theme-gallery-swatch { position: relative; min-width: 0; }
  .theme-gallery-swatch span { position: absolute; right: 2px; bottom: 3px; width: 7px; height: 7px; border-radius: 50%; }
  .theme-gallery-copy { min-width: 0; display: grid; gap: 2px; }
  .theme-gallery-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
  .theme-gallery-meta { color: var(--dsw-alias-label-secondary); font-size: 10px; }
  .theme-gallery-actions { display: flex; gap: 8px; flex-wrap: wrap; }
  .theme-gallery-action { min-height: 32px; padding: 0 12px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 9px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-secondary); cursor: pointer; font: inherit; font-size: 12px; }
  .theme-gallery-action:hover { border-color: var(--dsw-alias-brand-primary); color: var(--dsw-alias-label-primary); }
  .theme-gallery-action-primary { color: var(--dsw-alias-label-primary-foreground); border-color: var(--dsw-alias-brand-primary); background: var(--dsw-alias-brand-primary); }
  .theme-gallery-custom { display: grid; gap: 10px; padding: 12px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 12px; background: var(--dsw-alias-bg-layer-1); }
  .theme-gallery-custom-title { color: var(--dsw-alias-label-primary); font-size: 13px; font-weight: 600; }
  .theme-gallery-custom-text { color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; }
  .theme-gallery-import { width: 100%; box-sizing: border-box; min-height: 96px; padding: 8px 10px; border: 1px dashed var(--dsw-alias-border-l2); border-radius: 9px; color: var(--dsw-alias-label-secondary); background: var(--dsw-alias-bg-layer-2); font: 12px/18px var(--ds-font-family-code, ui-monospace, monospace); }
  .theme-gallery-custom-list { display: grid; gap: 6px; }
  .theme-gallery-custom-item { display: flex; align-items: center; gap: 8px; padding: 8px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 9px; }
  .theme-gallery-custom-item.is-active { border-color: var(--dsw-alias-brand-primary); box-shadow: 0 0 0 2px color-mix(in srgb, var(--dsw-alias-brand-primary) 20%, transparent); }
  .theme-gallery-custom-ops { margin-left: auto; display: flex; gap: 6px; }
  .theme-gallery-empty { padding: 14px; border: 1px dashed var(--dsw-alias-border-l2); border-radius: 10px; color: var(--dsw-alias-label-secondary); text-align: center; font-size: 12px; }
  .theme-gallery-err { color: var(--dsw-alias-state-error-primary); font-size: 11px; }
  .skin-gallery-root { display: grid; gap: 11px; padding: 4px 0; }
  .skin-gallery-heading { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
  .skin-gallery-title { color: var(--dsw-alias-label-primary); font-size: 14px; font-weight: 600; }
  .skin-gallery-count { color: var(--dsw-alias-label-secondary); font-size: 12px; }
  .skin-gallery-hint { color: var(--dsw-alias-label-secondary); font-size: 11px; line-height: 17px; }
  .skin-gallery-search { box-sizing: border-box; width: 100%; height: 34px; padding: 0 11px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 9px; outline: none; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); font: inherit; font-size: 12px; }
  .skin-gallery-search:focus { border-color: var(--dsw-alias-brand-primary); box-shadow: 0 0 0 2px color-mix(in srgb, var(--dsw-alias-brand-primary) 18%, transparent); }
  .skin-gallery-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 7px; padding: 2px; }
  .skin-gallery-card { display: grid; grid-template-columns: 40px minmax(0, 1fr); align-items: center; gap: 10px; min-width: 0; padding: 10px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 12px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); font: inherit; text-align: left; }
  .skin-gallery-card-main { display: contents; cursor: pointer; border: 0; background: transparent; color: inherit; padding: 0; font: inherit; text-align: left; }
  .skin-gallery-card-actions { grid-column: 1 / -1; display: flex; gap: 6px; flex-wrap: wrap; }
  .skin-gallery-card:hover { border-color: var(--dsw-alias-brand-primary); }
  .skin-gallery-card.is-active { border-color: var(--dsw-alias-brand-primary); box-shadow: 0 0 0 2px color-mix(in srgb, var(--dsw-alias-brand-primary) 20%, transparent); }
  .skin-gallery-swatch { display: block; width: 38px; height: 26px; border-radius: 7px; border: 1px solid rgba(127,127,127,.3); box-shadow: inset 0 0 0 1px rgba(255,255,255,.08); }
  .skin-gallery-copy { min-width: 0; display: grid; gap: 3px; }
  .skin-gallery-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; font-weight: 600; }
  .skin-gallery-meta { color: var(--dsw-alias-label-secondary); font-size: 10px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .skin-gallery-actions { display: flex; gap: 8px; flex-wrap: wrap; }
  .skin-gallery-action { min-height: 32px; padding: 0 12px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 9px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-secondary); cursor: pointer; font: inherit; font-size: 12px; }
  .skin-gallery-action:hover { border-color: var(--dsw-alias-brand-primary); color: var(--dsw-alias-label-primary); }
  .skin-gallery-action-primary { color: var(--dsw-alias-label-primary-foreground); border-color: var(--dsw-alias-brand-primary); background: var(--dsw-alias-brand-primary); }
  .skin-gallery-action.is-current { color: var(--dsw-alias-label-primary-foreground); border-color: var(--dsw-alias-brand-primary); background: var(--dsw-alias-brand-primary); }
  .skin-gallery-design { display: grid; gap: 10px; padding: 12px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 12px; background: var(--dsw-alias-bg-layer-1); }
  .skin-gallery-design-title { color: var(--dsw-alias-label-primary); font-size: 13px; font-weight: 600; }
  .skin-gallery-design-text { color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; }
  .skin-gallery-design-options { display: flex; flex-wrap: wrap; gap: 6px; }
  .skin-gallery-design-option { padding: 5px 9px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 999px; background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer; font: inherit; font-size: 12px; }
  .skin-gallery-design-option.is-selected { color: var(--dsw-alias-label-primary-foreground); border-color: var(--dsw-alias-brand-primary); background: var(--dsw-alias-brand-primary); }
  .skin-gallery-design-output { min-height: 84px; padding: 10px; border: 1px dashed var(--dsw-alias-border-l2); border-radius: 9px; color: var(--dsw-alias-label-secondary); background: var(--dsw-alias-bg-layer-2); font: 12px/18px var(--ds-font-family-code, ui-monospace, monospace); white-space: pre-wrap; }
  .skin-gallery-import { display: grid; gap: 10px; padding: 12px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 12px; background: var(--dsw-alias-bg-layer-1); }
  .skin-gallery-import-title { color: var(--dsw-alias-label-primary); font-size: 13px; font-weight: 600; }
  .skin-gallery-import-text { color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; }
  .skin-gallery-import-field { width: 100%; box-sizing: border-box; min-height: 72px; padding: 8px 10px; border: 1px dashed var(--dsw-alias-border-l2); border-radius: 9px; color: var(--dsw-alias-label-secondary); background: var(--dsw-alias-bg-layer-2); font: 12px/18px var(--ds-font-family-code, ui-monospace, monospace); }
  .skin-gallery-import-err { color: var(--dsw-alias-state-error-primary); font-size: 11px; }
  .skin-gallery-empty { padding: 14px; border: 1px dashed var(--dsw-alias-border-l2); border-radius: 10px; color: var(--dsw-alias-label-secondary); text-align: center; font-size: 12px; }
  @media (max-width: 900px) { .theme-gallery-grid, .skin-gallery-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
  @media (max-width: 680px) { .theme-gallery-grid, .skin-gallery-grid { grid-template-columns: 1fr; } }
`

/**
 * 建立整个 apply 层运行时。deps 全部显式注入，浏览器与 Node 验收共用同一份逻辑。
 * deps: { React, doc, storage, themeService, modules, manifest, bundles, a11y, executeScript, families }
 */
export function createAppearanceRuntime(deps) {
  const React = deps.React
  const doc = deps.doc
  const storage = deps.storage
  const themeService = deps.themeService
  const families = deps.families || THEME_FAMILIES

  const readKey = (key) => { try { return storage.getItem(key) || '' } catch { return '' } }

  const listeners = new Set()
  const notify = () => { for (const listener of [...listeners]) listener() }
  const subscribe = (listener) => { listeners.add(listener); return () => listeners.delete(listener) }

  // ---- 皮肤引擎（宿主没给 __DSH_MODULES__ 时为 null，皮肤区只渲染占位）----
  const engine = deps.modules === undefined || deps.modules === null
    ? null
    : createSkinEngine({
      modules: deps.modules,
      manifest: deps.manifest,
      bundles: deps.bundles,
      executeScript: typeof deps.executeScript === 'function' ? deps.executeScript : undefined,
      doc,
    })
  const a11yInjector = createA11yInjector({ a11y: deps.a11y || {}, doc })
  const builtinSkins = engine ? engine.getSkins() : []

  // ---- 试穿态与激活串行化闸（INTERFACE §3.3）----
  const preview = { skinId: null, themeId: null }
  let activating = false

  /** 真实激活一条皮肤条目：引擎执行 bundle + a11y 注入。不含闸，闸在门面层。 */
  async function activateEntry(entry) {
    if (!engine) return
    await engine.activateSkin(entry, { afterApply: () => a11yInjector.inject(entry.id) })
  }

  /** 重入直接 return：不排队、不抛错。每个流程开始前先撤销试穿态。 */
  async function guarded(fn) {
    if (activating) return undefined
    activating = true
    try {
      revertPreview()
      return await fn()
    } finally { activating = false }
  }

  // ---- 主题轨 ----
  let removeOverride = null
  const rawThemeApi = createCustomThemeApi({
    storage,
    builtinThemes: families,
    applyTokens: (tokens, themeId) => {
      if (removeOverride) removeOverride()
      removeOverride = themeService.overrideTokens('dsh-appearance-gallery', tokens, themeId)
    },
  })

  /**
   * 试穿态由 apply 层持有（INTERFACE §3.0）：主题试穿只注入 tokens、不写 storage，
   * 面板关闭时靠 preview.themeId 这个标记决定要不要回滚。
   */
  const themeApi = Object.assign({}, rawThemeApi, {
    previewCustomTheme(id) {
      rawThemeApi.previewCustomTheme(id)
      preview.themeId = id
      notify()
    },
    applyCustomTheme(id) {
      rawThemeApi.applyCustomTheme(id)
      preview.themeId = null
      notify()
    },
    activateFamily(id) {
      rawThemeApi.activateFamily(id)
      preview.themeId = null
      notify()
    },
    deleteCustomTheme(id) {
      rawThemeApi.deleteCustomTheme(id)
      if (preview.themeId === id) preview.themeId = null
      notify()
    },
    restoreDefaultTheme() {
      rawThemeApi.restoreDefaultTheme()
      preview.themeId = null
      notify()
    },
    async importCustomTheme(text) {
      const item = await rawThemeApi.importCustomTheme(text)
      notify()
      return item
    },
  })

  /** 内置主题的复合动作：注入 tokens + 写 4 个键 + 通知。未知 id 静默 no-op。 */
  function activateFamily(familyId) {
    themeApi.activateFamily(familyId)
  }

  function paintFamily(familyId) {
    const family = families.find((item) => item.id === familyId)
      || families.find((item) => item.id === DEFAULT_THEME_ID)
      || families[0]
    if (!family) return
    if (removeOverride) removeOverride()
    removeOverride = themeService.overrideTokens('dsh-appearance-gallery', family.tokens, family.id)
  }

  // ---- 皮肤轨 ----
  const customSkinApi = createCustomSkinApi({
    storage,
    builtinSkins,
    validate: validateCustomBundle,
    engine,
    activate: activateEntry,
    isLiveSkin: (id) => readKey(SKIN_STORAGE_CUSTOM_APPLIED) === id || preview.skinId === id,
  })

  const skinRuntime = {
    getPreviewState: () => ({ skinId: preview.skinId || '', appliedSkinId: readKey(STORAGE_SKIN) }),
    previewSkin: (id) => guarded(async () => {
      await customSkinApi.previewSkin(id)
      preview.skinId = id
      notify()
    }),
    applySkin: (id) => guarded(async () => {
      await customSkinApi.activateSkin(id)
      preview.skinId = null
      notify()
    }),
    clearSkin: async () => {
      customSkinApi.clearSkin()
      preview.skinId = null
      notify()
    },
  }

  const skinApi = Object.assign({}, customSkinApi, {
    previewCustomSkin: (id) => guarded(async () => {
      await customSkinApi.previewCustomSkin(id)
      preview.skinId = id
      notify()
    }),
    applyCustomSkin: (id) => guarded(async () => {
      await customSkinApi.applyCustomSkin(id)
      preview.skinId = null
      notify()
    }),
    async importCustomSkin(parts) {
      const item = await customSkinApi.importCustomSkin(parts)
      notify()
      return item
    },
    deleteCustomSkin(id) {
      customSkinApi.deleteCustomSkin(id)
      if (preview.skinId === id) preview.skinId = null
      notify()
    },
    restoreDefaultSkin() {
      customSkinApi.restoreDefaultSkin()
      preview.skinId = null
      notify()
    },
    /** S4 卡片点主体：自定义走 applyCustomSkin，内置走 applySkin。 */
    async choose(id) {
      const isCustom = customSkinApi.getCustomSkins().some((item) => item.id === id)
      return isCustom ? skinApi.applyCustomSkin(id) : skinRuntime.applySkin(id)
    },
  })

  // ---- 启动恢复（在 apply 层，与面板是否打开无关）----
  function restoreFromStorage() {
    const customThemeId = readKey(STORAGE_CUSTOM_APPLIED)
    const customTheme = customThemeId
      ? themeApi.getCustomThemes().find((item) => item.id === customThemeId)
      : null
    if (customTheme) {
      if (removeOverride) removeOverride()
      removeOverride = themeService.overrideTokens('dsh-appearance-gallery', customTheme.tokens, customTheme.id)
    } else {
      paintFamily(readKey(STORAGE_FAMILY) || DEFAULT_THEME_ID)
    }

    if (!engine) return
    const customSkinId = readKey(SKIN_STORAGE_CUSTOM_APPLIED)
    const customSkin = customSkinId
      ? customSkinApi.getCustomSkins().find((item) => item.id === customSkinId)
      : null
    const builtinId = readKey(STORAGE_SKIN)
    const builtin = builtinId ? builtinSkins.find((item) => item.id === builtinId) : null
    const target = customSkin || builtin // 自定义 applied 优先于内置
    if (target) {
      if (customSkin) customSkinApi.registerCustomBundle(customSkin)
      const entry = customSkinApi.getSkins().find((item) => item.id === target.id) || target
      void activateEntry(entry).catch(() => {}) // 恢复失败不许炸掉插件启动
    } else {
      engine.deactivateSkin()
    }
  }

  /** 撤销试穿：回到 storage 记录的外观（有 applied 就重新激活，没有就清空）。 */
  function revertPreview() {
    if (!preview.skinId && !preview.themeId) return
    preview.skinId = null
    preview.themeId = null
    restoreFromStorage()
  }

  /** 生效外观：摘要只反映实际生效结果，不直接读 applied 键渲染文案。 */
  function effectiveAppearance() {
    const state = engine ? engine.currentSkinState() : { skinId: null, active: false }
    if (state.active && state.skinId) {
      const item = customSkinApi.getSkins().find((s) => s.id === state.skinId)
      return { kind: 'skin', id: state.skinId, name: item ? item.name : state.skinId }
    }
    const customId = readKey(STORAGE_CUSTOM_APPLIED)
    const custom = customId ? themeApi.getCustomThemes().find((t) => t.id === customId) : null
    if (custom) return { kind: 'theme', id: custom.id, label: custom.label }
    const familyId = readKey(STORAGE_FAMILY)
    const family = families.find((f) => f.id === familyId)
      || families.find((f) => f.id === DEFAULT_THEME_ID)
      || families[0]
    return { kind: 'theme', id: family.id, label: family.label }
  }

  function summaryText() {
    const effective = effectiveAppearance()
    return effective.kind === 'skin'
      ? SUMMARY_SKIN_PREFIX + effective.name
      : SUMMARY_THEME_PREFIX + effective.label
  }

  function teardownSkins() {
    if (engine) engine.teardownSkins()
  }

  // ---- 面板与入口 ----
  let setOpenRef = null
  function closePanel() {
    revertPreview() // §3.0 硬约定 2：先撤销试穿，再关面板
    // §3.0：搜索词 / 导入 textarea / 错误文案 / 勾选删除 / 二次确认等面板 UI 态卸载即丢
    themePanel.reset()
    skinPanel.reset()
    if (setOpenRef) setOpenRef(false)
  }

  const themePanel = createThemePanel({
    React, families, customThemeApi: themeApi, activateFamily, subscribe, onBack: closePanel,
  })
  const skinPanel = createSkinPanel({
    React, engine, customSkinApi: skinApi, skinRuntime, subscribe, onBack: closePanel,
  })

  const legacyPresent = (() => {
    try { return doc.querySelector(LEGACY_STYLE_SELECTOR) !== null } catch { return false }
  })()

  function AppearanceEntry() {
    const [open, setOpen] = React.useState(false)
    setOpenRef = setOpen
    const children = [
      React.createElement('div', { className: 'appearance-summary', key: 'summary' }, summaryText()),
    ]
    if (legacyPresent) {
      children.push(React.createElement('div', { className: 'appearance-legacy-warn', key: 'legacy' }, LEGACY_CONFLICT_TEXT))
    }
    if (!open) {
      children.push(React.createElement('button', {
        key: 'open', type: 'button', className: 'appearance-open', onClick: () => setOpen(true),
      }, '打开外观设置'))
    } else {
      // §3.9 边界约束 2：只经 createElement(Panel) 挂载，禁止直接调用 Panel()
      children.push(React.createElement('div', { className: 'appearance-panel', key: 'panel' },
        React.createElement(themePanel.Panel, { key: 'theme' }),
        React.createElement(skinPanel.Panel, { key: 'skin' }),
        React.createElement('button', {
          // 面板内三个「返回」可见文案相同（本处 + 主题区 + 皮肤区），靠 aria-label 区分可访问名称
          key: 'back', type: 'button', className: 'appearance-back', 'aria-label': '返回设置', onClick: closePanel,
        }, '返回')))
    }
    // data-slot-id 取槽位 id 原值（INTERFACE §3.1）：e2e/自动化按它定位入口，
    // 值与目录名无关，改目录也不动它。
    return React.createElement('div', { className: 'appearance-entry', 'data-slot-id': SLOT_ID }, ...children)
  }

  // ---- 样式注入（一个 style，7.5 KB 纯类选择器，不随面板懒注入）----
  let styleEl = null
  function injectStyle() {
    styleEl = doc.createElement('style')
    styleEl.setAttribute(STYLE_MARK, '')
    styleEl.textContent = CSS
    doc.head.appendChild(styleEl)
  }

  function dispose() {
    revertPreview()
    if (styleEl) { styleEl.remove(); styleEl = null }
    if (removeOverride) { removeOverride(); removeOverride = null }
    teardownSkins()
  }

  const surface = {
    apply,
    activateSkin: skinRuntime.applySkin,
    previewSkin: skinRuntime.previewSkin,
    applySkin: skinRuntime.applySkin,
    clearSkin: skinRuntime.clearSkin,
    currentSkinState: () => (engine ? engine.currentSkinState() : { skinId: null, active: false }),
    getSkins: () => customSkinApi.getSkins(),
    getPreviewState: skinRuntime.getPreviewState,
    readStored: readKey,
    writeStored: (key, value) => {
      try {
        // §3.4：track 键清空走 removeItem（其余键写 '' 即可，读侧 '' 与 null 等价）
        if (value === '' && key === TRACK_KEY) storage.removeItem(key)
        else storage.setItem(key, value)
      } catch { /* 静默降级 */ }
    },
    teardown: teardownSkins,
    revertPreview,
  }

  return {
    AppearanceEntry,
    themePanel,
    skinPanel,
    themeApi,
    skinApi,
    skinRuntime,
    engine,
    families,
    builtinSkins,
    subscribe,
    notify,
    revertPreview,
    effectiveAppearance,
    summaryText,
    teardownSkins,
    restoreFromStorage,
    activateFamily,
    injectStyle,
    dispose,
    surface,
    closePanel,
    legacyPresent,
  }
}

/**
 * apply(ctx) 的可注入版本：验收测试直接调它塞替身，浏览器侧由 apply(ctx) 调。
 * 前置服务任一缺失 → 直接 return，不注册槽位、不注入样式、不碰 storage。
 */
export function applyWith(ctx, deps) {
  const themeService = ctx.get('theme')
  const slots = ctx.get('slots')
  if (themeService === undefined || slots === undefined) {
    return { registered: false, dispose: () => {}, runtime: null }
  }

  const runtime = createAppearanceRuntime(Object.assign({}, deps, { themeService }))
  runtime.injectStyle()
  runtime.restoreFromStorage()

  ctx.effect(() => () => runtime.dispose())

  slots.inject('settings.general.item', () => slots.register(
    { name: 'settings.general.item', id: SLOT_ID, order: 11 },
    runtime.AppearanceEntry,
  ))

  // 浏览器侧测试钩子：8 个皮肤单测靠它拿到真实运行时（12 个字段，语义与合并前一致）
  if (typeof globalThis.__TG_SURFACE__ === 'function') globalThis.__TG_SURFACE__(runtime.surface)

  return { registered: true, dispose: () => runtime.dispose(), runtime }
}

function apply(ctx) {
  return applyWith(ctx, {
    React,
    doc: document,
    storage: browserStorage(),
    modules: globalThis.__DSH_MODULES__,
    manifest: __SKIN_MANIFEST__,
    bundles: __SKIN_BUNDLES__,
    a11y: __SKIN_A11Y__,
    families: THEME_FAMILIES,
    executeScript: typeof globalThis.__TG_EXEC_SCRIPT__ === 'function' ? globalThis.__TG_EXEC_SCRIPT__ : undefined,
  })
}

export { apply }
