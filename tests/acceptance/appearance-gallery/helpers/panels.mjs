// 面板参考桩 —— 按 INTERFACE §3.9 的两个 createXxxPanel 签名与 §3.3 的功能清单渲染。
// 只放 INTERFACE 明确声明的可见文案；未声明的按钮文案一律不编（测试也不许断言它们）。
import { TEXT, SEARCH_INPUT_MAX, PERF } from './contract.mjs';
import { createFakeReact } from './fake-react.mjs';

/** §3.9：createThemePanel({React, families, customThemeApi, activateFamily, subscribe, onBack}) -> {Panel} */
export function createThemePanel(deps) {
  const { React, families, customThemeApi, onBack } = deps;
  for (const f of ['React', 'families', 'customThemeApi', 'activateFamily', 'subscribe', 'onBack']) {
    if (deps[f] === undefined) throw new Error(`createThemePanel 缺 deps.${f}`);
  }
  const state = { search: '', error: '' };
  const Panel = () => {
    const q = state.search.slice(0, SEARCH_INPUT_MAX).toLowerCase();
    const visible = families.filter((f) => `${f.label} ${f.id}`.toLowerCase().includes(q));
    const cards = visible.map((f) => React.createElement('div', { className: 'theme-gallery-card', key: f.id }, f.label));
    const customs = customThemeApi.getCustomThemes().map((t) => React.createElement(
      'div', { className: 'theme-gallery-card theme-gallery-card-custom', key: t.id }, t.label,
    ));
    return React.createElement('section', { className: 'theme-gallery-section' },
      React.createElement('input', { className: 'theme-gallery-search', value: state.search }),
      React.createElement('span', { className: 'theme-gallery-count' }, `${visible.length}/${families.length}`),
      ...cards, ...customs,
      React.createElement('textarea', { className: 'theme-gallery-import' }),
      // §3.8：错误文案只作为 React text child 渲染
      state.error ? React.createElement('p', { className: 'theme-gallery-error' }, state.error) : null,
      React.createElement('button', { onClick: onBack }, '返回'));
  };
  return {
    Panel,
    setSearch(v) { state.search = String(v).slice(0, SEARCH_INPUT_MAX); },
    /** 走 UI 路径提交导入：失败时把 `${code}: ${message}` 存进错误文案 */
    async submitImport(text) {
      state.error = '';
      try { return await customThemeApi.importCustomTheme(text); } catch (e) {
        state.error = `${e.code}: ${e.message}`;
        return null;
      }
    },
    state,
  };
}

