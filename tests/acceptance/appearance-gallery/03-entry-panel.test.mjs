// INTERFACE §3.3 E1/E2/E3（状态摘要、懒挂载、关面板撤销试穿）+ §3.9 边界约束 2
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSubject } from './helpers/subject.mjs';
import { KEYS, TEXT, ALL_KEYS, JADE_LABEL, PERF } from './helpers/contract.mjs';
import { countNodes, textOf, hasClass, hasType, hasComponentNode } from './helpers/fake-react.mjs';
import { themeRegistry, skinRegistry } from './helpers/fixtures.mjs';

const FULL = { services: { theme: {}, slots: {} } };
const tick = () => new Promise((r) => setImmediate(r));

test('E1摘要_applied键悬空且registry为空时显示实际回落到的jade', async () => {
  const h = await createSubject({ seed: { [KEYS.THEME_CUSTOM_APPLIED]: 'ghost' } });
  h.start(FULL);
  assert.equal(h.summaryText(), `${TEXT.summaryThemePrefix}${JADE_LABEL}`);
  assert.equal(h.summaryText(), '精选主题 · 竹青');
});

test('E1摘要_悬空applied时摘要区不含任何卡片元素', async () => {
  const h = await createSubject({ seed: { [KEYS.THEME_CUSTOM_APPLIED]: 'ghost' } });
  h.start(FULL);
  const tree = h.entry.render();
  assert.equal(hasClass(tree, 'theme-gallery-card'), false);
  assert.equal(hasClass(tree, 'skin-gallery-card'), false);
});

test('E1摘要_自定义主题生效时显示该主题的label', async () => {
  const h = await createSubject({
    seed: {
      [KEYS.THEME_CUSTOM_APPLIED]: 'mine',
      [KEYS.THEME_CUSTOM]: themeRegistry([{ id: 'mine', label: '墨白', tokens: { '--dsw-bg': { light: '#a', dark: '#b' } } }]),
    },
  });
  h.start(FULL);
  assert.equal(h.summaryText(), '精选主题 · 墨白');
});

test('E1摘要_皮肤生效时前缀是完整皮肤而不是精选主题', async () => {
  const h = await createSubject({ seed: { [KEYS.SKIN_BUILTIN]: 'miku' } });
  h.start(FULL);
  await tick();
  assert.equal(h.summaryText().startsWith(TEXT.summarySkinPrefix), true);
  assert.equal(h.summaryText().startsWith(TEXT.summaryThemePrefix), false);
});

test('E1摘要_全新安装8键全空时显示精选主题竹青', async () => {
  // A2 裁决：摘要只有两种文案，「默认外观」已从契约删除；8 键全空归入「精选主题 · jade 的 label」
  const h = await createSubject();
  h.start(FULL);
  assert.deepEqual(h.storage.keys(), [], '前置条件：8 个键必须全空');
  assert.equal(h.summaryText(), '精选主题 · 竹青');
});

test('E1摘要_不存在默认外观这种文案', async () => {
  // A2 裁决的反向断言：契约里已无第三种文案
  const h = await createSubject();
  h.start(FULL);
  assert.equal(textOf(h.entry.render()).includes('默认外观'), false);
});

test('E2懒挂载_open为false时渲染树节点数不超过10', async () => {
  const h = await createSubject();
  h.start(FULL);
  const n = countNodes(h.entry.render());
  assert.ok(n <= PERF.entryClosedMaxNodes, `闭合态节点数 ${n} > ${PERF.entryClosedMaxNodes}`);
});

test('E2懒挂载_open为false时不含主题卡片', async () => {
  const h = await createSubject();
  h.start(FULL);
  assert.equal(hasClass(h.entry.render(), 'theme-gallery-card'), false);
});

test('E2懒挂载_open为false时不含皮肤卡片', async () => {
  const h = await createSubject();
  h.start(FULL);
  assert.equal(hasClass(h.entry.render(), 'skin-gallery-card'), false);
});

test('E2懒挂载_open为false时不含textarea', async () => {
  const h = await createSubject();
  h.start(FULL);
  assert.equal(hasType(h.entry.render(), 'textarea'), false);
});

