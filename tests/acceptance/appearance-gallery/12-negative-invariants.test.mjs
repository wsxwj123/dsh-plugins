// 反向用例：断言"不该发生的事没发生"。依据 INTERFACE §3.0 / §3.2 / §3.3 / §3.8。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSubject } from './helpers/subject.mjs';
import { KEYS, ALL_KEYS, BUILTIN_THEME_IDS, BUILTIN_SKIN_IDS, STYLE_MARK, ERR } from './helpers/contract.mjs';
import { flattenTree, textOf } from './helpers/fake-react.mjs';
import { themeJson, themeRegistry, skinRegistry, skinParts, clientJs } from './helpers/fixtures.mjs';

const FULL = { services: { theme: {}, slots: {} } };
const started = async (opts = {}) => { const h = await createSubject(opts); h.start(FULL); return h; };
const snap = (h) => ALL_KEYS.map((k) => h.storage.raw(k));
const tick = () => new Promise((r) => setImmediate(r));

// ---------------- 导入失败不得留下任何痕迹 ----------------
test('反向_主题导入失败不得注入tokens', async () => {
  const h = await started({ seed: { [KEYS.THEME_FAMILY]: 'azure' } });
  await assert.rejects(h.themeApi.importCustomTheme(themeJson({ id: 'jade' })));
  assert.equal(h.dom.tokens.themeId, 'azure');
});

test('反向_皮肤导入失败不得激活任何皮肤', async () => {
  const h = await started();
  await assert.rejects(h.customSkinApi.importCustomSkin(skinParts({ client: clientJs('x', '/* eval() */') })));
  assert.equal(h.dom.activeSkin, null);
  assert.deepEqual(h.dom.body.attrs, {});
});

test('反向_皮肤导入失败不得新增style节点', async () => {
  const h = await started();
  const before = h.dom.styles.length;
  await assert.rejects(h.customSkinApi.importCustomSkin(skinParts({ a11y: '@import "x";' })));
  assert.equal(h.dom.styles.length, before);
});

test('反向_连续多次失败导入后storage写次数仍为0', async () => {
  const h = await started();
  h.storage.resetStats();
  for (const bad of ['{', '[]', 'null', '"s"']) {
    await assert.rejects(h.themeApi.importCustomTheme(bad));
  }
  assert.equal(h.storage.stats.set, 0);
  assert.equal(h.storage.stats.remove, 0);
});

// ---------------- 删除自定义项不得影响内置项 ----------------
test('反向_删除自定义主题不得影响15个内置主题', async () => {
  const h = await started({ seed: { [KEYS.THEME_CUSTOM]: themeRegistry(['m']) } });
  h.themeApi.deleteCustomTheme('m');
  assert.deepEqual(h.families.map((f) => f.id), BUILTIN_THEME_IDS);
});

test('反向_删除自定义皮肤不得影响9个内置皮肤', async () => {
  const h = await started({ seed: { [KEYS.SKIN_CUSTOM]: skinRegistry(['s']) } });
  h.customSkinApi.deleteCustomSkin('s');
  assert.deepEqual(h.builtinSkins.map((s) => s.id), BUILTIN_SKIN_IDS);
});

test('反向_恢复默认主题不得清空皮肤registry', async () => {
  const h = await started({ seed: { [KEYS.SKIN_CUSTOM]: skinRegistry(['keep']) } });
  const before = h.storage.raw(KEYS.SKIN_CUSTOM);
  h.themeApi.restoreDefaultTheme();
  assert.equal(h.storage.raw(KEYS.SKIN_CUSTOM), before);
});

test('反向_恢复默认外观不得清空主题registry', async () => {
  const h = await started({ seed: { [KEYS.THEME_CUSTOM]: themeRegistry(['keep']) } });
  const before = h.storage.raw(KEYS.THEME_CUSTOM);
  h.customSkinApi.restoreDefaultSkin();
  assert.equal(h.storage.raw(KEYS.THEME_CUSTOM), before);
});

// P0 修正：原断言是「不得删除已应用的皮肤键」—— 留着它，刷新后启动恢复把皮肤又拉回来。
// registry 不许动这条由上面「不得清空皮肤registry」保。
test('正向_恢复默认主题清掉已应用的皮肤键', async () => {
  const h = await started({ seed: { [KEYS.SKIN_BUILTIN]: 'xp' } });
  h.themeApi.restoreDefaultTheme();
  assert.equal(h.storage.read(KEYS.SKIN_BUILTIN), '');
});

test('反向_删除一个自定义皮肤不得连带删掉另一个', async () => {
  const h = await started({ seed: { [KEYS.SKIN_CUSTOM]: skinRegistry(['a', 'b', 'c']) } });
  h.customSkinApi.deleteCustomSkin('b');
  assert.deepEqual(h.customSkinApi.getSkins().map((s) => s.id), ['a', 'c']);
});

// ---------------- 试穿不得留下持久化痕迹 ----------------
test('反向_试穿皮肤全程不发生任何storage写操作', async () => {
  const h = await started();
  h.storage.resetStats();
  await h.skinRuntime.previewSkin('miku');
  assert.equal(h.storage.stats.set, 0);
  assert.equal(h.storage.stats.remove, 0);
});

test('反向_试穿主题全程不发生任何storage写操作', async () => {
  const h = await started({ seed: { [KEYS.THEME_CUSTOM]: themeRegistry(['m']) } });
  h.storage.resetStats();
  h.themeApi.previewCustomTheme('m');
  assert.equal(h.storage.stats.set, 0);
  assert.equal(h.storage.stats.remove, 0);
});

