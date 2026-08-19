// 被测对象接线点。默认跑真实实现（packages/dsh-appearance-gallery），
// APPEARANCE_SUBJECT=harness 可切回参考桩对照。断言一行都不用改。
//
// 真实实现是浏览器插件：apply 层要 document / storage / __DSH_MODULES__ / React。
// 本文件用 applyWith(ctx, deps) 的注入口把这四样换成 Node 侧替身，于是被测的是
// **真实的 apply 层逻辑**（启动恢复、串行化闸、试穿撤销、槽位注册、面板懒挂载），
// 只有「皮肤 bundle 执行后往 DOM 上写什么」这一段由替身模拟——那段在 Node 里没有等价物。
import { createMemoryStorage } from './memory-storage.mjs'
import { createFakeReact, flattenTree } from './fake-react.mjs'
import { undefinedBehavior } from './validate.mjs';

export const SUBJECT = process.env.APPEARANCE_SUBJECT || 'real';

const PKG = '../../../../packages/dsh-appearance-gallery/src/client.js';

/** JSON.parse 计数（§3.11 P6 记忆化断言）：只有被测代码真的解析了才计数。 */
const nativeParse = JSON.parse;
let parseSink = null;
JSON.parse = function countedParse(...args) {
  if (parseSink) parseSink.countParse();
  return nativeParse.apply(JSON, args);
};

// ---------------- 极简 DOM 替身 ----------------
/** 支持 `tag[attr="value"]`、`tag[attr]`、逗号并列，够 skin-engine / skin-a11y / client 用。 */
function matchesSelector(el, selector) {
  return selector.split(',').some((raw) => {
    const part = raw.trim();
    const tag = (part.match(/^[a-zA-Z]+/) || [''])[0];
    if (tag && el.tag !== tag) return false;
    for (const [, name, , value] of part.matchAll(/\[([^\]=]+)(="([^"]*)")?\]/g)) {
      if (!(name in el.attrs)) return false;
      if (value !== undefined && el.attrs[name] !== value) return false;
    }
    return true;
  });
}

function createElement(tag, doc) {
  const el = {
    tag,
    attrs: {},
    textContent: '',
    dataset: {},
    get id() { return this.attrs.id || ''; },
    setAttribute(name, value) { this.attrs[name] = String(value); },
    getAttribute(name) { return name in this.attrs ? this.attrs[name] : null; },
    hasAttribute(name) { return name in this.attrs; },
    removeAttribute(name) { delete this.attrs[name]; },
    remove() {
      const at = doc.head.nodes.indexOf(el);
      if (at >= 0) doc.head.nodes.splice(at, 1);
      const bat = doc.body.children.indexOf(el);
      if (bat >= 0) doc.body.children.splice(bat, 1);
    },
  };
  return el;
}

function createFakeDom(legacyMarks = []) {
  const doc = {};
  const inline = new Map();
  doc.head = {
    nodes: [],
    appendChild(el) { doc.head.nodes.push(el); return el; },
    append(el) { doc.head.nodes.push(el); return el; },
  };
  doc.body = {
    tag: 'body',
    attrs: {},
    children: [],
    style: {
      setProperty(name, value) { inline.set(name, String(value)); },
      removeProperty(name) { inline.delete(name); },
    },
    setAttribute(name, value) {
      if (name === 'style') {
        inline.clear();
        for (const decl of String(value).split(';')) {
          const at = decl.indexOf(':');
          if (at > 0) inline.set(decl.slice(0, at).trim(), decl.slice(at + 1).trim());
        }
        return;
      }
      doc.body.attrs[name] = String(value);
    },
    getAttribute(name) {
      if (name === 'style') {
        if (inline.size === 0) return null;
        return [...inline].map(([k, v]) => `${k}:${v}`).join(';');
      }
      return name in doc.body.attrs ? doc.body.attrs[name] : null;
    },
    hasAttribute(name) { return name === 'style' ? inline.size > 0 : name in doc.body.attrs; },
    removeAttribute(name) {
      if (name === 'style') { inline.clear(); return; }
      delete doc.body.attrs[name];
    },
  };
  // 旧包遗留 style（用于 §3.2 的旧包自检）
  for (const mark of legacyMarks) {
    const el = createElement('style', doc);
    el.setAttribute(mark, '');
    doc.head.nodes.push(el);
  }
  doc.createElement = (tag) => createElement(tag, doc);
  doc.querySelectorAll = (selector) => doc.head.nodes.filter((el) => matchesSelector(el, selector));
  doc.querySelector = (selector) => doc.querySelectorAll(selector)[0] || null;
  doc.inline = inline;
  return doc;
}

