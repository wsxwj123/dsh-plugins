// theme-gallery client — 内置主题家族 + 自定义主题（CSS-only JSON 导入 / 试穿 / 应用 / 删除 / 恢复）
//
// 内置 15 主题家族显示在此；自定义主题走 createCustomThemeApi（见 custom-theme.js，CSS-only，
// 只注入 CSS 变量，不执行 JS）。明暗模式由 DSH 的"外观"设置统一控制；
// theme 轨道与 skin 轨道经 dsh-appearance-track-v1 软互斥。

const STORAGE_FAMILY_KEY = 'theme-gallery-family-v5'

function readStored(key, fallback = '') {
  try { return localStorage.getItem(key) || fallback } catch { return fallback }
}

function writeStored(key, value) {
  try { localStorage.setItem(key, value) } catch {}
}

function initialFamily() {
  const stored = readStored(STORAGE_FAMILY_KEY, 'jade')
  return THEME_FAMILIES.some((item) => item.id === stored) ? stored : 'jade'
}

const CSS = `
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
  .theme-gallery-custom-item { display: flex; align-items: center; gap: 8px; padding: 8px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 9px; }
  .theme-gallery-custom-item.is-active { border-color: var(--dsw-alias-brand-primary); box-shadow: 0 0 0 2px color-mix(in srgb, var(--dsw-alias-brand-primary) 20%, transparent); }
  .theme-gallery-custom-ops { margin-left: auto; display: flex; gap: 6px; }
  .theme-gallery-empty { padding: 14px; border: 1px dashed var(--dsw-alias-border-l2); border-radius: 10px; color: var(--dsw-alias-label-secondary); text-align: center; font-size: 12px; }
  .theme-gallery-err { color: var(--dsw-alias-state-error-primary); font-size: 11px; }
  @media (max-width: 900px) { .theme-gallery-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
  @media (max-width: 680px) { .theme-gallery-grid { grid-template-columns: 1fr; } }
`

