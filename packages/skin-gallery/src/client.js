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
  try { localStorage.removeItem(STORAGE_SKIN) } catch {}
  notify()
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
  .skin-gallery-actions { display: flex; gap: 8px; flex-wrap: wrap; }
  .skin-gallery-action { min-height: 32px; padding: 0 12px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 9px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-secondary); cursor: pointer; font: inherit; font-size: 12px; }
  .skin-gallery-action:hover { border-color: var(--dsw-alias-brand-primary); color: var(--dsw-alias-label-primary); }
  .skin-gallery-action-primary { color: var(--dsw-alias-label-primary-foreground); border-color: var(--dsw-alias-brand-primary); background: var(--dsw-alias-brand-primary); }
  .skin-gallery-design { display: grid; gap: 10px; padding: 12px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 12px; background: var(--dsw-alias-bg-layer-1); }
  .skin-gallery-design-title { color: var(--dsw-alias-label-primary); font-size: 13px; font-weight: 600; }
  .skin-gallery-design-text { color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; }
  .skin-gallery-design-options { display: flex; flex-wrap: wrap; gap: 6px; }
  .skin-gallery-design-option { padding: 5px 9px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 999px; background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer; font: inherit; font-size: 12px; }
  .skin-gallery-design-option.is-selected { color: var(--dsw-alias-label-primary-foreground); border-color: var(--dsw-alias-brand-primary); background: var(--dsw-alias-brand-primary); }
  .skin-gallery-design-output { min-height: 84px; padding: 10px; border: 1px dashed var(--dsw-alias-border-l2); border-radius: 9px; color: var(--dsw-alias-label-secondary); background: var(--dsw-alias-bg-layer-2); font: 12px/18px var(--ds-font-family-code, ui-monospace, monospace); white-space: pre-wrap; }
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
    const [designOpen, setDesignOpen] = React.useState(false)
    const [designParts, setDesignParts] = React.useState(['颜色', '气泡', '代码块'])
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
    const resetToDefault = () => {
      clearSkin()
      setDesignOpen(false)
    }
    const togglePart = (part) => {
      setDesignParts((parts) => parts.includes(part) ? parts.filter((item) => item !== part) : [...parts, part])
    }
    const designSummary = [
      '我想创建一个自定义 DSH 皮肤。请先询问我以下信息，再生成实现方案：',
      '1. 皮肤名称和整体风格；',
      '2. 浅色/深色背景、主色、文字色、边框色；',
      '3. 消息气泡、代码块、按钮、侧栏、输入框分别如何设计；',
      '4. 是否需要背景图、标题栏、状态栏、动效或特殊控件；',
      '5. 必须保证消息气泡和代码块背景与文字有足够对比度。',
      '当前选择的版块：' + designParts.join('、'),
      '请先向我提问确认设计，不要直接生成代码。',
    ].join('\n')

    return React.createElement('div', { className: 'skin-gallery-root' },
      React.createElement('div', { className: 'skin-gallery-heading' },
        React.createElement('div', { className: 'skin-gallery-title' }, '完整皮肤'),
        React.createElement('div', { className: 'skin-gallery-count' }, visible.length + ' / ' + SKINS.length)
      ),
      React.createElement('div', { className: 'skin-gallery-hint' }, '完整皮肤会改变背景、控件与界面装饰。主题包中的轻量主题请回到“精选主题”选择。'),
      React.createElement('div', { className: 'skin-gallery-actions' },
        React.createElement('button', {
          type: 'button', className: 'skin-gallery-action', disabled: busy || !state.active,
          onClick: resetToDefault,
        }, '恢复默认外观'),
        React.createElement('button', {
          type: 'button', className: 'skin-gallery-action skin-gallery-action-primary', disabled: busy,
          onClick: () => setDesignOpen(!designOpen),
        }, designOpen ? '收起自定义皮肤' : '创建自定义皮肤')
      ),
      designOpen && React.createElement('div', { className: 'skin-gallery-design' },
        React.createElement('div', { className: 'skin-gallery-design-title' }, '自定义皮肤设计助手'),
        React.createElement('div', { className: 'skin-gallery-design-text' }, '选择你关心的版块，把下面的设计需求复制到对话里。AI 会先询问你设计细节，再决定是否需要 JavaScript 控件、背景图或动效。'),
        React.createElement('div', { className: 'skin-gallery-design-options' },
          ...['颜色', '气泡', '代码块', '按钮', '侧栏', '输入框', '背景图', '标题栏', '状态栏', '动效', 'JavaScript 控件'].map((part) => React.createElement('button', {
            key: part, type: 'button',
            className: 'skin-gallery-design-option' + (designParts.includes(part) ? ' is-selected' : ''),
            onClick: () => togglePart(part),
          }, part))
        ),
        React.createElement('textarea', {
          className: 'skin-gallery-design-output', readOnly: true, value: designSummary,
          'aria-label': '自定义皮肤设计需求',
          onFocus: (event) => event.target.select(),
        })
      ),
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