test('反向_试穿后不打开面板刷新页面等价于试穿从未发生', async () => {
  // 用"重新 start 一个读同一份 storage 的实例"模拟刷新
  const seed = { [KEYS.SKIN_BUILTIN]: 'xp' };
  const h1 = await started({ seed });
  await tick();
  await h1.skinRuntime.previewSkin('miku');
  const h2 = await createSubject({ seed: h1.storage.snapshot() });
  h2.start(FULL);
  await tick();
  assert.equal(h2.dom.activeSkin, 'xp');
});

// ---------------- 面板与生命周期不得越界 ----------------
test('反向_关闭面板不得写任何storage键', async () => {
  const h = await started({ seed: { [KEYS.THEME_FAMILY]: 'azure' } });
  h.entry.openPanel();
  h.storage.resetStats();
  h.entry.closePanel();
  assert.equal(h.storage.stats.set, 0);
  assert.equal(h.storage.stats.remove, 0);
});

test('反向_打开面板不得写任何storage键', async () => {
  const h = await started();
  h.entry.render();
  h.storage.resetStats();
  h.entry.openPanel();
  assert.equal(h.storage.stats.set, 0);
  assert.equal(h.storage.stats.remove, 0);
});

test('反向_插件停止不得删除用户导入的自定义内容', async () => {
  const h = await createSubject({
    seed: { [KEYS.THEME_CUSTOM]: themeRegistry(['m']), [KEYS.SKIN_CUSTOM]: skinRegistry(['s']) },
  });
  const r = h.start(FULL);
  r.dispose();
  assert.equal(h.storage.raw(KEYS.THEME_CUSTOM), themeRegistry(['m']));
  assert.equal(h.storage.raw(KEYS.SKIN_CUSTOM), skinRegistry(['s']));
});

test('反向_插件停止后body上不留皮肤属性', async () => {
  const h = await createSubject({ seed: { [KEYS.SKIN_BUILTIN]: 'miku' } });
  const r = h.start(FULL);
  await tick();
  r.dispose();
  assert.deepEqual(h.dom.body.attrs, {});
});

test('反向_插件停止后不留token override', async () => {
  const h = await createSubject({ seed: { [KEYS.THEME_FAMILY]: 'azure' } });
  const r = h.start(FULL);
  r.dispose();
  assert.equal(h.dom.tokens, null);
});

test('反向_前置服务缺失时不注册槽位也不注入样式也不碰storage', async () => {
  const h = await createSubject({ seed: { [KEYS.THEME_FAMILY]: 'azure' } });
  h.storage.resetStats();
  h.start({ services: { theme: undefined, slots: {} } });
  assert.equal(h.slotCalls.register.length, 0);
  assert.equal(h.dom.styleCount(STYLE_MARK), 0);
  assert.equal(h.storage.stats.get + h.storage.stats.set + h.storage.stats.remove, 0);
});

test('反向_引擎为null时调用皮肤入口不得写storage', async () => {
  const h = await started({ modules: false });
  const before = snap(h);
  h.storage.resetStats();
  h.entry.openPanel();
  assert.deepEqual(snap(h), before);
  assert.equal(h.storage.stats.set, 0);
});

// ---------------- 错误文案不得成为注入面（§3.8 渲染硬约定）----------------
test('反向_导入失败的错误文案按code冒号message格式渲染', async () => {
  const h = await started();
  h.entry.openPanel();
  await h.entry.themePanel.submitImport('不是 json');
  const text = textOf(h.entry.render());
  assert.ok(text.includes(`${ERR.IMPORT_INVALID_JSON}: `), `实际渲染：${text.slice(0, 200)}`);
});

test('反向_错误文案里的用户可控内容不得走HTML渲染', async () => {
  const h = await started();
  h.entry.openPanel();
  // 违规 ctx 名字会被抓进 message —— 这是从用户粘贴文本里正则抓出来的内容
  await h.entry.skinPanel.submitImport(skinParts({ client: clientJs('x', 'var a = ctx.injectMe;') }));
  const tree = h.entry.render();
  const dangerous = flattenTree(tree).filter((n) => n.props && (
    'dangerouslySetInnerHTML' in n.props || 'innerHTML' in n.props
  ));
  assert.deepEqual(dangerous, []);
  assert.ok(textOf(tree).includes('injectMe'));
});

test('反向_皮肤name含尖括号时只作为文本渲染不产生子节点', async () => {
  const h = await started();
  await h.customSkinApi.importCustomSkin(skinParts({ meta: { id: 'demo', name: '<img src=x onerror=1>' } }));
  const tree = h.entry.openPanel();
  const nodes = flattenTree(tree).filter((n) => n.type === 'img');
  assert.deepEqual(nodes, []);
  assert.ok(textOf(tree).includes('<img src=x onerror=1>'));
});

// ---------------- 未知 id 一律不得静默改状态 ----------------
test('反向_对未知内置主题id的应用不得写family键', async () => {
  const h = await started();
  h.themeApi.activateFamily('made-up');
  assert.equal(h.storage.raw(KEYS.THEME_FAMILY), null);
});

test('反向_对未知皮肤id的应用不得写skin-v1键', async () => {
  const h = await started();
  await assert.rejects(h.skinRuntime.applySkin('made-up'));
  assert.equal(h.storage.raw(KEYS.SKIN_BUILTIN), null);
});

test('反向_对未知皮肤id的应用不得执行任何脚本', async () => {
  const h = await started();
  await assert.rejects(h.skinRuntime.applySkin('made-up'));
  assert.equal(h.execCount, 0);
});
