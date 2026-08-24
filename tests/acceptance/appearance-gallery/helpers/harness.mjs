// 参考桩（契约的镜子）—— 严格按 INTERFACE 声明的行为实现，用于锁定期验证测试自身可跑。
// 04 之后开发方在 subject.mjs 里把真实实现接进来，跑同一套断言。
// 规矩：INTERFACE 未定义的行为一律 throw HARNESS_UNDEFINED，不许在这里发明语义。
import { KEYS, BUILTIN_THEME_IDS, BUILTIN_SKIN_IDS, DEFAULT_THEME_ID, JADE_LABEL, ERR, TEXT, STYLE_MARK, LEGACY_STYLE_MARKS, SLOT, runtimeUnknownSkin } from './contract.mjs';
import { createMemoryStorage } from './memory-storage.mjs';
import { validateTheme, validateBundle, codedError, undefinedBehavior } from './validate.mjs';
import { createEntryFactory } from './panels.mjs';

const EMPTY_REGISTRY = { version: 1, items: [] };
const clone = (v) => JSON.parse(JSON.stringify(v));

/** INTERFACE 只钉住 jade 的 label；其余 label 未定义 → 用 id 占位，测试不得断言它们 */
export const DEFAULT_FAMILIES = BUILTIN_THEME_IDS.map((id) => ({
  id,
  label: id === DEFAULT_THEME_ID ? JADE_LABEL : id,
  tokens: { '--dsw-bg': { light: '#fff', dark: '#000' } },
  preview: { light: { background: '#fff', accent: '#0a0' }, dark: { background: '#000', accent: '#0f0' } },
}));

/** 内置皮肤的显示名 INTERFACE 未钉住 → 用 id 占位 */
export const DEFAULT_BUILTIN_SKINS = BUILTIN_SKIN_IDS.map((id, i) => ({
  id, name: id, nameEn: id, order: i, bodyAttr: `data-dsh-${id}`, source: 'builtin',
}));

