/**
 * panel-theme.js — 主题区 UI 工厂（INTERFACE §3.9）。
 *
 * createThemePanel({ React, families, customThemeApi, activateFamily, subscribe, onBack }) -> { Panel, ... }
 *
 * 为什么是工厂而不是顶层组件：build.mjs 把所有 src 文件拼进同一个 factory 作用域，
 * 两份 UI 的顶层同名标识符（CSS / readStored / notify / apply …）会直接 SyntaxError。
 * 收进函数体即根治（PLAN D4）。
 *
 * 边界：本文件只做 UI。不建引擎、不做启动恢复、不持有 token override 句柄（INTERFACE §3.0），
 * 也不引用 apply 层的任何模块级标识符。
 *
 * UI 态放在工厂闭包的 state 对象里、用一个 useState 计数触发重渲染：
 * 面板是懒挂载的，若把 search/error 放进组件 hooks，每次开合都会丢，且外部无法驱动。
 */

const THEME_SEARCH_MAX = 64

export function createThemePanel(deps) {
  for (const field of ['React', 'families', 'customThemeApi', 'activateFamily', 'subscribe', 'onBack']) {
    if (deps === undefined || deps === null || deps[field] === undefined) {
      throw new Error(`createThemePanel 缺 deps.${field}`)
    }
  }
  const { React, families, customThemeApi, activateFamily, subscribe, onBack } = deps
  // blank() 在工厂内声明：build.mjs 把所有 src 拼进同一作用域，顶层同名标识符会 SyntaxError。
  const blank = () => ({ search: '', json: '', error: '' })
  const state = blank()

  /** §3.0：面板 UI 态卸载即丢。就地改字段而非换对象——外部（含测试）持有 state 引用。 */
  const reset = () => { Object.assign(state, blank()) }

  const setSearch = (value) => { state.search = String(value === undefined ? '' : value).slice(0, THEME_SEARCH_MAX) }

  async function submitImport(text) {
    state.error = ''
    try {
      const item = await customThemeApi.importCustomTheme(text)
      state.json = ''
      return item
    } catch (e) {
      state.error = e && e.code ? `${e.code}: ${e.message}` : ((e && e.message) || '导入失败')
      return null
    }
  }

  const runSync = (fn) => {
    state.error = ''
    try { fn() } catch (e) { state.error = e && e.code ? `${e.code}: ${e.message}` : ((e && e.message) || '操作失败') }
  }

  const Panel = () => {
    const [, force] = React.useState(0)
    const rerender = () => force((v) => v + 1)
    React.useEffect(() => subscribe(rerender), [])

    const query = state.search.trim().toLowerCase()
    const visible = families.filter((item) => !query || `${item.label} ${item.id}`.toLowerCase().includes(query))
    const customs = customThemeApi.getCustomThemes()
    const activeId = customThemeApi.getCustomAppliedId()

    const card = (item) => React.createElement('button', {
      key: item.id,
      type: 'button',
      className: 'theme-gallery-card' + (item.id === activeId ? ' is-active' : ''),
      'aria-pressed': item.id === activeId,
      onClick: () => { activateFamily(item.id); rerender() },
    },
      React.createElement('span', { className: 'theme-gallery-swatches' },
        React.createElement('span', { className: 'theme-gallery-swatch', style: { background: item.preview.light.background } },
          React.createElement('span', { style: { background: item.preview.light.accent } })),
        React.createElement('span', { className: 'theme-gallery-swatch', style: { background: item.preview.dark.background } },
          React.createElement('span', { style: { background: item.preview.dark.accent } }))),
      React.createElement('span', { className: 'theme-gallery-copy' },
        React.createElement('span', { className: 'theme-gallery-name' }, item.label),
        React.createElement('span', { className: 'theme-gallery-meta' }, '跟随 DSH 外观')))

    const customRow = (item) => React.createElement('div', {
      key: item.id,
      className: 'theme-gallery-custom-item' + (item.id === activeId ? ' is-active' : ''),
    },
      React.createElement('span', { className: 'theme-gallery-copy' },
        React.createElement('span', { className: 'theme-gallery-name' }, item.label),
        React.createElement('span', { className: 'theme-gallery-meta' }, item.id)),
      React.createElement('span', { className: 'theme-gallery-custom-ops' },
        React.createElement('button', {
          type: 'button', className: 'theme-gallery-action',
          onClick: () => runSync(() => { customThemeApi.previewCustomTheme(item.id); rerender() }),
        }, '试穿'),
        React.createElement('button', {
          type: 'button', className: 'theme-gallery-action',
          onClick: () => runSync(() => { customThemeApi.applyCustomTheme(item.id); rerender() }),
        }, '应用'),
        React.createElement('button', {
          type: 'button', className: 'theme-gallery-action',
          onClick: () => runSync(() => { customThemeApi.deleteCustomTheme(item.id); rerender() }),
        }, '删除')))

    return React.createElement('div', { className: 'theme-gallery-root' },
      React.createElement('div', { className: 'theme-gallery-heading' },
        React.createElement('div', { className: 'theme-gallery-title' }, '精选主题'),
        React.createElement('div', { className: 'theme-gallery-count' }, `${visible.length}/${families.length}`)),
      React.createElement('div', { className: 'theme-gallery-hint' },
        '明暗模式由 DSH 的“外观”设置统一控制；选择“跟随系统”时主题会自动切换。'),
      React.createElement('input', {
        className: 'theme-gallery-search', type: 'search', value: state.search,
        placeholder: '搜索主题…', 'aria-label': '搜索主题',
        maxLength: THEME_SEARCH_MAX,
        onChange: (event) => { setSearch(event.target.value); rerender() },
      }),
      visible.length === 0
        ? React.createElement('div', { className: 'theme-gallery-empty' }, '没有匹配的主题')
        : React.createElement('div', { className: 'theme-gallery-grid' }, ...visible.map(card)),
      React.createElement('div', { className: 'theme-gallery-custom' },
        React.createElement('div', { className: 'theme-gallery-custom-title' }, '自定义主题'),
        React.createElement('div', { className: 'theme-gallery-custom-text' },
          '粘贴 JSON（含 id / label / tokens，token 名以 --dsw- 开头且含 light+dark）。仅注入 CSS 变量，不执行任何 JS。'),
        React.createElement('textarea', {
          className: 'theme-gallery-import', value: state.json, 'aria-label': '自定义主题 JSON',
          placeholder: '{ "id": "my-jade-tweak", "label": "我的主题", "tokens": { "--dsw-alias-bg-base": { "light": "#fff", "dark": "#111" } } }',
          onChange: (event) => { state.json = event.target.value; rerender() },
        }),
        // §3.8：错误文案只作为 React text child 渲染，绝不走 HTML
        state.error ? React.createElement('div', { className: 'theme-gallery-err' }, state.error) : null,
        React.createElement('div', { className: 'theme-gallery-actions' },
          React.createElement('button', {
            type: 'button', className: 'theme-gallery-action theme-gallery-action-primary',
            disabled: !state.json.trim(),
            onClick: () => { void submitImport(state.json).then(rerender) },
          }, '导入主题'),
          React.createElement('button', {
            type: 'button', className: 'theme-gallery-action',
            onClick: () => { customThemeApi.restoreDefaultTheme(); activateFamily('jade'); rerender() },
          }, '恢复默认主题')),
        customs.length === 0 ? null : React.createElement('div', { className: 'theme-gallery-custom-list' }, ...customs.map(customRow))),
      // aria-label 区分同名「返回」（另两个在皮肤区与入口面板底部），可见文案不变
      React.createElement('button', { className: 'theme-gallery-action', type: 'button', 'aria-label': '返回设置（主题区）', onClick: onBack }, '返回'))
  }

  return { Panel, state, setSearch, submitImport, reset }
}
