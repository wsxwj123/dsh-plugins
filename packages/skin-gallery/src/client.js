const STORAGE_SKIN_KEY = 'skin-gallery-skin-v1'

function readStored(key, fallback = '') {
  try { return localStorage.getItem(key) || fallback } catch { return fallback }
}

function writeStored(key, value) {
  try { localStorage.setItem(key, value) } catch {}
}

function removeStored(key) {
  try { localStorage.removeItem(key) } catch {}
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
let triedSkinId = null
const notify = () => { for (const listener of listeners) listener() }
const subscribe = (listener) => { listeners.add(listener); return () => listeners.delete(listener) }

function clearSkin() {
  if (!skinEngine) return
  const state = skinEngine.currentSkinState()
  if (state.active && state.skinId) a11yInjector.remove(state.skinId)
  skinEngine.deactivateSkin()
  triedSkinId = null
  removeStored(STORAGE_SKIN_KEY)
  notify()
}

async function loadSkin(skinId) {
  if (!skinEngine) throw new Error('[skin-gallery] missing __DSH_MODULES__')
  const entry = SKINS.find((item) => item.id === skinId)
  if (!entry) throw new Error(`unknown-skin: ${skinId}`)
  await skinEngine.activateSkin(entry, {
    afterApply: () => a11yInjector.inject(entry.id),
  })
  notify()
}

async function previewSkin(skinId) {
  await loadSkin(skinId)
  triedSkinId = skinId
  notify()
}

async function applySkin(skinId) {
  await loadSkin(skinId)
  triedSkinId = null
  writeStored(STORAGE_SKIN_KEY, skinId)
  notify()
}

const currentSkinState = () => skinEngine ? skinEngine.currentSkinState() : { skinId: null, active: false }
const getSkins = () => SKINS.slice()
const getPreviewState = () => ({ skinId: triedSkinId, appliedSkinId: readStored(STORAGE_SKIN_KEY, '') })

function teardown() {
  if (skinEngine) skinEngine.teardownSkins()
}

const plugin = {
  inject: ['slots'],
  apply,
}

if (typeof globalThis.__TG_SURFACE__ === 'function') {
  globalThis.__TG_SURFACE__({
    apply,
    activateSkin: applySkin,
    previewSkin,
    applySkin,
    clearSkin,
    currentSkinState,
    getSkins,
    getPreviewState,
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
  .skin-gallery-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 7px; padding: 2px; }
  .skin-gallery-card { display: grid; grid-template-columns: 32px minmax(0, 1fr); align-items: center; gap: 8px; min-width: 0; padding: 8px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); font: inherit; text-align: left; }
  .skin-gallery-card-main { cursor: pointer; border: 0; background: transparent; color: inherit; padding: 0; font: inherit; text-align: left; }
  .skin-gallery-card-actions { grid-column: 1 / -1; display: flex; gap: 6px; flex-wrap: wrap; }
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
  .skin-gallery-import { display: grid; gap: 10px; padding: 12px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 12px; background: var(--dsw-alias-bg-layer-1); }
  .skin-gallery-import-title { color: var(--dsw-alias-label-primary); font-size: 13px; font-weight: 600; }
  .skin-gallery-import-text { color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; }
  .skin-gallery-import-field { width: 100%; box-sizing: border-box; min-height: 72px; padding: 8px 10px; border: 1px dashed var(--dsw-alias-border-l2); border-radius: 9px; color: var(--dsw-alias-label-secondary); background: var(--dsw-alias-bg-layer-2); font: 12px/18px var(--ds-font-family-code, ui-monospace, monospace); }
  .skin-gallery-import-err { color: var(--dsw-alias-state-error-primary); font-size: 11px; }
  .skin-gallery-empty { padding: 14px; border: 1px dashed var(--dsw-alias-border-l2); border-radius: 10px; color: var(--dsw-alias-label-secondary); text-align: center; font-size: 12px; }
  @media (max-width: 900px) { .skin-gallery-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
  @media (max-width: 680px) { .skin-gallery-grid { grid-template-columns: 1fr; } }
`

function apply(ctx) {
  const slots = ctx.get('slots')
  if (slots === undefined) return

  // 自定义皮肤 API：storage 接 localStorage，engine 接真实 skinEngine（受控导入 + 注册 + 试穿/应用）。
  const customSkinApi = (typeof skinEngine !== 'undefined' && skinEngine !== null)
    ? createCustomSkinApi({ storage: localStorage, builtinSkins: SKINS, validate: validateCustomBundle, engine: skinEngine })
    : createCustomSkinApi({ storage: localStorage, builtinSkins: SKINS, validate: validateCustomBundle })

  const stored = readStored(STORAGE_SKIN_KEY, '')
  if (skinEngine && SKINS.some((item) => item.id === stored)) {
    void activateSkin(stored)
  }

  ctx.effect(() => () => teardown())

  function SkinGallery() {
    const [query, setQuery] = React.useState('')
    const [busy, setBusy] = React.useState(false)
    const [designOpen, setDesignOpen] = React.useState(false)
    const [importOpen, setImportOpen] = React.useState(false)
    const [deleteOpen, setDeleteOpen] = React.useState(false)
    const [selectedForDelete, setSelectedForDelete] = React.useState([])
    const [confirmDelete, setConfirmDelete] = React.useState(false)
    const [skinText, setSkinText] = React.useState('')
    const [clientText, setClientText] = React.useState('')
    const [a11yText, setA11yText] = React.useState('')
    const [importErr, setImportErr] = React.useState('')
    const [designParts, setDesignParts] = React.useState(['颜色', '气泡', '代码块'])
    const [, force] = React.useState(0)
    React.useEffect(() => subscribe(() => force((value) => value + 1)), [])

    if (!skinEngine) {
      return React.createElement('div', { className: 'skin-gallery-empty' }, '皮肤轨道不可用：宿主未提供 __DSH_MODULES__。')
    }

    const normalized = query.trim().toLowerCase()
    const allSkins = customSkinApi.getSkins()
    const skinState = customSkinApi.currentSkinState()
    const state = { skinId: skinState.skinId || null, active: skinState.active }
    const visible = allSkins.filter((item) => !normalized || (item.name + ' ' + item.nameEn + ' ' + item.id).toLowerCase().includes(normalized))
    const choose = async (id) => {
      setBusy(true)
      try {
        const isCustom = item => allSkins.find((s) => s.id === id) && allSkins.find((s) => s.id === id).source === 'custom'
        if (isCustom()) { customSkinApi.applyCustomSkin(id); customSkinApi.currentSkinState() }
        await activateSkin(id)
      } finally { setBusy(false) }
    }
    const resetToDefault = () => {
      clearSkin()
      customSkinApi.restoreDefaultSkin()
      setDesignOpen(false)
      setImportOpen(false)
      closeDeleteMode()
    }
    const togglePart = (part) => {
      setDesignParts((parts) => parts.includes(part) ? parts.filter((item) => item !== part) : [...parts, part])
    }
    const toggleDeleteSelection = (id) => {
      setSelectedForDelete((ids) => ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id])
    }
    const closeDeleteMode = () => {
      setDeleteOpen(false)
      setConfirmDelete(false)
      setSelectedForDelete([])
    }
    const deleteSelected = () => {
      for (const id of selectedForDelete) customSkinApi.deleteCustomSkin(id)
      closeDeleteMode()
      force((value) => value + 1)
    }

    const doImportCustom = async () => {
      setImportErr('')
      try {
        await customSkinApi.importCustomSkin({ skin: skinText, client: clientText, a11y: a11yText || undefined })
        setSkinText(''); setClientText(''); setA11yText('')
        force((v) => v + 1)
      } catch (e) {
        setImportErr(e && e.code ? `${e.code}: ${e.message}` : ((e && e.message) || '导入失败'))
      }
    }

    const designSummary = [
      '我想创建一个自定义 DSH 皮肤。请按 dsh-skin-gallery 的皮肤包格式交付，不要生成独立 Cordis 插件。',
      '',
      '【交付路径】',
      '把文件放入 dsh-plugins 仓库的相对路径：packages/skin-gallery/skins/<skin-id>/',
      '不要使用绝对路径，不要放到用户主目录或 ~/.dsh。',
      '',
      '【交付格式】',
      'packages/skin-gallery/skins/<skin-id>/',
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
      'pnpm --filter dsh-skin-gallery build',
      'pnpm --filter dsh-skin-gallery check',
      'pnpm --filter dsh-skin-gallery test',
      '并在设置页支持：试穿、应用、恢复默认、切换后无残留。',
      '',
      '【设计前请先询问】',
      '1. 皮肤名称和整体风格；',
      '2. 浅色/深色背景、主色、文字色、边框色；',
      '3. 消息气泡、代码块、按钮、侧栏、输入框分别如何设计；',
      '4. 是否需要背景图、标题栏、状态栏、动效或特殊控件；',
      '5. 如何保证气泡和代码块背景与文字有足够对比度。',
      '当前选择的版块：' + designParts.join('、'),
      '请先向我提问确认设计，不要直接生成代码。',
    ].join('\n')

    return React.createElement('div', { className: 'skin-gallery-root' },
      React.createElement('div', { className: 'skin-gallery-heading' },
        React.createElement('div', { className: 'skin-gallery-title' }, '完整皮肤'),
        React.createElement('div', { className: 'skin-gallery-count' }, visible.length + ' / ' + allSkins.length)
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
        }, designOpen ? '收起自定义皮肤' : '创建自定义皮肤'),
        React.createElement('button', {
          type: 'button', className: 'skin-gallery-action', disabled: busy,
          onClick: () => setImportOpen(!importOpen),
        }, importOpen ? '收起皮肤导入' : '导入皮肤'),
        React.createElement('button', {
          type: 'button', className: 'skin-gallery-action', disabled: busy || customSkins.length === 0,
          onClick: () => {
            if (deleteOpen) closeDeleteMode()
            else {
              setDesignOpen(false)
              setImportOpen(false)
              setDeleteOpen(true)
            }
          },
        }, deleteOpen ? '取消删除' : '删除皮肤')
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
      importOpen && React.createElement('div', { className: 'skin-gallery-import' },
        React.createElement('div', { className: 'skin-gallery-import-title' }, '自定义皮肤包导入'),
        React.createElement('div', { className: 'skin-gallery-import-text' }, '受控包格式：skin.json（含 author / license）+ client.js（须注册 __ModuleLoader__.load 并导出 apply(ctx)）+ 可选 a11y.css。仅按契约校验并注入，绝不执行包内文字。'),
        React.createElement('textarea', {
          className: 'skin-gallery-import-field', value: skinText, 'aria-label': 'skin.json',
          placeholder: '{ "id": "my-skin", "name": "我的皮肤", "author": "作者", "license": "BSD-3-Clause" }',
          onChange: (event) => setSkinText(event.target.value),
        }),
        React.createElement('textarea', {
          className: 'skin-gallery-import-field', value: clientText, 'aria-label': 'client.js',
          placeholder: 'window.__ModuleLoader__.load({ id: "my-skin", factory: () => ({ apply(ctx) { ctx.effect(...); } }) })',
          onChange: (event) => setClientText(event.target.value),
        }),
        React.createElement('textarea', {
          className: 'skin-gallery-import-field', value: a11yText, 'aria-label': 'a11y.css',
          placeholder: 'a11y.css（可选，缺失则降级，皮肤仍可用）：body[data-dsh-my-skin] { --x: 1 }',
          onChange: (event) => setA11yText(event.target.value),
        }),
        importErr && React.createElement('div', { className: 'skin-gallery-import-err' }, importErr),
        React.createElement('div', { className: 'skin-gallery-actions' },
          React.createElement('button', {
            type: 'button', className: 'skin-gallery-action skin-gallery-action-primary',
            disabled: !skinText.trim() || !clientText.trim(),
            onClick: doImportCustom,
          }, '导入皮肤包')
        )
      ),
      deleteOpen && React.createElement('div', { className: 'skin-gallery-design' },
        React.createElement('div', { className: 'skin-gallery-design-title' }, '删除自定义皮肤'),
        React.createElement('div', { className: 'skin-gallery-design-text' }, customSkins.length === 0 ? '当前没有可删除的自定义皮肤。内置皮肤不可删除。' : '勾选要删除的自定义皮肤，然后点击“删除所选”。内置皮肤不可删除。'),
        customSkins.length > 0 && React.createElement('div', { className: 'skin-gallery-design-options' },
          ...customSkins.map((item) => React.createElement('label', {
            key: item.id, className: 'skin-gallery-design-option' + (selectedForDelete.includes(item.id) ? ' is-selected' : ''),
          },
            React.createElement('input', {
              type: 'checkbox', checked: selectedForDelete.includes(item.id),
              onChange: () => toggleDeleteSelection(item.id),
            }),
            ' ',
            item.name
          ))
        ),
        React.createElement('div', { className: 'skin-gallery-actions' },
          React.createElement('button', {
            type: 'button', className: 'skin-gallery-action', disabled: selectedForDelete.length === 0,
            onClick: () => setConfirmDelete(true),
          }, '删除所选'),
          React.createElement('button', {
            type: 'button', className: 'skin-gallery-action',
            onClick: closeDeleteMode,
          }, '取消')
        )
      ),
      confirmDelete && React.createElement('div', { className: 'skin-gallery-design' },
        React.createElement('div', { className: 'skin-gallery-design-title' }, '确认删除'),
        React.createElement('div', { className: 'skin-gallery-design-text' }, `将删除 ${selectedForDelete.length} 个自定义皮肤：${selectedForDelete.join('、')}。此操作不可撤销。`),
        React.createElement('div', { className: 'skin-gallery-actions' },
          React.createElement('button', {
            type: 'button', className: 'skin-gallery-action skin-gallery-action-primary',
            onClick: deleteSelected,
          }, '确认删除'),
          React.createElement('button', {
            type: 'button', className: 'skin-gallery-action',
            onClick: () => setConfirmDelete(false),
          }, '返回')
        )
      ),
      React.createElement('input', {
        className: 'skin-gallery-search', type: 'search', value: query,
        placeholder: '搜索皮肤…', 'aria-label': '搜索皮肤',
        onChange: (event) => setQuery(event.target.value),
      }),
      visible.length === 0
        ? React.createElement('div', { className: 'skin-gallery-empty' }, '没有匹配的皮肤')
        : React.createElement('div', { className: 'skin-gallery-grid' }, ...visible.map((item) => {
            const isCustom = item.source === 'custom'
            return React.createElement('div', {
              key: item.id,
              className: 'skin-gallery-card' + (state.skinId === item.id ? ' is-active' : ''),
            },
              React.createElement('button', {
                type: 'button', disabled: busy,
                className: 'skin-gallery-card-main',
                onClick: () => choose(item.id),
              },
                React.createElement('span', { className: 'skin-gallery-swatch', style: { background: item.accent } }),
                React.createElement('span', { className: 'skin-gallery-copy' },
                  React.createElement('span', { className: 'skin-gallery-name' }, item.name),
                  React.createElement('span', { className: 'skin-gallery-meta' }, (isCustom ? '自定义 · ' : '') + item.author)
                )
              ),
              React.createElement('div', { className: 'skin-gallery-card-actions' },
                React.createElement('button', {
                  type: 'button', className: 'skin-gallery-action', disabled: busy,
                  onClick: async () => { setBusy(true); try { await previewSkin(item.id) } finally { setBusy(false) } },
                }, '试穿'),
                React.createElement('button', {
                  type: 'button', className: 'skin-gallery-action skin-gallery-action-primary', disabled: busy,
                  onClick: async () => { setBusy(true); try { await applySkin(item.id) } finally { setBusy(false) } },
                }, '应用'),
                deleteOpen && isCustom && React.createElement('label', { className: 'skin-gallery-design-option' },
                  React.createElement('input', {
                    type: 'checkbox', checked: selectedForDelete.includes(item.id),
                    onChange: () => toggleDeleteSelection(item.id),
                  }),
                  ' 勾选删除'
                )
              )
            )
          }))
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