export function createHarness(opts = {}) {
  const storage = opts.storage || createMemoryStorage(opts.seed || {});
  const hasModules = opts.modules !== false; // false ⇒ 宿主既无 ctx.modules 也无旧 window 全局
  const families = opts.families || DEFAULT_FAMILIES;
  const builtinSkins = opts.builtinSkins || DEFAULT_BUILTIN_SKINS;
  // 内置皮肤内嵌 bundle 文本；测试可以删掉某个 id 来触发 no-embedded-bundle 运行时错误
  const bundles = new Map(builtinSkins.map((s) => [s.id, `/* bundle:${s.id} */`]));
  if (opts.dropBundle) bundles.delete(opts.dropBundle);

  // ---------------- DOM 替身 ----------------
  const dom = {
    styles: [],                       // [{mark, text}]
    disposerRuns: 0,                  // 激活失败时逆序跑完的 disposer 次数
    body: { attrs: {}, inline: {} },
    tokens: null,                     // 当前注入的 token override（{themeId, tokens}）
    legacy: new Set(opts.legacyStyles || []),
    styleCount(mark) { return this.styles.filter((s) => s.mark === mark).length; },
    hasLegacy() { return LEGACY_STYLE_MARKS.some((m) => this.legacy.has(m)); },
  };
  let execCount = 0;
  const execScript = () => { execCount += 1; };
  const moduleTable = new Map();      // pkg -> {apply}

  // ---------------- storage 安全读写（§3.8 第 5 条）----------------
  const readKey = (k) => { try { const v = storage.getItem(k); return v === null ? '' : v; } catch { return ''; } };
  const writeKey = (k, v) => {
    try { if (v === '' && (k === KEYS.TRACK)) storage.removeItem(k); else storage.setItem(k, v); } catch { /* 静默降级 */ }
  };
  const dropKey = (k) => { try { storage.removeItem(k); } catch { /* 静默降级 */ } };

  // registry 记忆化（§3.11 P6：两侧各一份，不抽公共 helper）
  const memo = { [KEYS.THEME_CUSTOM]: { raw: undefined, val: null }, [KEYS.SKIN_CUSTOM]: { raw: undefined, val: null } };
  const readRegistry = (key) => {
    const raw = readKey(key);
    const slot = memo[key];
    if (slot.raw === raw && slot.val) return slot.val;
    storage.countParse();
    let val = clone(EMPTY_REGISTRY);
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && Array.isArray(parsed.items)) val = parsed;
    } catch { /* §3.8 第 6 条：损坏读作空 registry，不 removeItem */ }
    slot.raw = raw; slot.val = val;
    return val;
  };
  const writeRegistry = (key, val) => { writeKey(key, JSON.stringify(val)); memo[key].raw = undefined; };

  // ---------------- 变更通知 ----------------
  const listeners = new Set();
  const notify = () => { for (const l of [...listeners]) l(); };
  const subscribe = (l) => { listeners.add(l); return () => listeners.delete(l); };

  // ---------------- 主题轨 ----------------
  const injectTokens = (themeId, tokens) => { dom.tokens = { themeId, tokens: clone(tokens) }; };
  const removeOverride = () => { dom.tokens = null; };
  const getCustomThemes = () => readRegistry(KEYS.THEME_CUSTOM).items;
  const findCustomTheme = (id) => getCustomThemes().find((t) => t.id === id) || null;
  const paintFamily = (id) => {
    const fam = families.find((f) => f.id === id) || families.find((f) => f.id === DEFAULT_THEME_ID);
    injectTokens(fam.id, fam.tokens);
  };

  const themeApi = {
    getCustomThemes,
    activateFamily(id) {
      if (!BUILTIN_THEME_IDS.includes(id)) return;      // §3.3 T2：未知 id 静默 no-op
      paintFamily(id);
      writeKey(KEYS.THEME_FAMILY, id);
      writeKey(KEYS.THEME_CUSTOM_APPLIED, '');
      writeKey(KEYS.THEME_TOUCHED, '1');
      writeKey(KEYS.TRACK, 'theme');
      notify();
    },
    async importCustomTheme(jsonText) {
      const item = validateTheme(jsonText);            // 失败即抛，下面一行 storage 都不写
      const reg = clone(readRegistry(KEYS.THEME_CUSTOM));
      const at = reg.items.findIndex((t) => t.id === item.id);
      if (at >= 0) reg.items[at] = item; else reg.items.push(item);   // 覆盖保留原位
      reg.version = 1;
      writeRegistry(KEYS.THEME_CUSTOM, reg);
      notify();
      return item;
    },
    previewCustomTheme(id) {
      const item = findCustomTheme(id);
      if (!item) throw codedError(ERR.UNKNOWN_ID, `未知自定义主题：${id}`);
      injectTokens(item.id, item.tokens);
      preview.themeId = item.id;                       // 试穿态由 apply 层持有
      notify();
    },
    applyCustomTheme(id) {
      const item = findCustomTheme(id);
      if (!item) throw codedError(ERR.UNKNOWN_ID, `未知自定义主题：${id}`);
      injectTokens(item.id, item.tokens);
      preview.themeId = null;
      writeKey(KEYS.THEME_CUSTOM_APPLIED, id);
      writeKey(KEYS.THEME_FAMILY, '');
      writeKey(KEYS.THEME_TOUCHED, '1');
      writeKey(KEYS.TRACK, 'theme');
      notify();
    },
    deleteCustomTheme(id) {
      if (BUILTIN_THEME_IDS.includes(id)) return;      // 静默 no-op
      const reg = clone(readRegistry(KEYS.THEME_CUSTOM));
      const at = reg.items.findIndex((t) => t.id === id);
      if (at < 0) return;                              // 静默 no-op
      reg.items.splice(at, 1);
      writeRegistry(KEYS.THEME_CUSTOM, reg);
      if (readKey(KEYS.THEME_CUSTOM_APPLIED) === id) {
        writeKey(KEYS.THEME_CUSTOM_APPLIED, '');
        writeKey(KEYS.THEME_FAMILY, DEFAULT_THEME_ID);
        writeKey(KEYS.THEME_TOUCHED, '1');
        writeKey(KEYS.TRACK, 'theme');
        paintFamily(DEFAULT_THEME_ID);
      }
      notify();
    },
    restoreDefaultTheme() {
      writeRegistry(KEYS.THEME_CUSTOM, clone(EMPTY_REGISTRY));
      writeKey(KEYS.THEME_CUSTOM_APPLIED, '');
      writeKey(KEYS.THEME_FAMILY, DEFAULT_THEME_ID);
      dropKey(KEYS.THEME_TOUCHED);                     // §3.3 T7：touched 是 removeItem
      writeKey(KEYS.TRACK, 'theme');
      paintFamily(DEFAULT_THEME_ID);
      notify();
    },
  };

  // ---------------- 皮肤轨 ----------------
  const preview = { skinId: null, themeId: null };
  let activating = false;                              // §3.3 串行化闸
  const getCustomSkins = () => readRegistry(KEYS.SKIN_CUSTOM).items;
  const findCustomSkin = (id) => getCustomSkins().find((s) => s.id === id) || null;
  const bodySnapshot = () => ({ attrs: { ...dom.body.attrs }, inline: { ...dom.body.inline } });
  const restoreSnapshot = (snap) => { dom.body.attrs = snap.attrs; dom.body.inline = snap.inline; };

  const unloadSkin = () => {
    dom.body.attrs = {}; dom.body.inline = {};
    dom.styles = dom.styles.filter((s) => s.mark !== 'data-skin' && s.mark !== 'data-skin-a11y');
    dom.activeSkin = null;
  };

  async function activate(item) {
    const pkg = `dsh-skin-${item.id}`;
    const snap = bodySnapshot();
    try {
      if (!moduleTable.has(pkg)) {
        const text = item.source === 'custom' ? item.bundleText : bundles.get(item.id);
        if (!text) throw new Error(runtimeUnknownSkin(item.id)); // A4：message 全文含 (no embedded bundle)
        execScript(text);
        moduleTable.set(pkg, { apply: () => {} });
      }
      await Promise.resolve();
      if (opts.failActivate === item.id) {
        dom.body.attrs['data-half-applied'] = '1';       // 半成品残留，失败后必须被回滚掉
        dom.disposerRuns += 1;                           // 逆序跑完已注册 disposer
        throw new Error(`activate failed: ${item.id}`);
      }
      dom.body.attrs[item.bodyAttr || `data-dsh-${item.id}`] = '1';
      dom.body.inline['--skin'] = item.id;
      dom.styles.push({ mark: 'data-skin', text: `/* ${item.id} */` });
      if (item.a11yText) dom.styles.push({ mark: 'data-skin-a11y', text: item.a11yText });
      dom.activeSkin = item.id;
    } catch (e) {
      restoreSnapshot(snap);                           // §3.8 第 2 条：回滚 body 快照后重抛
      throw e;
    }
  }

  const revertPreview = () => {
    if (!preview.skinId && !preview.themeId) return;
    preview.skinId = null; preview.themeId = null;
    restoreFromStorage({ silent: true });
  };

  async function guarded(fn) {
    if (activating) return undefined;                  // 重入：忽略、不排队、不抛错
    activating = true;
    try { revertPreview(); return await fn(); } finally { activating = false; }
  }

  const skinRuntime = {
    getPreviewState() { return { skinId: preview.skinId || '' }; },
    async previewSkin(id) {
      return guarded(async () => {
        const item = builtinSkins.find((s) => s.id === id);
        if (!item) throw codedError(ERR.UNKNOWN_ID, `未知内置皮肤：${id}`);
        unloadSkin();
        await activate(item);
        preview.skinId = id;
        notify();
      });
    },
    async applySkin(id) {
      return guarded(async () => {
        const item = builtinSkins.find((s) => s.id === id);
        if (!item) throw codedError(ERR.UNKNOWN_ID, `未知内置皮肤：${id}`);
        unloadSkin();
        await activate(item);                          // 失败即抛，下面的 applied 键不写
        writeKey(KEYS.SKIN_BUILTIN, id);
        writeKey(KEYS.SKIN_CUSTOM_APPLIED, '');
        writeKey(KEYS.TRACK, 'skin');
        notify();
      });
    },
    async clearSkin() { unloadSkin(); preview.skinId = null; notify(); },
  };

  const customSkinApi = {
    getSkins: getCustomSkins,
    async previewCustomSkin(id) {
      return guarded(async () => {
        const item = findCustomSkin(id);
        if (!item) throw codedError(ERR.UNKNOWN_ID, `未知自定义皮肤：${id}`);
        unloadSkin();
        await activate(item);
        preview.skinId = id;
        notify();
      });
    },
    async applyCustomSkin(id) {
      return guarded(async () => {
        const item = findCustomSkin(id);
        if (!item) throw codedError(ERR.UNKNOWN_ID, `未知自定义皮肤：${id}`);
        moduleTable.delete(`dsh-skin-${id}`);          // §3.7：重新注册同 id 前先 invalidate
        unloadSkin();
        await activate(item);
        writeKey(KEYS.SKIN_CUSTOM_APPLIED, id);
        writeKey(KEYS.SKIN_BUILTIN, '');
        writeKey(KEYS.TRACK, 'skin');
        notify();
      });
    },
    async importCustomSkin(parts) {
      const existing = getCustomSkins().map((s) => s.id);
      const item = validateBundle(parts, existing);    // 失败即抛：不写 storage、不进 manifest
      const reg = clone(readRegistry(KEYS.SKIN_CUSTOM));
      const at = reg.items.findIndex((s) => s.id === item.id);
      if (at >= 0) reg.items[at] = item; else reg.items.push(item);
      reg.version = 1;
      writeRegistry(KEYS.SKIN_CUSTOM, reg);
      const live = readKey(KEYS.SKIN_CUSTOM_APPLIED) === item.id || preview.skinId === item.id;
      if (live) await customSkinApi.applyCustomSkin(item.id);   // 覆盖生效项 → 用新 bundle 重新激活
      notify();
      return item;
    },
    deleteCustomSkin(id) {
      if (BUILTIN_SKIN_IDS.includes(id)) return;
      const reg = clone(readRegistry(KEYS.SKIN_CUSTOM));
      const at = reg.items.findIndex((s) => s.id === id);
      if (at < 0) return;
      reg.items.splice(at, 1);
      writeRegistry(KEYS.SKIN_CUSTOM, reg);
      if (readKey(KEYS.SKIN_CUSTOM_APPLIED) === id) {
        writeKey(KEYS.SKIN_CUSTOM_APPLIED, '');
        writeKey(KEYS.SKIN_BUILTIN, '');
        writeKey(KEYS.TRACK, 'skin');
        unloadSkin();
      }
      notify();
    },
    /** §3.3 S4：卡片点主体 —— 自定义先 applyCustomSkin 再激活；内置走 applySkin（"同 S3"） */
    async choose(id) {
      if (findCustomSkin(id)) return customSkinApi.applyCustomSkin(id);
      return skinRuntime.applySkin(id);
    },
    restoreDefaultSkin() {
      unloadSkin();
      writeRegistry(KEYS.SKIN_CUSTOM, clone(EMPTY_REGISTRY));
      writeKey(KEYS.SKIN_CUSTOM_APPLIED, '');
      writeKey(KEYS.SKIN_BUILTIN, '');
      writeKey(KEYS.TRACK, 'skin');
      notify();
    },
  };

  // ---------------- 启动恢复（§3.2）----------------
  function restoreFromStorage({ silent } = {}) {
    const customThemeId = readKey(KEYS.THEME_CUSTOM_APPLIED);
    const custom = customThemeId ? findCustomTheme(customThemeId) : null;
    if (custom) injectTokens(custom.id, custom.tokens);
    else paintFamily(readKey(KEYS.THEME_FAMILY) || DEFAULT_THEME_ID);

    const customSkinId = readKey(KEYS.SKIN_CUSTOM_APPLIED);
    const customSkin = customSkinId ? findCustomSkin(customSkinId) : null;
    const builtinId = readKey(KEYS.SKIN_BUILTIN);
    const builtin = builtinId ? builtinSkins.find((s) => s.id === builtinId) : null;
    const target = customSkin || builtin;               // 自定义 applied 优先于内置
    if (target) { void activate(target).catch(() => {}); } else unloadSkin();
    if (!silent) notify();
  }

  /** 生效外观（E1 摘要与断言都读这个，不读 applied 键） */
  function effectiveAppearance() {
    if (dom.activeSkin) {
      const all = [...getCustomSkins(), ...builtinSkins];
      const it = all.find((s) => s.id === dom.activeSkin);
      return { kind: 'skin', id: dom.activeSkin, name: it ? it.name : dom.activeSkin };
    }
    const cid = readKey(KEYS.THEME_CUSTOM_APPLIED);
    const c = cid ? findCustomTheme(cid) : null;
    if (c) return { kind: 'theme', id: c.id, label: c.label };
    const fid = readKey(KEYS.THEME_FAMILY);
    const fam = families.find((f) => f.id === fid) || families.find((f) => f.id === DEFAULT_THEME_ID);
    return { kind: 'theme', id: fam.id, label: fam.label };
  }

  const surface = {
    apply: () => {}, activateSkin: skinRuntime.applySkin, previewSkin: skinRuntime.previewSkin,
    applySkin: skinRuntime.applySkin, clearSkin: skinRuntime.clearSkin,
    currentSkinState: () => ({ id: dom.activeSkin || '' }), getSkins: () => [...builtinSkins, ...getCustomSkins()],
    getPreviewState: skinRuntime.getPreviewState, readStored: readKey, writeStored: writeKey,
    teardown: () => teardownSkins(), revertPreview,
  };

  function teardownSkins() { unloadSkin(); moduleTable.clear(); }

  const slotCalls = { inject: [], register: [] };
  let entryFactory = null;

  /** apply(ctx) 层 */
  function start(ctx = {}) {
    const services = ctx.services || { theme: {}, slots: {} };
    const get = (n) => services[n];
    if (get('theme') === undefined || get('slots') === undefined) {
      return { registered: false, dispose: () => {} };     // 直接 return：不注册、不注样式、不碰 storage
    }
    dom.styles.push({ mark: STYLE_MARK, text: '/* theme+skin css */' });
    slotCalls.inject.push(SLOT.name);
    slotCalls.register.push({ arg: { name: SLOT.name, id: SLOT.id, order: SLOT.order }, insideInject: true });
    restoreFromStorage();
    entryFactory = createEntryFactory({
      react: opts.react, families, builtinSkins, themeApi, customSkinApi, skinRuntime,
      engine: hasModules ? { activate } : null, subscribe, revertPreview,
      effectiveAppearance, legacyPresent: dom.hasLegacy(),
    });
    return {
      registered: true,
      dispose() {
        revertPreview();
        dom.styles = dom.styles.filter((s) => s.mark !== STYLE_MARK);
        removeOverride();
        teardownSkins();
      },
    };
  }

  return {
    /** §3.5：track 键的值域是 'theme' | 'skin'，其余一切读作 '' */
    readTrack() { const v = readKey(KEYS.TRACK); return v === 'theme' || v === 'skin' ? v : ''; },
    storage, dom, families, builtinSkins, slotCalls,
    themeApi, customSkinApi, skinRuntime, surface, subscribe,
    revertPreview, effectiveAppearance, teardownSkins,
    get engine() { return hasModules ? { activate } : null; },
    get execCount() { return execCount; },
    get entry() {
      if (!entryFactory) throw undefinedBehavior('未调用 start() 就取 entry');
      return entryFactory;
    },
    start,
    summaryText() {
      const eff = effectiveAppearance();
      return eff.kind === 'skin' ? TEXT.summarySkinPrefix + eff.name : TEXT.summaryThemePrefix + eff.label;
    },
  };
}
