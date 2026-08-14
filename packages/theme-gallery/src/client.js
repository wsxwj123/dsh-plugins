/**
 * client.js — dsh-theme-gallery 浏览器端插件。
 *
 * 两条轨道（互斥共存，INTERFACE §1.2）：
 *   - theme 轨道：现有 token 覆盖型主题画廊（15 主题族，themeService.overrideTokens）。
 *   - skin  轨道：新增「皮肤」画廊（9 款 dsh-web-ui bundle 复刻，body 属性 + CSS + chrome）。
 * 同一时刻至多一条轨道激活（且该轨道内至多一个选择），任何一条激活都会清退另一条。
 *
 * 数据（build.mjs 内联，运行期按需执行）：
 *   __SKIN_MANIFEST__ : 皮肤清单（SkinManifestEntry[]，按 order）
 *   __SKIN_BUNDLES__  : { [skinId]: client.js 文本 }（构建期嵌入）
 *   __SKIN_A11Y__     : { [skinId]: a11y.css 文本 }
 */

// ---- localStorage 常量 ----
const STORAGE_FAMILY = 'theme-gallery-family-v5' // 主题（保留，向后兼容）
const STORAGE_SKIN = 'theme-gallery-skin-v1'      // 皮肤（新增）
const STORAGE_TRACK = 'theme-gallery-track-v1'    // 切换状态：'theme' | 'skin'

function readStored(key, fallback = '') {
  try { return localStorage.getItem(key) || fallback } catch { return fallback }
}
function writeStored(key, value) {
  try { localStorage.setItem(key, value) } catch {}
}

// ---- 皮肤引擎实例化（构建期数据注入） ----
// window.__DSH_MODULES__ 是 shell 安装的模块系统；皮肤 bundle 需经它 materialize 取 apply。
const DSH_MODULES = globalThis.__DSH_MODULES__
const skinEngine = typeof DSH_MODULES !== 'undefined'
  ? createSkinEngine({
      modules: DSH_MODULES,
      manifest: __SKIN_MANIFEST__,
      bundles: __SKIN_BUNDLES__,
      // 测试注入面：__TG_EXEC_SCRIPT__ 覆盖默认脚本执行（生产 undefined → 默认 Blob-URL）。
      executeScript: typeof globalThis.__TG_EXEC_SCRIPT__ === 'function' ? globalThis.__TG_EXEC_SCRIPT__ : undefined,
    })
  : null
const a11yInjector = createA11yInjector({ a11y: __SKIN_A11Y__ })
const SKINS = skinEngine ? skinEngine.getSkins() : []
// 皮肤轨道不可用的降级提示（宿主缺 __DSH_MODULES__ 时皮肤段隐藏）
const SKIN_ENGINE_OK = skinEngine !== null

// ---- 主题轨道（现有，保留签名） ----
let selectedFamily = initialFamily()
let removeOverride = null
const listeners = new Set()
let activeTrack = initialTrack()
const notify = () => { for (const listener of listeners) listener(activeTrack) }
const subscribe = (listener) => { listeners.add(listener); return () => listeners.delete(listener) }

function initialFamily() {
  const stored = readStored(STORAGE_FAMILY, 'jade')
  return THEME_FAMILIES.some((item) => item.id === stored) ? stored : 'jade'
}
function initialTrack() {
  const stored = readStored(STORAGE_TRACK, '')
  return stored === 'skin' ? 'skin' : 'theme'
}

/** 清除当前主题 override（若有）。 */
function clearThemeOverride() {
  if (removeOverride) { removeOverride(); removeOverride = null }
}
/** 清除当前皮肤（若有）。 */
function clearSkin() {
  if (!skinEngine) return
  const st = skinEngine.currentSkinState()
  if (st.active && st.skinId) a11yInjector.remove(st.skinId)
  skinEngine.deactivateSkin()
}

const activateFamily = (familyId) => {
  // 皮肤轨道先清退，保证互斥。
  if (activeTrack === 'skin') clearSkin()
  const family = THEME_FAMILIES.find((item) => item.id === familyId) || THEME_FAMILIES[0]
  selectedFamily = family.id
  if (removeOverride) removeOverride()
  removeOverride = activeThemeService.overrideTokens('dsh-theme-gallery', family.tokens)
  activeTrack = 'theme'
  writeStored(STORAGE_FAMILY, selectedFamily)
  writeStored(STORAGE_TRACK, 'theme')
  notify()
}

