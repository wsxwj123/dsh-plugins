// INTERFACE §3.2 插件生命周期、前置服务、启动恢复、样式注入、旧包自检
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSubject } from './helpers/subject.mjs';
import { KEYS, STYLE_MARK, TEXT, JADE_LABEL } from './helpers/contract.mjs';
import { textOf, hasClass, hasType } from './helpers/fake-react.mjs';
import { themeRegistry, skinRegistry } from './helpers/fixtures.mjs';

const FULL = { services: { theme: {}, slots: {} } };

test('前置服务_theme为undefined时直接return_不注入样式', async () => {
  const h = await createSubject();
  const r = h.start({ services: { slots: {} } });
  assert.equal(r.registered, false);
  assert.equal(h.dom.styleCount(STYLE_MARK), 0);
});

test('前置服务_slots为undefined时直接return_不注入样式', async () => {
  const h = await createSubject();
  const r = h.start({ services: { theme: {} } });
  assert.equal(r.registered, false);
  assert.equal(h.dom.styleCount(STYLE_MARK), 0);
});

test('前置服务_两者都缺时一次storage读写都不发生', async () => {
  const h = await createSubject();
  h.storage.resetStats();
  h.start({ services: {} });
  assert.deepEqual(
    { get: h.storage.stats.get, set: h.storage.stats.set, remove: h.storage.stats.remove },
    { get: 0, set: 0, remove: 0 },
  );
});

test('样式注入_启动后data-appearance-gallery的style恰好1个', async () => {
  const h = await createSubject();
  h.start(FULL);
  assert.equal(h.dom.styleCount(STYLE_MARK), 1);
});

test('样式注入_插件停止后data-appearance-gallery的style为0个', async () => {
  const h = await createSubject();
  const r = h.start(FULL);
  r.dispose();
  assert.equal(h.dom.styleCount(STYLE_MARK), 0);
});

test('插件停止_不删除任何storage键', async () => {
  const h = await createSubject({
    seed: {
      [KEYS.THEME_FAMILY]: 'ember', [KEYS.THEME_TOUCHED]: '1',
      [KEYS.SKIN_BUILTIN]: 'miku', [KEYS.TRACK]: 'skin',
    },
  });
  const r = h.start(FULL);
  const before = h.storage.snapshot();
  r.dispose();
  assert.deepEqual(h.storage.snapshot(), before);
});

test('启动恢复_自定义主题applied存在时生效的是它而不是jade', async () => {
  const h = await createSubject({
    seed: {
      [KEYS.THEME_CUSTOM_APPLIED]: 'mine',
      [KEYS.THEME_CUSTOM]: themeRegistry([{ id: 'mine', label: '我的', tokens: { '--dsw-bg': { light: '#1', dark: '#2' } } }]),
    },
  });
  h.start(FULL);
  assert.deepEqual(h.effectiveAppearance(), { kind: 'theme', id: 'mine', label: '我的' });
});

test('启动恢复_family键缺省时回落jade', async () => {
  const h = await createSubject();
  h.start(FULL);
  assert.equal(h.effectiveAppearance().id, 'jade');
  assert.equal(h.effectiveAppearance().label, JADE_LABEL);
});

test('启动恢复_内置皮肤键指向miku时不打开面板也生效', async () => {
  const h = await createSubject({ seed: { [KEYS.SKIN_BUILTIN]: 'miku' } });
  h.start(FULL);
  await new Promise((r) => setImmediate(r));
  assert.equal(h.dom.activeSkin, 'miku');
  assert.equal(h.dom.body.attrs['data-dsh-miku'], '1');
});

test('启动恢复_自定义皮肤applied优先于内置皮肤键', async () => {
  const h = await createSubject({
    seed: {
      [KEYS.SKIN_BUILTIN]: 'miku',
      [KEYS.SKIN_CUSTOM_APPLIED]: 'navi',
      [KEYS.SKIN_CUSTOM]: skinRegistry(['navi']),
    },
  });
  h.start(FULL);
  await new Promise((r) => setImmediate(r));
  assert.equal(h.dom.activeSkin, 'navi');
});

test('启动恢复_自定义皮肤恢复后它仍出现在列表里', async () => {
  const h = await createSubject({
    seed: { [KEYS.SKIN_CUSTOM_APPLIED]: 'navi', [KEYS.SKIN_CUSTOM]: skinRegistry(['navi']) },
  });
  h.start(FULL);
  assert.equal(h.customSkinApi.getSkins().some((s) => s.id === 'navi'), true);
});

test('引擎不可用_缺__DSH_MODULES__时engine为null', async () => {
  const h = await createSubject({ modules: false });
  h.start(FULL);
  assert.equal(h.engine, null);
});

test('引擎不可用_皮肤区渲染指定占位文案', async () => {
  const h = await createSubject({ modules: false });
  h.start(FULL);
  const tree = h.entry.openPanel();
  const text = textOf(tree);
  assert.ok(text.includes(TEXT.skinUnavailableHead), `缺占位文案，实际：${text}`);
  assert.ok(text.includes(TEXT.skinUnavailableToken));
});

test('引擎不可用_占位态下不渲染皮肤卡片', async () => {
  const h = await createSubject({ modules: false });
  h.start(FULL);
  const tree = h.entry.openPanel();
  assert.equal(hasClass(tree, 'skin-gallery-card'), false);
});

test('引擎不可用_占位态下不渲染皮肤搜索框', async () => {
  const h = await createSubject({ modules: false });
  h.start(FULL);
  const tree = h.entry.openPanel();
  assert.equal(hasClass(tree, 'skin-gallery-search'), false);
});

test('引擎不可用_占位态下不渲染导入删除恢复按钮', async () => {
  const h = await createSubject({ modules: false });
  h.start(FULL);
  const text = textOf(h.entry.openPanel());
  for (const label of ['导入皮肤', '删除皮肤', '恢复默认外观', '创建自定义皮肤']) {
    assert.equal(text.includes(label), false, `占位态不应出现「${label}」`);
  }
});

test('引擎不可用_主题区照常工作不受影响', async () => {
  const h = await createSubject({ modules: false });
  h.start(FULL);
  const tree = h.entry.openPanel();
  assert.equal(hasClass(tree, 'theme-gallery-card'), true);
  assert.equal(hasType(tree, 'input'), true);
});

test('引擎不可用_不抛错且入口仍完成注册', async () => {
  const h = await createSubject({ modules: false });
  const r = h.start(FULL);
  assert.equal(r.registered, true);
});

test('旧包自检_探测到data-skin-gallery时渲染冲突提示原文', async () => {
  const h = await createSubject({ legacyStyles: ['data-skin-gallery'] });
  h.start(FULL);
  assert.ok(textOf(h.entry.render()).includes(TEXT.legacyConflict));
});

test('旧包自检_探测到data-theme-gallery时同样提示', async () => {
  const h = await createSubject({ legacyStyles: ['data-theme-gallery'] });
  h.start(FULL);
  assert.ok(textOf(h.entry.render()).includes(TEXT.legacyConflict));
});

test('旧包自检_未探测到旧包时静默无提示', async () => {
  const h = await createSubject();
  h.start(FULL);
  assert.equal(textOf(h.entry.render()).includes(TEXT.legacyConflict), false);
});
