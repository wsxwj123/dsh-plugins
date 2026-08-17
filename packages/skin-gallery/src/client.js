const CSS = `
  .skin-entry-root { display: grid; gap: 10px; padding: 4px 0; }
  .skin-entry-title { color: var(--dsw-alias-label-primary); font-size: 14px; font-weight: 600; }
  .skin-entry-hint { color: var(--dsw-alias-label-secondary); font-size: 11px; line-height: 17px; }
  .skin-entry-button { min-height: 36px; padding: 0 14px; width: fit-content; border: 1px solid var(--dsw-alias-brand-primary); border-radius: 10px; background: var(--dsw-alias-brand-primary); color: var(--dsw-alias-label-primary-foreground); cursor: pointer; font: inherit; font-size: 12px; font-weight: 600; }
  .skin-entry-status { color: var(--dsw-alias-label-secondary); font-size: 11px; }
  .skin-entry-error { color: var(--dsw-alias-state-error-primary); font-size: 11px; }
`

function apply(ctx) {
  const slots = ctx.get('slots')
  if (slots === undefined) return

  let loaded = false
  let loading = false
  const listeners = new Set()
  const notify = () => { for (const listener of listeners) listener() }
  const subscribe = (listener) => { listeners.add(listener); return () => listeners.delete(listener) }

  async function openRuntime() {
    if (loaded) return true
    if (loading) return false
    const modules = globalThis.__DSH_MODULES__
    if (modules === undefined || typeof modules.import !== 'function') throw new Error('dsh-skin-runtime module system unavailable')
    loading = true
    notify()
    try {
      await modules.import('dsh-skin-runtime')
      loaded = true
      return true
    } finally {
      loading = false
      notify()
    }
  }

  function SkinEntry() {
    const [error, setError] = React.useState('')
    const [, force] = React.useState(0)
    React.useEffect(() => subscribe(() => force((value) => value + 1)), [])
    const open = async () => {
      setError('')
      try { await openRuntime() } catch (err) { setError(err && err.message ? err.message : String(err)) }
    }
    return React.createElement('div', { className: 'skin-entry-root' },
      React.createElement('div', { className: 'skin-entry-title' }, '完整皮肤'),
      React.createElement('div', { className: 'skin-entry-hint' }, '默认不加载 1.2MB 皮肤运行时；点击后才加载完整皮肤、导入、试穿、应用和删除功能。'),
      React.createElement('button', { type: 'button', className: 'skin-entry-button', disabled: loading, onClick: open }, loading ? '正在加载…' : loaded ? '已加载完整皮肤' : '打开完整皮肤'),
      error && React.createElement('div', { className: 'skin-entry-error' }, error)
    )
  }

  ctx.effect(() => {
    const element = document.createElement('style')
    element.setAttribute('data-skin-entry', '')
    element.textContent = CSS
    document.head.appendChild(element)
    return () => element.remove()
  })

  slots.inject('settings.general.item', () => slots.register(
    { name: 'settings.general.item', id: 'skin-gallery', order: 12 },
    SkinEntry,
  ))
}

exports.apply = apply
exports.inject = ['slots']
