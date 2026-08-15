const STORAGE_SKIN = 'skin-gallery-skin-v1'

function readStored(key, fallback = '') {
  try { return localStorage.getItem(key) || fallback } catch { return fallback }
}

function writeStored(key, value) {
  try { localStorage.setItem(key, value) } catch {}
}

const DSH_MODULES = globalThis.__DSH_MODULES__
const skinEngine = typeof DSH_MODULES !== 'undefined'
  ? createSkinEngine({
      modules: DSH_MODULES,
      manifest: __SKIN_MANIFEST__,
      bundles: __SKIN_BUNDLES__,
      executeScript: typeof globalThis.__TG_EXEC_SCRIPT__ === 'function' ? globalThis.__TG_EXEC_SCRIPT__ : undefined,
    })
  : null
const a11yInjector = createA11yInjector({ a11y: __SKIN_A11Y__ })
const SKINS = skinEngine ? skinEngine.getSkins() : []
const listeners = new Set()
const notify = () => { for (const listener of listeners) listener() }
const subscribe = (listener) => { listeners.add(listener); return () => listeners.delete(listener) }

function clearSkin() {
  if (!skinEngine) return
  const state = skinEngine.currentSkinState()
  if (state.active && state.skinId) a11yInjector.remove(state.skinId)
  skinEngine.deactivateSkin()
}

async function activateSkin(skinId) {
  if (!skinEngine) throw new Error('[skin-gallery] missing __DSH_MODULES__')
  const entry = SKINS.find((item) => item.id === skinId)
  if (!entry) throw new Error(`unknown-skin: ${skinId}`)
  await skinEngine.activateSkin(entry, {
    afterApply: () => a11yInjector.inject(entry.id),
  })
  writeStored(STORAGE_SKIN, skinId)
  notify()
}

const currentSkinState = () => skinEngine ? skinEngine.currentSkinState() : { skinId: null, active: false }
const getSkins = () => SKINS.slice()

function teardown() {
  if (skinEngine) skinEngine.teardownSkins()
}

if (typeof globalThis.__TG_SURFACE__ === 'function') {
  globalThis.__TG_SURFACE__({
    apply,
    activateSkin,
    clearSkin,
    currentSkinState,
    getSkins,
    readStored,
    writeStored,
    teardown,
  })
}

const CSS = `
  .skin-gallery-root { display: grid; gap: 11px; padding: 4px 0; }
  .skin-gallery-heading { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
  .skin-gallery-title { color: var(--dsw-alias-label-primary); font-size: 14px; font-weight: 600; }
  .skin-gallery-count { color: var(--dsw-alias-label-secondary); font-size: 12px; }
  .skin-gallery-hint { color: var(--dsw-alias-label-secondary); font-size: 11px; line-height: 17px; }
  .skin-gallery-search { box-sizing: border-box; width: 100%; height: 34px; padding: 0 11px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 9px; outline: none; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); font: inherit; font-size: 12px; }
  .skin-gallery-search:focus { border-color: var(--dsw-alias-brand-primary); box-shadow: 0 0 0 2px color-mix(in srgb, var(--dsw-alias-brand-primary) 18%, transparent); }
  .skin-gallery-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 7px; max-height: 300px; overflow: auto; padding: 2px; contain: content; }
  .skin-gallery-card { display: grid; grid-template-columns: 32px minmax(0, 1fr); align-items: center; gap: 8px; min-width: 0; padding: 8px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); cursor: pointer; font: inherit; text-align: left; }
  .skin-gallery-card:hover { border-color: var(--dsw-alias-brand-primary); }
  .skin-gallery-card.is-active { border-color: var(--dsw-alias-brand-primary); box-shadow: 0 0 0 2px color-mix(in srgb, var(--dsw-alias-brand-primary) 20%, transparent); }
  .skin-gallery-swatch { width: 30px; height: 22px; border-radius: 6px; border: 1px solid rgba(127,127,127,.3); }
  .skin-gallery-copy { min-width: 0; display: grid; gap: 2px; }
  .skin-gallery-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
  .skin-gallery-meta { color: var(--dsw-alias-label-secondary); font-size: 10px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .skin-gallery-empty { padding: 14px; border: 1px dashed var(--dsw-alias-border-l2); border-radius: 10px; color: var(--dsw-alias-label-secondary); text-align: center; font-size: 12px; }
  @media (max-width: 900px) { .skin-gallery-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
  @media (max-width: 680px) { .skin-gallery-grid { grid-template-columns: 1fr; } }
`

function apply(ctx) {
  const slots = ctx.get('slots')
  if (slots === undefined) return

  const stored = readStored(STORAGE_SKIN, '')
  if (skinEngine && SKINS.some((item) => item.id === stored)) {
    void activateSkin(stored)
  }

  ctx.effect(() => () => teardown())

  function SkinGallery() {
    const [query, setQuery] = React.useState('')
    const [busy, setBusy] = React.useState(false)
    const [, force] = React.useState(0)
    React.useEffect(() => subscribe(() => force((value) => value + 1)), [])

    if (!skinEngine) {
      return React.createElement('div', { className: 'skin-gallery-empty' }, '皮肤轨道不可用：宿主未提供 __DSH_MODULES__。')
    }

    const normalized = query.trim().toLowerCase()
    const visible = SKINS.filter((item) => !normalized || (item.name + ' ' + item.nameEn + ' ' + item.id).toLowerCase().includes(normalized))
    const state = currentSkinState()
    const choose = async (id) => {
      setBusy(true)
      try { await activateSkin(id) } finally { setBusy(false) }
    }

    return React.createElement('div', { className: 'skin-gallery-root' },
      React.createElement('div', { className: 'skin-gallery-heading' },
        React.createElement('div', { className: 'skin-gallery-title' }, '完整皮肤'),
        React.createElement('div', { className: 'skin-gallery-count' }, visible.length + ' / ' + SKINS.length)
      ),
      React.createElement('div', { className: 'skin-gallery-hint' }, '完整皮肤会改变背景、控件与界面装饰。主题包中的轻量主题请回到“精选主题”选择。'),
      React.createElement('input', {
        className: 'skin-gallery-search', type: 'search', value: query,
        placeholder: '搜索皮肤…', 'aria-label': '搜索皮肤',
        onChange: (event) => setQuery(event.target.value),
      }),
      visible.length === 0
        ? React.createElement('div', { className: 'skin-gallery-empty' }, '没有匹配的皮肤')
        : React.createElement('div', { className: 'skin-gallery-grid' }, ...visible.map((item) =>
            React.createElement('button', {
              key: item.id, type: 'button', disabled: busy,
              className: 'skin-gallery-card' + (state.skinId === item.id ? ' is-active' : ''),
              'aria-pressed': state.skinId === item.id,
              onClick: () => choose(item.id),
            },
              React.createElement('span', { className: 'skin-gallery-swatch', style: { background: item.accent } }),
              React.createElement('span', { className: 'skin-gallery-copy' },
                React.createElement('span', { className: 'skin-gallery-name' }, item.name),
                React.createElement('span', { className: 'skin-gallery-meta' }, item.author)
              )
            )
          ))
    )
  }

  ctx.effect(() => {
    const element = document.createElement('style')
    element.setAttribute('data-skin-gallery', '')
    element.textContent = CSS
    document.head.appendChild(element)
    return () => element.remove()
  })

  slots.inject('settings.general.item', () => slots.register(
    { name: 'settings.general.item', id: 'skin-gallery', order: 12 },
    SkinGallery,
  ))
}