function apply(ctx) {
  const themeService = ctx.get('theme')
  const slots = ctx.get('slots')
  if (themeService === undefined || slots === undefined) return

  let removeOverride = null
  // 自定义主题 API：storage 接 localStorage，applyTokens 接真实 overrideTokens（CSS-only）。
  const customApi = createCustomThemeApi({
    storage: localStorage,
    builtinThemes: THEME_FAMILIES,
    applyTokens: (tokens) => {
      if (removeOverride) removeOverride()
      removeOverride = themeService.overrideTokens('dsh-theme-gallery', tokens)
    },
  })

  let selected = initialFamily()
  const listeners = new Set()
  const notify = () => { for (const listener of listeners) listener(selected) }
  const subscribe = (listener) => { listeners.add(listener); return () => listeners.delete(listener) }

  const paintBuiltin = (familyId) => {
    const family = THEME_FAMILIES.find((item) => item.id === familyId) || THEME_FAMILIES[0]
    selected = family.id
    if (removeOverride) removeOverride()
    removeOverride = themeService.overrideTokens('dsh-theme-gallery', family.tokens)
  }

  const activate = (familyId) => {
    paintBuiltin(familyId)
    writeStored(STORAGE_FAMILY_KEY, selected)
    customApi.activateFamily(familyId)
    notify()
  }

  ctx.effect(() => () => { if (removeOverride) removeOverride() })

  // 页面加载恢复：已应用自定义主题优先，否则内置。
  const appliedId = customApi.getCustomAppliedId()
  const hasCustomApplied = customApi.getCustomThemes().some((t) => t.id === appliedId)
  if (hasCustomApplied) {
    if (removeOverride) removeOverride()
    customApi.applyCustomTheme(appliedId)
  } else {
    activate(initialFamily())
  }

  function ThemeGallery() {
    const [query, setQuery] = React.useState('')
    const [json, setJson] = React.useState('')
    const [customOpen, setCustomOpen] = React.useState(false)
    const [err, setErr] = React.useState('')
    const [, force] = React.useState(0)
    React.useEffect(() => subscribe((id) => { selected = id; force((v) => v + 1) }), [])

    const normalized = query.trim().toLowerCase()
    const visible = THEME_FAMILIES.filter((item) => !normalized || (item.label + ' ' + item.id).toLowerCase().includes(normalized))
    const effectiveActive = () => customApi.getCustomAppliedId()

    const doImport = async () => {
      setErr('')
      try {
        await customApi.importCustomTheme(json)
        setJson('')
        force((v) => v + 1)
      } catch (e) {
        setErr(e && e.code ? `${e.code}: ${e.message}` : ((e && e.message) || '导入失败'))
      }
    }
    const doPreview = (id) => { try { customApi.previewCustomTheme(id); force((v) => v + 1) } catch (e) { setErr(e && e.message) } }
    const doApply = (id) => { try { customApi.applyCustomTheme(id); force((v) => v + 1) } catch (e) { setErr(e && e.message) } }
    const doDelete = (id) => { try { customApi.deleteCustomTheme(id); force((v) => v + 1) } catch (e) { setErr(e && e.message) } }
    const doRestore = () => { customApi.restoreDefaultTheme(); activate('jade') }

    const customs = customApi.getCustomThemes()
    const activeId = effectiveActive()

    return React.createElement('div', { className: 'theme-gallery-root' },
      React.createElement('div', { className: 'theme-gallery-heading' },
        React.createElement('div', { className: 'theme-gallery-title' }, '精选主题'),
        React.createElement('div', { className: 'theme-gallery-count' }, visible.length + ' / ' + THEME_FAMILIES.length)
      ),
      React.createElement('div', { className: 'theme-gallery-hint' }, '明暗模式由 DSH 的“外观”设置统一控制；选择“跟随系统”时主题会自动切换。'),
      React.createElement('input', {
        className: 'theme-gallery-search', type: 'search', value: query,
        placeholder: '搜索主题…', 'aria-label': '搜索主题',
        onChange: (event) => setQuery(event.target.value),
      }),
      visible.length === 0
        ? React.createElement('div', { className: 'theme-gallery-empty' }, '没有匹配的主题')
        : React.createElement('div', { className: 'theme-gallery-grid' }, ...visible.map((item) => React.createElement('button', {
            key: item.id, type: 'button',
            className: 'theme-gallery-card' + (item.id === activeId ? ' is-active' : ''),
            'aria-pressed': item.id === activeId,
            onClick: () => activate(item.id),
          },
            React.createElement('span', { className: 'theme-gallery-swatches' },
              React.createElement('span', { className: 'theme-gallery-swatch', style: { background: item.preview.light.background } },
                React.createElement('span', { style: { background: item.preview.light.accent } })
              ),
              React.createElement('span', { className: 'theme-gallery-swatch', style: { background: item.preview.dark.background } },
                React.createElement('span', { style: { background: item.preview.dark.accent } })
              )
            ),
            React.createElement('span', { className: 'theme-gallery-copy' },
              React.createElement('span', { className: 'theme-gallery-name' }, item.label),
              React.createElement('span', { className: 'theme-gallery-meta' }, '跟随 DSH 外观')
            )
          ))),
      React.createElement('div', { className: 'theme-gallery-actions' },
        React.createElement('button', {
          type: 'button', className: 'theme-gallery-action theme-gallery-action-primary',
          onClick: () => setCustomOpen(!customOpen),
        }, customOpen ? '收起自定义主题' : '创建自定义主题'),
        React.createElement('button', {
          type: 'button', className: 'theme-gallery-action', onClick: doRestore,
        }, '恢复默认主题')
      ),
      customOpen && React.createElement('div', { className: 'theme-gallery-custom' },
        React.createElement('div', { className: 'theme-gallery-custom-title' }, '自定义主题'),
        React.createElement('div', { className: 'theme-gallery-custom-text' }, '粘贴 JSON（含 id / label / tokens，token 名以 --dsw- 开头且含 light+dark）。仅注入 CSS 变量，不执行任何 JS。'),
        React.createElement('textarea', {
          className: 'theme-gallery-import', value: json, 'aria-label': '自定义主题 JSON',
          placeholder: '{ "id": "my-jade-tweak", "label": "我的主题", "tokens": { "--dsw-alias-bg-base": { "light": "#fff", "dark": "#111" } } }',
          onChange: (event) => setJson(event.target.value),
        }),
        err && React.createElement('div', { className: 'theme-gallery-err' }, err),
        React.createElement('div', { className: 'theme-gallery-actions' },
          React.createElement('button', { type: 'button', className: 'theme-gallery-action theme-gallery-action-primary', onClick: doImport, disabled: !json.trim() }, '导入主题')
        ),
        customs.length === 0
          ? null
          : React.createElement('div', { className: 'theme-gallery-grid' }, ...customs.map((item) =>
              React.createElement('div', {
                key: item.id, className: 'theme-gallery-custom-item' + (item.id === activeId ? ' is-active' : ''),
              },
                React.createElement('span', { className: 'theme-gallery-copy' },
                  React.createElement('span', { className: 'theme-gallery-name' }, item.label),
                  React.createElement('span', { className: 'theme-gallery-meta' }, item.id)
                ),
                React.createElement('span', { className: 'theme-gallery-custom-ops' },
                  React.createElement('button', { type: 'button', className: 'theme-gallery-action', onClick: () => doPreview(item.id) }, '试穿'),
                  React.createElement('button', { type: 'button', className: 'theme-gallery-action', onClick: () => doApply(item.id) }, '应用'),
                  React.createElement('button', { type: 'button', className: 'theme-gallery-action', onClick: () => doDelete(item.id) }, '删除')
                )
              )
            ))
      )
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
    ThemeGallery,
  ))
}