test('E2懒挂载_open为true后主题卡与皮肤卡与textarea同时出现', async () => {
  const h = await createSubject();
  h.start(FULL);
  const tree = h.entry.openPanel();
  assert.equal(hasClass(tree, 'theme-gallery-card'), true);
  assert.equal(hasClass(tree, 'skin-gallery-card'), true);
  assert.equal(hasType(tree, 'textarea'), true);
});

test('面板挂载_两个Panel都以组件引用经createElement挂载', async () => {
  const h = await createSubject();
  h.start(FULL);
  const tree = h.entry.openPanel();
  assert.equal(hasComponentNode(tree, h.entry.ThemePanel), true, 'ThemePanel 未作为组件节点出现（疑似被直接调用）');
  assert.equal(hasComponentNode(tree, h.entry.SkinPanel), true, 'SkinPanel 未作为组件节点出现（疑似被直接调用）');
});

test('E3关闭_关闭前后8个storage键的值完全相同', async () => {
  const h = await createSubject({ seed: { [KEYS.SKIN_BUILTIN]: 'qq98' } });
  h.start(FULL);
  h.entry.openPanel();
  await h.skinRuntime.previewSkin('miku');
  const before = ALL_KEYS.map((k) => h.storage.raw(k));
  h.entry.closePanel();
  await tick();
  assert.deepEqual(ALL_KEYS.map((k) => h.storage.raw(k)), before);
});

test('E3关闭_关闭后getPreviewState的skinId为空', async () => {
  const h = await createSubject();
  h.start(FULL);
  h.entry.openPanel();
  await h.skinRuntime.previewSkin('miku');
  assert.equal(h.skinRuntime.getPreviewState().skinId, 'miku');
  h.entry.closePanel();
  await tick();
  assert.equal(h.skinRuntime.getPreviewState().skinId, '');
});

test('E3关闭_试穿皮肤后关面板回到storage记录的已应用皮肤', async () => {
  const h = await createSubject({ seed: { [KEYS.SKIN_BUILTIN]: 'qq98' } });
  h.start(FULL);
  await tick();
  h.entry.openPanel();
  await h.skinRuntime.previewSkin('miku');
  assert.equal(h.dom.activeSkin, 'miku');
  h.entry.closePanel();
  await tick();
  assert.equal(h.dom.activeSkin, 'qq98');
});

test('E3关闭_storage无已应用皮肤时试穿后关面板清空皮肤', async () => {
  const h = await createSubject();
  h.start(FULL);
  h.entry.openPanel();
  await h.skinRuntime.previewSkin('miku');
  h.entry.closePanel();
  await tick();
  assert.equal(h.dom.activeSkin, null);
  assert.deepEqual(h.dom.body.attrs, {});
});

test('E3关闭_试穿自定义主题后关面板回到storage记录的主题', async () => {
  const h = await createSubject({
    seed: {
      [KEYS.THEME_FAMILY]: 'ember',
      [KEYS.THEME_CUSTOM]: themeRegistry([{ id: 'mine', label: '我的', tokens: { '--dsw-x': { light: '1', dark: '2' } } }]),
    },
  });
  h.start(FULL);
  h.entry.openPanel();
  h.themeApi.previewCustomTheme('mine');
  assert.equal(h.dom.tokens.themeId, 'mine');
  h.entry.closePanel();
  await tick();
  assert.equal(h.dom.tokens.themeId, 'ember');
});

test('E3关闭_自定义皮肤已应用时试穿内置后关面板回到自定义皮肤', async () => {
  const h = await createSubject({
    seed: { [KEYS.SKIN_CUSTOM_APPLIED]: 'navi', [KEYS.SKIN_CUSTOM]: skinRegistry(['navi']) },
  });
  h.start(FULL);
  await tick();
  h.entry.openPanel();
  await h.skinRuntime.previewSkin('xp');
  h.entry.closePanel();
  await tick();
  assert.equal(h.dom.activeSkin, 'navi');
});