/** style 元素 → 测试口径的 mark */
function markOf(el) {
  if ('data-appearance-gallery' in el.attrs) return 'data-appearance-gallery';
  if ('data-theme-gallery-a11y' in el.attrs) return 'data-skin-a11y';
  if ('data-plugin' in el.attrs) return 'data-skin';
  return 'other';
}

// ---------------- 真实实现的接线 ----------------
async function createReal(opts = {}) {
  const { applyWith } = await import(PKG);
  const { BUILTIN_SKINS } = await import('../../../../packages/dsh-appearance-gallery/src/acceptance-api.mjs');

  const storage = opts.storage || createMemoryStorage(opts.seed || {});
  parseSink = storage;
  const doc = createFakeDom(opts.legacyStyles || []);
  const fake = createFakeReact();

  // 内置皮肤 manifest（引擎会就地追加自定义项）+ 内嵌 bundle 文本
  const manifest = BUILTIN_SKINS.map((s) => ({ ...s, source: 'builtin' }));
  const bundles = {};
  const a11y = {};
  for (const s of BUILTIN_SKINS) {
    if (opts.dropBundle !== s.id) bundles[s.id] = `/* bundle:${s.id} */`;
    a11y[s.id] = `/* a11y:${s.id} */`;
  }

  let execCount = 0;
  let disposerRuns = 0;
  const moduleTable = new Map();

  /**
   * 皮肤 bundle 的行为替身：真实 bundle 会往 body 上打属性、写内联变量、注入自己的
   * <style data-plugin>，并把清理登记在 ctx.effect 上。这里照同一形状做，
   * 于是引擎的激活/回滚/卸载链路跑的是真代码。
   */
  const makeApply = (entry) => (ctx) => {
    const attr = entry.bodyAttr || `data-dsh-${entry.id}`;
    ctx.effect(() => {
      doc.body.setAttribute(attr, '1');
      doc.body.style.setProperty('--skin', entry.id);
      const style = doc.createElement('style');
      style.setAttribute('data-plugin', entry.package || entry.id);
      style.textContent = `/* ${entry.id} */`;
      doc.head.appendChild(style);
      return () => {
        doc.body.removeAttribute(attr);
        doc.body.style.removeProperty('--skin');
        style.remove();
      };
    });
    if (opts.failActivate === entry.id) {
      ctx.effect(() => {
        doc.body.setAttribute('data-half-applied', '1'); // 半成品残留，失败后必须被回滚掉
        return () => { doc.body.removeAttribute('data-half-applied'); disposerRuns += 1; };
      });
      throw new Error(`activate failed: ${entry.id}`);
    }
  };

  const modules = opts.modules === false ? undefined : {
    invalidate(pkg) { moduleTable.delete(pkg); },
    async import(pkg) {
      if (!moduleTable.has(pkg)) {
        const entry = manifest.find((e) => (e.package || e.id) === pkg);
        if (!entry) throw new Error(`[fake-modules] unknown package ${pkg}`);
        moduleTable.set(pkg, { apply: makeApply(entry) });
      }
      return moduleTable.get(pkg);
    },
  };

  let tokens = null;
  const themeService = {
    overrideTokens(owner, next, themeId) {
      tokens = { themeId: themeId === undefined ? null : themeId, tokens: next };
      const mine = tokens;
      return () => { if (tokens === mine) tokens = null; };
    },
  };

  const slotCalls = { inject: [], register: [] };
  const slots = {
    inject(name, fn) { slotCalls.inject.push(name); insideInject = true; try { fn(); } finally { insideInject = false; } },
    register(arg, component) { slotCalls.register.push({ arg, insideInject, component }); },
  };
  let insideInject = false;

  const deps = {
    React: fake.react,
    doc,
    storage,
    modules,
    manifest,
    bundles,
    a11y,
    executeScript: () => { execCount += 1; },
  };

  let runtime = null;
  const dom = {
    get styles() { return doc.head.nodes.map((el) => ({ mark: markOf(el), text: el.textContent })); },
    styleCount(mark) { return this.styles.filter((s) => s.mark === mark).length; },
    get body() {
      const attrs = { ...doc.body.attrs };
      return { attrs, inline: Object.fromEntries(doc.inline) };
    },
    get tokens() { return tokens; },
    get activeSkin() {
      if (!runtime || !runtime.engine) return null;
      const state = runtime.engine.currentSkinState();
      return state.active ? state.skinId : null;
    },
    get disposerRuns() { return disposerRuns; },
  };

  function makeEntry() {
    const clickByClass = (cls) => {
      const tree = fake.render(runtime.AppearanceEntry);
      const node = flattenTree(tree).find((n) => n.props && n.props.className === cls);
      if (node && typeof node.props.onClick === 'function') node.props.onClick();
      return node;
    };
    return {
      AppearanceEntry: runtime.AppearanceEntry,
      ThemePanel: runtime.themePanel.Panel,
      SkinPanel: runtime.skinPanel.Panel,
      themePanel: runtime.themePanel,
      skinPanel: runtime.skinPanel,
      fake,
      render() { return fake.render(runtime.AppearanceEntry); },
      openPanel() { clickByClass('appearance-open'); return this.render(); },
      closePanel() {
        const hit = clickByClass('appearance-back');
        if (!hit) runtime.closePanel();
        return this.render();
      },
      maxClosedNodes: 10,
    };
  }

  const subject = {
    storage,
    dom,
    slotCalls,
    start(ctx = {}) {
      const services = ctx.services || { theme: {}, slots: {} };
      const realCtx = {
        get: (name) => (name === 'slots' ? (services.slots === undefined ? undefined : slots) : services[name]),
        effect: () => {},
      };
      // theme 服务由 applyWith 从 ctx.get('theme') 取；这里替换成能记录 token 的替身
      const withTheme = {
        get: (name) => (name === 'theme'
          ? (services.theme === undefined ? undefined : themeService)
          : realCtx.get(name)),
        effect: realCtx.effect,
      };
      const handle = applyWith(withTheme, deps);
      runtime = handle.runtime;
      return { registered: handle.registered, dispose: () => handle.dispose() };
    },
    get entry() {
      if (!runtime) throw undefinedBehavior('未调用 start() 就取 entry');
      return makeEntry();
    },
    get engine() { return runtime ? runtime.engine : null; },
    get execCount() { return execCount; },
    get families() { return runtime ? runtime.families : []; },
    get builtinSkins() { return runtime ? runtime.builtinSkins : []; },
    get themeApi() { return runtime.themeApi; },
    // 验收口径里的 customSkinApi.getSkins 指「自定义皮肤 registry」，
    // 真实 API 的 getSkins 是「内置 + 自定义」的展示列表，这里做名字映射。
    get customSkinApi() {
      return Object.assign({}, runtime.skinApi, { getSkins: runtime.skinApi.getCustomSkins });
    },
    get skinRuntime() { return runtime.skinRuntime; },
    get surface() { return runtime.surface; },
    subscribe: (listener) => runtime.subscribe(listener),
    revertPreview: () => runtime.revertPreview(),
    effectiveAppearance: () => runtime.effectiveAppearance(),
    teardownSkins: () => runtime.teardownSkins(),
    summaryText: () => runtime.summaryText(),
    readTrack() {
      const value = storage.read('dsh-appearance-track-v1');
      return value === 'theme' || value === 'skin' ? value : '';
    },
  };
  return subject;
}

export async function createSubject(opts = {}) {
  if (SUBJECT === 'harness') {
    const { createHarness } = await import('./harness.mjs');
    return createHarness(opts);
  }
  if (SUBJECT === 'real') return createReal(opts);
  throw new Error(
    `未接线的 subject「${SUBJECT}」。请在 tests/acceptance/appearance-gallery/helpers/subject.mjs 里，`
    + '把 packages/dsh-appearance-gallery 的真实入口映射为 createHarness 返回的同一组字段'
    + '（storage / dom / slotCalls / themeApi / customSkinApi / skinRuntime / surface / start / entry）。',
  );
}