/** §3.9：createSkinPanel({React, engine, customSkinApi, skinRuntime, subscribe, onBack}) -> {Panel} */
export function createSkinPanel(deps) {
  const { React, engine, customSkinApi, builtinSkins, onBack } = deps;
  for (const f of ['React', 'customSkinApi', 'skinRuntime', 'subscribe', 'onBack']) {
    if (deps[f] === undefined) throw new Error(`createSkinPanel 缺 deps.${f}`);
  }
  // §3.3 S6：11 个版块。版块名 INTERFACE 未声明 → 占位，测试不得断言名字，只断言数量与联动。
  const SECTIONS = Array.from({ length: 11 }, (_, i) => `SECTION_${i + 1}`);
  const state = { search: '', checked: new Set(), confirming: false, picked: new Set(), error: '' };
  /** designSummary：仓库路径与验收命令是 §3.3 节末明确要求更新的文本 */
  const buildSummary = () => [
    ...[...state.picked].sort().map((i) => SECTIONS[i]),
    'packages/appearance-gallery/skins/<skin-id>/',
    TEXT.winReservedHint,                        // A7-1 裁决：目录建议段必须带这句
    'pnpm --filter dsh-appearance-gallery test',
  ].join('\n');
  const Panel = () => {
    if (engine === null) {
      // §3.2：引擎为 null 时整段只渲染一行占位，S1–S8 全部入口不渲染
      return React.createElement('section', { className: 'skin-gallery-section' },
        React.createElement('p', { className: 'skin-gallery-unavailable' }, TEXT.skinUnavailable));
    }
    const q = state.search.slice(0, SEARCH_INPUT_MAX).toLowerCase();
    const all = [...builtinSkins, ...customSkinApi.getSkins()];
    const visible = all.filter((s) => `${s.name} ${s.nameEn || ''} ${s.id}`.toLowerCase().includes(q));
    const cards = visible.map((s) => React.createElement('div', { className: 'skin-gallery-card', key: s.id },
      React.createElement('span', { className: 'skin-gallery-card-name' }, s.name),
      React.createElement('button', {}, '试穿'),
      React.createElement('button', {}, '应用')));
    return React.createElement('section', { className: 'skin-gallery-section' },
      React.createElement('input', { className: 'skin-gallery-search', value: state.search }),
      React.createElement('span', { className: 'skin-gallery-count' }, `${visible.length}/${all.length}`),
      ...cards,
      React.createElement('button', {}, '恢复默认外观'),
      React.createElement('button', {}, '创建自定义皮肤'),
      React.createElement('textarea', { className: 'skin-gallery-design', readOnly: true }, buildSummary()),
      React.createElement('button', {}, '导入皮肤'),
      React.createElement('textarea', { className: 'skin-gallery-import-skin' }),
      React.createElement('textarea', { className: 'skin-gallery-import-client' }),
      React.createElement('textarea', { className: 'skin-gallery-import-a11y' }),
      React.createElement('button', {}, '删除皮肤'),
      state.error ? React.createElement('p', { className: 'skin-gallery-error' }, state.error) : null,
      React.createElement('button', { onClick: onBack }, '返回'));
  };
  return {
    Panel,
    setSearch(v) { state.search = String(v).slice(0, SEARCH_INPUT_MAX); },
    async submitImport(parts) {
      state.error = '';
      try { return await customSkinApi.importCustomSkin(parts); } catch (e) {
        state.error = `${e.code}: ${e.message}`;
        return null;
      }
    },
    sectionCount: SECTIONS.length,
    toggleSection(i) { if (state.picked.has(i)) state.picked.delete(i); else state.picked.add(i); },
    designSummary: () => buildSummary(),
    state,
  };
}

/** Entry（槽位条目）+ 面板挂载。§3.3 E1/E2/E3、§3.11 P7 */
export function createEntryFactory(deps) {
  const fake = deps.react || createFakeReact();
  const React = fake.react;
  const theme = createThemePanel({
    React, families: deps.families, customThemeApi: deps.themeApi,
    activateFamily: deps.themeApi.activateFamily, subscribe: deps.subscribe, onBack: () => back(),
  });
  const skin = createSkinPanel({
    React, engine: deps.engine, customSkinApi: deps.customSkinApi, builtinSkins: deps.builtinSkins || [],
    skinRuntime: deps.skinRuntime, subscribe: deps.subscribe, onBack: () => back(),
  });
  let setOpenRef = null;
  function back() {
    deps.revertPreview();           // §3.0 硬约定 2：先撤销试穿，再关面板
    if (setOpenRef) setOpenRef(false);
  }
  const AppearanceEntry = () => {
    const [open, setOpen] = React.useState(false);
    setOpenRef = setOpen;
    const eff = deps.effectiveAppearance();
    const summary = eff.kind === 'skin'
      ? TEXT.summarySkinPrefix + eff.name
      : TEXT.summaryThemePrefix + eff.label;
    const kids = [React.createElement('div', { className: 'appearance-summary' }, summary)];
    if (deps.legacyPresent) kids.push(React.createElement('div', { className: 'appearance-legacy-warn' }, TEXT.legacyConflict));
    if (!open) {
      kids.push(React.createElement('button', { className: 'appearance-open', onClick: () => setOpen(true) }, '外观'));
    } else {
      // §3.9 边界约束 2：只经 createElement(Panel, props) 挂载，禁止直接调用 Panel()
      kids.push(React.createElement(theme.Panel, {}));
      kids.push(React.createElement(skin.Panel, {}));
      kids.push(React.createElement('button', { className: 'appearance-back', onClick: back }, '返回'));
    }
    return React.createElement('div', { className: 'appearance-entry' }, ...kids);
  };
  return {
    AppearanceEntry, ThemePanel: theme.Panel, SkinPanel: skin.Panel, themePanel: theme, skinPanel: skin,
    fake,
    render() { return fake.render(AppearanceEntry); },
    openPanel() { this.render(); setOpenRef(true); return this.render(); },
    closePanel() { back(); return this.render(); },
    maxClosedNodes: PERF.entryClosedMaxNodes,
  };
}