/** 激活一款皮肤（异步；加载 bundle → apply → 注入 a11y → 持久化）。 */
const activateSkin = async (skinId) => {
  if (!skinEngine) throw new Error('[theme-gallery-skin] skin track unavailable (missing __DSH_MODULES__)')
  const entry = SKINS.find((item) => item.id === skinId)
  if (!entry) throw new Error(`unknown-skin: ${skinId}`)
  // 主题轨道先清退，保证互斥。
  if (activeTrack === 'theme') clearThemeOverride()
  await skinEngine.activateSkin(entry, {
    afterApply: () => a11yInjector.inject(entry.id),
  })
  activeTrack = 'skin'
  writeStored(STORAGE_SKIN, skinId)
  writeStored(STORAGE_TRACK, 'skin')
  notify()
}

/** 查询当前皮肤/主题状态（供 UI 高亮与外部断言）。 */
const currentSkinState = () => skinEngine ? skinEngine.currentSkinState() : { skinId: null, active: false }
const getFamily = () => THEME_FAMILIES.slice()
const getSkins = () => SKINS.slice()

/** 插件停止时全量回收（供 apply 与测试注入面调用）。 */
function teardown() {
  if (skinEngine) skinEngine.teardownSkins()
  clearThemeOverride()
}

// 测试注入面：把轨道协调 API 交给外部（生产不定义 __TG_SURFACE__，零污染；仅测试注入）。
// 这是 INTERFACE §2 的对外接口的测试可断言版本，UI 仍直接调用上面的函数。
if (typeof globalThis.__TG_SURFACE__ === 'function') {
  globalThis.__TG_SURFACE__({
    apply,
    activateFamily,
    activateSkin,
    clearSkin,
    clearThemeOverride,
    currentSkinState,
    getFamily,
    getSkins,
    getTrack: () => activeTrack,
    readStored,
    writeStored,
    teardown,
  })
}

// 主题 service 引用（apply 阶段注入）
let activeThemeService = null
let activeSlots = null

const CSS = `
  .theme-gallery-root { display: grid; gap: 11px; padding: 4px 0; }
  .theme-gallery-heading { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
  .theme-gallery-title { color: var(--dsw-alias-label-primary); font-size: 14px; font-weight: 600; }
  .theme-gallery-count { color: var(--dsw-alias-label-secondary); font-size: 12px; }
  .theme-gallery-hint { color: var(--dsw-alias-label-secondary); font-size: 11px; line-height: 17px; }
  .theme-gallery-tabs { display: flex; gap: 4px; padding: 2px; background: var(--dsw-alias-bg-layer-2); border-radius: 9px; }
  .theme-gallery-tab { flex: 1; padding: 6px 10px; border: none; border-radius: 7px; background: transparent; color: var(--dsw-alias-label-secondary); font: inherit; font-size: 12px; cursor: pointer; }
  .theme-gallery-tab.is-active { background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); font-weight: 600; box-shadow: 0 0 0 1px var(--dsw-alias-border-l1); }
  .theme-gallery-search { box-sizing: border-box; width: 100%; height: 34px; padding: 0 11px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 9px; outline: none; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); font: inherit; font-size: 12px; }
  .theme-gallery-search:focus { border-color: var(--dsw-alias-brand-primary); box-shadow: 0 0 0 2px color-mix(in srgb, var(--dsw-alias-brand-primary) 18%, transparent); }
  .theme-gallery-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 7px; max-height: 300px; overflow: auto; padding: 2px; contain: content; }
  .theme-gallery-card { display: grid; grid-template-columns: 32px minmax(0, 1fr); align-items: center; gap: 8px; min-width: 0; padding: 8px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); cursor: pointer; font: inherit; text-align: left; }
  .theme-gallery-card:hover { border-color: var(--dsw-alias-brand-primary); }
  .theme-gallery-card.is-active { border-color: var(--dsw-alias-brand-primary); box-shadow: 0 0 0 2px color-mix(in srgb, var(--dsw-alias-brand-primary) 20%, transparent); }
  .theme-gallery-swatches { display: grid; grid-template-columns: 1fr 1fr; width: 30px; height: 22px; overflow: hidden; border-radius: 6px; border: 1px solid rgba(127,127,127,.3); }
  .theme-gallery-swatch { position: relative; min-width: 0; }
  .theme-gallery-swatch span { position: absolute; right: 2px; bottom: 3px; width: 7px; height: 7px; border-radius: 50%; }
  .theme-gallery-copy { min-width: 0; display: grid; gap: 2px; }
  .theme-gallery-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
  .theme-gallery-meta { color: var(--dsw-alias-label-secondary); font-size: 10px; }
  .theme-gallery-empty { padding: 14px; border: 1px dashed var(--dsw-alias-border-l2); border-radius: 10px; color: var(--dsw-alias-label-secondary); text-align: center; font-size: 12px; }
  @media (max-width: 900px) { .theme-gallery-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
  @media (max-width: 680px) { .theme-gallery-grid { grid-template-columns: 1fr; } }
`

