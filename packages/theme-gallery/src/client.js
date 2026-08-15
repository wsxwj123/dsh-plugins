const STORAGE_FAMILY = 'theme-gallery-family-v5'

function readStored(key, fallback = '') {
  try { return localStorage.getItem(key) || fallback } catch { return fallback }
}

function writeStored(key, value) {
  try { localStorage.setItem(key, value) } catch {}
}

function initialFamily() {
  const stored = readStored(STORAGE_FAMILY, 'jade')
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
  .theme-gallery-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 7px; max-height: 270px; overflow: auto; padding: 2px; contain: content; }
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

  let selected = initialFamily()
  let removeOverride = null
  const listeners = new Set()
  const notify = () => { for (const listener of listeners) listener(selected) }
  const subscribe = (listener) => { listeners.add(listener); return () => listeners.delete(listener) }

  const activate = (familyId) => {
    const family = THEME_FAMILIES.find((item) => item.id === familyId) || THEME_FAMILIES[0]
    selected = family.id
    if (removeOverride) removeOverride()
    removeOverride = themeService.overrideTokens('dsh-theme-gallery', family.tokens)
    writeStored(STORAGE_FAMILY, selected)
    notify()
  }

  ctx.effect(() => () => { if (removeOverride) removeOverride() })
  activate(selected)

  function ThemeGallery() {
    const [active, setActive] = React.useState(selected)
    const [query, setQuery] = React.useState('')
    React.useEffect(() => subscribe(setActive), [])

    const normalized = query.trim().toLowerCase()
    const visible = THEME_FAMILIES.filter((item) => !normalized || (item.label + ' ' + item.id).toLowerCase().includes(normalized))

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
            className: 'theme-gallery-card' + (active === item.id ? ' is-active' : ''),
            'aria-pressed': active === item.id,
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
          )))
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
