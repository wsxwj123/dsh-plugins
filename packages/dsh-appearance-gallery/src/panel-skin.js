/**
 * panel-skin.js — 皮肤区 UI 工厂（INTERFACE §3.9）。
 *
 * createSkinPanel({ React, engine, customSkinApi, skinRuntime, subscribe, onBack }) -> { Panel, ... }
 *
 * 与 panel-theme.js 同样的边界：只做 UI，引擎实例 / 启动恢复 / 串行化闸 / 试穿撤销全在
 * apply 层（INTERFACE §3.0）；本文件不引用 apply 层的任何模块级标识符。
 *
 * engine 为 null（宿主没给 __DSH_MODULES__）时整段只渲染一行占位文案，S1–S8 全部入口不渲染。
 */

const SKIN_SEARCH_MAX = 64
const SKIN_UNAVAILABLE_TEXT = '皮肤轨道不可用：宿主未提供 __DSH_MODULES__。'
/** 设计助手的 11 个版块（顺序即勾选索引） */
const DESIGN_SECTIONS = [
  '颜色', '气泡', '代码块', '按钮', '侧栏', '输入框',
  '背景图', '标题栏', '状态栏', '动效', 'JavaScript 控件',
]

export function createSkinPanel(deps) {
  for (const field of ['React', 'customSkinApi', 'skinRuntime', 'subscribe', 'onBack']) {
    if (deps === undefined || deps === null || deps[field] === undefined) {
      throw new Error(`createSkinPanel 缺 deps.${field}`)
    }
  }
  const { React, engine, customSkinApi, skinRuntime, subscribe, onBack } = deps
  // blank() 在工厂内声明：build.mjs 把所有 src 拼进同一作用域，顶层同名标识符会 SyntaxError。
  const blank = () => ({
    search: '', skinText: '', clientText: '', a11yText: '', error: '',
    picked: [0, 1, 2], selectedForDelete: [], confirming: false, busy: false,
  })
  const state = blank()

  /** §3.0：面板 UI 态卸载即丢。就地改字段而非换对象——外部（含测试）持有 state 引用。 */
  const reset = () => { Object.assign(state, blank()) }

  const setSearch = (value) => { state.search = String(value === undefined ? '' : value).slice(0, SKIN_SEARCH_MAX) }
  const toggleSection = (index) => {
    state.picked = state.picked.includes(index)
      ? state.picked.filter((i) => i !== index)
      : state.picked.concat(index)
  }

  /**
   * 设计助手输出：这是给用户复制到对话里的**提示词模板**，属数据不属指令。
   * 仓库路径与验收命令随包名更新，其余文字逐字保留（INTERFACE §3.3 节末）。
   */
  const designSummary = () => [
    '我想创建一个自定义 DSH 皮肤。请按 dsh-appearance-gallery 的皮肤包格式交付，不要生成独立 Cordis 插件。',
    '',
    '【交付路径】',
    '把文件放入 dsh-plugins 仓库的相对路径：packages/dsh-appearance-gallery/skins/<skin-id>/',
    '不要使用绝对路径，不要放到用户主目录或 ~/.dsh。',
    'id 不要用 Windows 保留名（con / prn / aux / nul / com1-9 / lpt1-9），否则在 Windows 上无法创建同名目录。',
    '',
    '【交付格式】',
    'packages/dsh-appearance-gallery/skins/<skin-id>/',
    '├── skin.json',
    '├── client.js',
    '└── a11y.css',
    '',
    '【skin.json 必填字段】',
    '{',
    '  "id": "<skin-id>",',
    '  "name": "皮肤中文名",',
    '  "nameEn": "English Name",',
    '  "author": "作者名",',
    '  "license": "MIT 或 BSD-3-Clause",',
    '  "tagline": "一句话描述",',
    '  "accent": "#主色",',
    '  "bodyAttr": "data-dsh-<skin-id>",',
    '  "order": 100',
    '}',
    '',
    '【client.js 契约】',
    '1. 必须调用 window.__ModuleLoader__.load({ id, factory })；',
    '2. factory 必须返回 { apply(ctx) }；',
    '3. apply(ctx) 产生的 CSS、DOM、事件、定时器必须全部通过 ctx.effect() 注册可逆清理；',
    '4. 只能使用 ctx.effect() / ctx.get()，禁止读取其他服务；',
    '5. 禁止 eval、new Function、fetch、XMLHttpRequest、WebSocket、动态 import、require、document.cookie、localStorage/sessionStorage 直读写；',
    '6. 不允许修改全局键盘/鼠标行为；',
    '7. 不允许覆盖 html/body 的整体布局；',
    '8. 如需背景图、标题栏、状态栏、动效或 JavaScript 控件，先说明原因并征得确认。',
    '',
    '【a11y.css 标准】',
    '只写可读性修正：消息气泡、代码块、行内代码、按钮文字、主按钮悬停；必须同时覆盖浅色和深色。',
    '',
    '【验收标准】',
    '交付后必须能通过：',
    'pnpm --filter dsh-appearance-gallery build',
    'pnpm --filter dsh-appearance-gallery check',
    'pnpm --filter dsh-appearance-gallery test',
    '并在设置页支持：试穿、应用、恢复默认、切换后无残留。',
    '',
    '【设计前请先询问】',
    '1. 皮肤名称和整体风格；',
    '2. 浅色/深色背景、主色、文字色、边框色；',
    '3. 消息气泡、代码块、按钮、侧栏、输入框分别如何设计；',
    '4. 是否需要背景图、标题栏、状态栏、动效或特殊控件；',
    '5. 如何保证气泡和代码块背景与文字有足够对比度。',
    '当前选择的版块：' + state.picked.slice().sort((a, b) => a - b).map((i) => DESIGN_SECTIONS[i]).join('、'),
    '请先向我提问确认设计，不要直接生成代码。',
  ].join('\n')

  async function submitImport(parts) {
    state.error = ''
    try {
      const item = await customSkinApi.importCustomSkin(parts)
      state.skinText = ''; state.clientText = ''; state.a11yText = ''
      return item
    } catch (e) {
      state.error = e && e.code ? `${e.code}: ${e.message}` : ((e && e.message) || '导入失败')
      return null
    }
  }

  const Panel = () => {
    const [, force] = React.useState(0)
    const rerender = () => force((v) => v + 1)
    React.useEffect(() => subscribe(rerender), [])

    if (engine === null || engine === undefined) {
      return React.createElement('div', { className: 'skin-gallery-root' },
        React.createElement('div', { className: 'skin-gallery-empty' }, SKIN_UNAVAILABLE_TEXT))
    }

    const guard = async (fn) => {
      state.busy = true; rerender()
      try { await fn() } catch (e) {
        state.error = e && e.code ? `${e.code}: ${e.message}` : ((e && e.message) || '操作失败')
      } finally { state.busy = false; rerender() }
    }

    const query = state.search.trim().toLowerCase()
    const allSkins = customSkinApi.getSkins()
    const customSkins = customSkinApi.getCustomSkins()
    const current = customSkinApi.currentSkinState()
    const previewState = skinRuntime.getPreviewState()
    const visible = allSkins.filter((item) => !query
      || `${item.name} ${item.nameEn || ''} ${item.id}`.toLowerCase().includes(query))

    const toggleDelete = (id) => {
      state.selectedForDelete = state.selectedForDelete.includes(id)
        ? state.selectedForDelete.filter((x) => x !== id)
        : state.selectedForDelete.concat(id)
      rerender()
    }

    const card = (item) => React.createElement('div', {
      key: item.id,
      className: 'skin-gallery-card' + (current.skinId === item.id ? ' is-active' : ''),
    },
      React.createElement('button', {
        type: 'button', className: 'skin-gallery-card-main', disabled: state.busy,
        onClick: () => guard(() => customSkinApi.choose(item.id)),
      },
        React.createElement('span', { className: 'skin-gallery-swatch', style: { background: item.accent } }),
        React.createElement('span', { className: 'skin-gallery-copy' },
          // 用户可控内容（name / author）只作 text child
          React.createElement('span', { className: 'skin-gallery-name' }, item.name),
          React.createElement('span', { className: 'skin-gallery-meta' },
            (item.source === 'custom' ? '自定义 · ' : '') + item.author))),
      React.createElement('div', { className: 'skin-gallery-card-actions' },
        React.createElement('button', {
          type: 'button', disabled: state.busy,
          className: 'skin-gallery-action' + (previewState.skinId === item.id ? ' is-current' : ''),
          onClick: () => guard(() => (item.source === 'custom'
            ? customSkinApi.previewCustomSkin(item.id)
            : skinRuntime.previewSkin(item.id))),
        }, previewState.skinId === item.id ? '试穿中' : '试穿'),
        React.createElement('button', {
          type: 'button', disabled: state.busy,
          className: 'skin-gallery-action skin-gallery-action-primary' + (current.skinId === item.id ? ' is-current' : ''),
          onClick: () => guard(() => (item.source === 'custom'
            ? customSkinApi.applyCustomSkin(item.id)
            : skinRuntime.applySkin(item.id))),
        }, current.skinId === item.id ? '已应用' : '应用'),
        item.source === 'custom' ? React.createElement('label', { className: 'skin-gallery-design-option' },
          React.createElement('input', {
            type: 'checkbox', checked: state.selectedForDelete.includes(item.id),
            onChange: () => toggleDelete(item.id),
          }), ' 勾选删除') : null))

    return React.createElement('div', { className: 'skin-gallery-root' },
      React.createElement('div', { className: 'skin-gallery-heading' },
        React.createElement('div', { className: 'skin-gallery-title' }, '完整皮肤'),
        React.createElement('div', { className: 'skin-gallery-count' }, `${visible.length}/${allSkins.length}`)),
      React.createElement('div', { className: 'skin-gallery-hint' },
        '完整皮肤会改变背景、控件与界面装饰。轻量主题请回到“精选主题”选择。'),
      React.createElement('div', { className: 'skin-gallery-actions' },
        React.createElement('button', {
          type: 'button', className: 'skin-gallery-action', disabled: state.busy,
          onClick: () => guard(async () => {
            await skinRuntime.clearSkin()
            customSkinApi.restoreDefaultSkin()
            state.selectedForDelete = []
            state.confirming = false
          }),
        }, '恢复默认外观')),
      React.createElement('input', {
        className: 'skin-gallery-search', type: 'search', value: state.search,
        placeholder: '搜索皮肤…', 'aria-label': '搜索皮肤', maxLength: SKIN_SEARCH_MAX,
        onChange: (event) => { setSearch(event.target.value); rerender() },
      }),
      visible.length === 0
        ? React.createElement('div', { className: 'skin-gallery-empty' }, '没有匹配的皮肤')
        : React.createElement('div', { className: 'skin-gallery-grid' }, ...visible.map(card)),
      React.createElement('div', { className: 'skin-gallery-design' },
        React.createElement('div', { className: 'skin-gallery-design-title' }, '创建自定义皮肤'),
        React.createElement('div', { className: 'skin-gallery-design-text' },
          '选择你关心的版块，把下面的设计需求复制到对话里。'),
        React.createElement('div', { className: 'skin-gallery-design-options' },
          ...DESIGN_SECTIONS.map((part, index) => React.createElement('button', {
            key: part, type: 'button',
            className: 'skin-gallery-design-option' + (state.picked.includes(index) ? ' is-selected' : ''),
            onClick: () => { toggleSection(index); rerender() },
          }, part))),
        React.createElement('textarea', {
          className: 'skin-gallery-design-output', readOnly: true, value: designSummary(),
          'aria-label': '自定义皮肤设计需求',
          onFocus: (event) => event.target.select(),
        })),
      React.createElement('div', { className: 'skin-gallery-import' },
        React.createElement('div', { className: 'skin-gallery-import-title' }, '导入皮肤'),
        React.createElement('div', { className: 'skin-gallery-import-text' },
          '受控包格式：skin.json（含 author / license）+ client.js（须注册 __ModuleLoader__.load 并导出 apply(ctx)）+ 可选 a11y.css。仅按契约校验并注入，绝不执行包内文字。'),
        React.createElement('textarea', {
          className: 'skin-gallery-import-field', value: state.skinText, 'aria-label': 'skin.json',
          placeholder: '{ "id": "my-skin", "name": "我的皮肤", "author": "作者", "license": "BSD-3-Clause" }',
          onChange: (event) => { state.skinText = event.target.value; rerender() },
        }),
        React.createElement('textarea', {
          className: 'skin-gallery-import-field', value: state.clientText, 'aria-label': 'client.js',
          placeholder: 'window.__ModuleLoader__.load({ id: "my-skin", factory: () => ({ apply(ctx) { ctx.effect(...) } }) })',
          onChange: (event) => { state.clientText = event.target.value; rerender() },
        }),
        React.createElement('textarea', {
          className: 'skin-gallery-import-field', value: state.a11yText, 'aria-label': 'a11y.css',
          placeholder: 'a11y.css（可选，缺失则降级，皮肤仍可用）',
          onChange: (event) => { state.a11yText = event.target.value; rerender() },
        }),
        state.error ? React.createElement('div', { className: 'skin-gallery-import-err' }, state.error) : null,
        React.createElement('button', {
          type: 'button', className: 'skin-gallery-action skin-gallery-action-primary',
          disabled: !state.skinText.trim() || !state.clientText.trim(),
          onClick: () => {
            void submitImport({
              skin: state.skinText, client: state.clientText, a11y: state.a11yText || undefined,
            }).then(rerender)
          },
        }, '导入皮肤包')),
      customSkins.length === 0 ? null : React.createElement('div', { className: 'skin-gallery-design' },
        React.createElement('div', { className: 'skin-gallery-design-title' }, '删除皮肤'),
        React.createElement('div', { className: 'skin-gallery-design-text' },
          state.confirming
            ? `将删除 ${state.selectedForDelete.length} 个自定义皮肤：${state.selectedForDelete.join('、')}。此操作不可撤销。`
            : '勾选卡片上的“勾选删除”，然后点击“删除所选”。内置皮肤不可删除。'),
        React.createElement('div', { className: 'skin-gallery-actions' },
          state.confirming
            ? React.createElement('button', {
              type: 'button', className: 'skin-gallery-action skin-gallery-action-primary',
              onClick: () => {
                for (const id of state.selectedForDelete) customSkinApi.deleteCustomSkin(id)
                state.selectedForDelete = []; state.confirming = false; rerender()
              },
            }, '确认删除')
            : React.createElement('button', {
              type: 'button', className: 'skin-gallery-action',
              disabled: state.selectedForDelete.length === 0,
              onClick: () => { state.confirming = true; rerender() },
            }, '删除所选'),
          React.createElement('button', {
            type: 'button', className: 'skin-gallery-action',
            onClick: () => { state.confirming = false; state.selectedForDelete = []; rerender() },
          }, '取消'))),
      // aria-label 区分同名「返回」（另两个在主题区与入口面板底部），可见文案不变
      React.createElement('button', { className: 'skin-gallery-action', type: 'button', 'aria-label': '返回设置（皮肤区）', onClick: onBack }, '返回'))
  }

  return {
    Panel,
    state,
    setSearch,
    submitImport,
    reset,
    designSummary,
    toggleSection,
    sectionCount: DESIGN_SECTIONS.length,
  }
}