function apply(ctx) {
  const themeService = ctx.get('theme')
  const slots = ctx.get('slots')
  if (themeService === undefined || slots === undefined) return
  activeThemeService = themeService
  activeSlots = slots
  if (!skinEngine) {
    // 宿主缺 __DSH_MODULES__：皮肤轨道不可用，仅主题轨道（降级不崩溃）。
    activeTrack = 'theme'
  }

  // 纯函数：皮肤 id 是否在清单内。
  const skinIdValid = (id) => SKINS.some((item) => item.id === id)

  // 启动时恢复轨道（async 恢复皮肤 bundle）。
  const restoreSkin = async () => {
    const stored = readStored(STORAGE_SKIN, '')
    if (!skinIdValid(stored)) { writeStored(STORAGE_TRACK, 'theme'); notify(); return }
    try { await activateSkin(stored) } catch { /* 恢复失败回主题 */ clearSkin(); activeTrack = 'theme'; writeStored(STORAGE_TRACK, 'theme'); notify() }
  }
  if (initialTrack() === 'skin') { activateFamily(selectedFamily); void restoreSkin() }
  else activateFamily(selectedFamily)

  // 插件停止：清退皮肤全部副作用（内置 + a11y + 模块表）与主题 override。
  ctx.effect(() => () => teardown())

  function Gallery() {
    const [track, setTrack] = React.useState(activeTrack)
    const [query, setQuery] = React.useState('')
    const [busy, setBusy] = React.useState(false)
    React.useEffect(() => subscribe(setTrack), [])

    const normalized = query.trim().toLowerCase()
    const visibleFamilies = THEME_FAMILIES.filter((item) => !normalized || (item.label + ' ' + item.id).toLowerCase().includes(normalized))
    const visibleSkins = SKINS.filter((item) => !normalized || (item.name + ' ' + item.nameEn + ' ' + item.id).toLowerCase().includes(normalized))

    const onPickSkin = async (id) => {
      setBusy(true)
      try { await activateSkin(id) } finally { setBusy(false) }
    }

    // 切到皮肤轨道：清退主题 override、把主动画轨道置为 skin，若存过皮肤且未激活则自动恢复。
    const openSkinTrack = () => {
      if (!skinEngine) return
      if (activeTrack === 'theme') clearThemeOverride()
      activeTrack = 'skin'
      notify()
      const stored = readStored(STORAGE_SKIN, '')
      if (skinIdValid(stored) && !currentSkinState().active) onPickSkin(stored)
    }

    const tabs = React.createElement('div', { className: 'theme-gallery-tabs', role: 'tablist', 'aria-label': '外观轨道' },
      React.createElement('button', {
        type: 'button', role: 'tab', 'aria-selected': track === 'theme', className: 'theme-gallery-tab' + (track === 'theme' ? ' is-active' : ''),
        onClick: () => activateFamily(selectedFamily),
      }, '主题'),
      SKIN_ENGINE_OK && React.createElement('button', {
        type: 'button', role: 'tab', 'aria-selected': track === 'skin', className: 'theme-gallery-tab' + (track === 'skin' ? ' is-active' : ''),
        onClick: () => openSkinTrack(),
      }, '皮肤'),
    )

    const body = track === 'theme' ? renderThemeBody() : renderSkinBody()

    function renderThemeBody() {
      return React.createElement('div', { className: 'theme-gallery-root' },
        React.createElement('div', { className: 'theme-gallery-hint' }, '明暗模式由 DSH 的“外观”设置统一控制；选择“跟随系统”时主题会自动切换。'),
        React.createElement('input', { className: 'theme-gallery-search', type: 'search', value: query, placeholder: '搜索主题…', 'aria-label': '搜索主题', onChange: (e) => setQuery(e.target.value) }),
        visibleFamilies.length === 0
          ? React.createElement('div', { className: 'theme-gallery-empty' }, '没有匹配的主题')
          : React.createElement('div', { className: 'theme-gallery-grid' }, ...visibleFamilies.map((item) =>
              React.createElement('button', { key: item.id, type: 'button', className: 'theme-gallery-card' + (selectedFamily === item.id && track === 'theme' ? ' is-active' : ''), 'aria-pressed': selectedFamily === item.id && track === 'theme', onClick: () => activateFamily(item.id) },
                React.createElement('span', { className: 'theme-gallery-swatches' },
                  React.createElement('span', { className: 'theme-gallery-swatch', style: { background: item.preview.light.background } }, React.createElement('span', { style: { background: item.preview.light.accent } })),
                  React.createElement('span', { className: 'theme-gallery-swatch', style: { background: item.preview.dark.background } }, React.createElement('span', { style: { background: item.preview.dark.accent } })),
                ),
                React.createElement('span', { className: 'theme-gallery-copy' },
                  React.createElement('span', { className: 'theme-gallery-name' }, item.label),
                  React.createElement('span', { className: 'theme-gallery-meta' }, '跟随 DSH 外观'),
                ),
              ),
            )),
      )
    }

    function renderSkinBody() {
      if (!SKIN_ENGINE_OK) {
        return React.createElement('div', { className: 'theme-gallery-empty' }, '皮肤轨道不可用：宿主未提供 __DSH_MODULES__。')
      }
      const st = currentSkinState()
      return React.createElement('div', { className: 'theme-gallery-root' },
        React.createElement('div', { className: 'theme-gallery-hint' }, '皮肤为会话级尝试（try-on）：刷新页面回默认。要永久的皮肤，请在官方「皮肤中心」用 dsh-skin use 启用。'),
        React.createElement('input', { className: 'theme-gallery-search', type: 'search', value: query, placeholder: '搜索皮肤…', 'aria-label': '搜索皮肤', onChange: (e) => setQuery(e.target.value) }),
        React.createElement('div', { className: 'theme-gallery-count' }, visibleSkins.length + ' / ' + SKINS.length),
        visibleSkins.length === 0
          ? React.createElement('div', { className: 'theme-gallery-empty' }, '没有匹配的皮肤')
          : React.createElement('div', { className: 'theme-gallery-grid' }, ...visibleSkins.map((item) =>
              React.createElement('button', { key: item.id, type: 'button', disabled: busy, className: 'theme-gallery-card' + (st.skinId === item.id && track === 'skin' ? ' is-active' : ''), 'aria-pressed': st.skinId === item.id && track === 'skin', onClick: () => onPickSkin(item.id) },
                React.createElement('span', { className: 'theme-gallery-swatches' }, React.createElement('span', { className: 'theme-gallery-swatch', style: { background: item.accent } })),
                React.createElement('span', { className: 'theme-gallery-copy' },
                  React.createElement('span', { className: 'theme-gallery-name' }, item.name),
                  React.createElement('span', { className: 'theme-gallery-meta' }, item.author + ' · ' + item.accent),
                ),
              ),
            )),
      )
    }

    return React.createElement('div', { className: 'theme-gallery-root' },
      React.createElement('div', { className: 'theme-gallery-heading' },
        React.createElement('div', { className: 'theme-gallery-title' }, '精选外观'),
        React.createElement('div', { className: 'theme-gallery-count' }, track === 'skin' ? visibleSkins.length + ' / ' + SKINS.length + ' 皮肤' : visibleFamilies.length + ' / ' + THEME_FAMILIES.length + ' 主题'),
      ),
      tabs,
      body,
    )
  }

  ctx.effect(() => {
    const element = document.createElement('style')
    element.setAttribute('data-theme-gallery', '')
    element.textContent = CSS
    document.head.appendChild(element)
    return () => element.remove()
  })

  slots.inject('settings.general.item', () => slots.register(
    { name: 'settings.general.item', id: 'theme-gallery', order: 11 },
    Gallery,
  ))
}
