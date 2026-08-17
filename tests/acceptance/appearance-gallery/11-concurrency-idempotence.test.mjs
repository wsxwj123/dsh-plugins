// INTERFACE §3.3 激活流程串行化约定 + §3.8 第 7 条 + 幂等（重复应用 / 重复导入）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSubject } from './helpers/subject.mjs';
import { KEYS, ALL_KEYS } from './helpers/contract.mjs';
import { themeJson, skinParts, skinRegistry } from './helpers/fixtures.mjs';

const FULL = { services: { theme: {}, slots: {} } };
const started = async (opts = {}) => { const h = await createSubject(opts); h.start(FULL); return h; };
const snap = (h) => ALL_KEYS.map((k) => h.storage.raw(k));
const skinAttrs = (h) => Object.keys(h.dom.body.attrs).filter((a) => a.startsWith('data-dsh-'));

// ---------------- 串行化 ----------------
test('串行化_并发应用两个皮肤后body上只留一套皮肤属性', async () => {
  const h = await started();
  await Promise.all([h.skinRuntime.applySkin('qq98'), h.skinRuntime.applySkin('miku')]);
  assert.equal(skinAttrs(h).length, 1, `body 上残留多套皮肤：${skinAttrs(h).join(',')}`);
});

test('串行化_并发应用两个皮肤后body属性与skin-v1键一致', async () => {
  const h = await started();
  await Promise.all([h.skinRuntime.applySkin('qq98'), h.skinRuntime.applySkin('miku')]);
  const stored = h.storage.read(KEYS.SKIN_BUILTIN);
  assert.equal(h.dom.body.attrs[`data-dsh-${stored}`], '1');
  assert.equal(h.dom.activeSkin, stored);
});

test('串行化_并发应用两个皮肤时内联style也只剩一套', async () => {
  const h = await started();
  await Promise.all([h.skinRuntime.applySkin('xp'), h.skinRuntime.applySkin('trading')]);
  assert.equal(h.dom.body.inline['--skin'], h.storage.read(KEYS.SKIN_BUILTIN));
  assert.equal(h.dom.styleCount('data-skin'), 1);
});

test('串行化_重入的第二次调用被忽略且不抛错', async () => {
  const h = await started();
  const results = await Promise.allSettled([h.skinRuntime.applySkin('qq98'), h.skinRuntime.applySkin('miku')]);
  assert.deepEqual(results.map((r) => r.status), ['fulfilled', 'fulfilled']);
});

test('串行化_并发同一个id时脚本注入次数是1', async () => {
  const h = await started();
  await Promise.all([h.skinRuntime.applySkin('qq98'), h.skinRuntime.applySkin('qq98')]);
  assert.equal(h.execCount, 1);
});

test('串行化_顺序重复点同一个应用两次不产生第二次脚本注入', async () => {
  const h = await started();
  await h.skinRuntime.applySkin('qq98');
  await h.skinRuntime.applySkin('qq98');
  assert.equal(h.execCount, 1);
});

test('串行化_并发试穿与应用只有一个生效', async () => {
  const h = await started();
  await Promise.all([h.skinRuntime.previewSkin('miku'), h.skinRuntime.applySkin('xp')]);
  assert.equal(skinAttrs(h).length, 1);
});

test('串行化_并发内置与自定义皮肤只有一套生效', async () => {
  const h = await started({ seed: { [KEYS.SKIN_CUSTOM]: skinRegistry(['navi']) } });
  await Promise.all([h.skinRuntime.applySkin('xp'), h.customSkinApi.applyCustomSkin('navi')]);
  assert.equal(skinAttrs(h).length, 1);
});

test('串行化_并发三个皮肤后applied键与body一致', async () => {
  const h = await started();
  await Promise.all([
    h.skinRuntime.applySkin('xp'), h.skinRuntime.applySkin('miku'), h.skinRuntime.applySkin('ths'),
  ]);
  assert.equal(h.dom.activeSkin, h.storage.read(KEYS.SKIN_BUILTIN));
});

// ---------------- 幂等 ----------------
test('幂等_重复应用同一内置主题两次storage结果相同', async () => {
  const h = await started();
  h.themeApi.activateFamily('eclipse');
  const after1 = snap(h);
  h.themeApi.activateFamily('eclipse');
  assert.deepEqual(snap(h), after1);
});

test('幂等_重复应用同一内置皮肤两次storage结果相同', async () => {
  const h = await started();
  await h.skinRuntime.applySkin('miku');
  const after1 = snap(h);
  await h.skinRuntime.applySkin('miku');
  assert.deepEqual(snap(h), after1);
});

test('幂等_重复应用同一内置皮肤两次body不叠加', async () => {
  const h = await started();
  await h.skinRuntime.applySkin('miku');
  await h.skinRuntime.applySkin('miku');
  assert.equal(skinAttrs(h).length, 1);
  assert.equal(h.dom.styleCount('data-skin'), 1);
});

test('幂等_重复导入同id主题两次registry仍只有1项', async () => {
  const h = await started();
  await h.themeApi.importCustomTheme(themeJson({ id: 'dup' }));
  await h.themeApi.importCustomTheme(themeJson({ id: 'dup' }));
  assert.equal(h.themeApi.getCustomThemes().length, 1);
});

test('幂等_重复导入同id皮肤两次registry仍只有1项', async () => {
  const h = await started();
  await h.customSkinApi.importCustomSkin(skinParts({ id: 'dup', meta: { id: 'dup' } }));
  await h.customSkinApi.importCustomSkin(skinParts({ id: 'dup', meta: { id: 'dup' } }));
  assert.equal(h.customSkinApi.getSkins().length, 1);
});

test('幂等_并发导入同id皮肤两次registry不出现重复项', async () => {
  const h = await started();
  await Promise.all([
    h.customSkinApi.importCustomSkin(skinParts({ id: 'dup', meta: { id: 'dup' } })),
    h.customSkinApi.importCustomSkin(skinParts({ id: 'dup', meta: { id: 'dup' } })),
  ]);
  assert.deepEqual(h.customSkinApi.getSkins().map((s) => s.id), ['dup']);
});

test('幂等_重复恢复默认主题两次结果相同', async () => {
  const h = await started();
  h.themeApi.restoreDefaultTheme();
  const after1 = snap(h);
  h.themeApi.restoreDefaultTheme();
  assert.deepEqual(snap(h), after1);
});

test('幂等_重复恢复默认外观两次结果相同', async () => {
  const h = await started();
  h.customSkinApi.restoreDefaultSkin();
  const after1 = snap(h);
  h.customSkinApi.restoreDefaultSkin();
  assert.deepEqual(snap(h), after1);
});

test('幂等_重复删除同一自定义主题第二次是静默no-op', async () => {
  const h = await started();
  await h.themeApi.importCustomTheme(themeJson({ id: 'gone' }));
  h.themeApi.deleteCustomTheme('gone');
  const after1 = snap(h);
  assert.doesNotThrow(() => h.themeApi.deleteCustomTheme('gone'));
  assert.deepEqual(snap(h), after1);
});

test('幂等_重复删除同一自定义皮肤第二次是静默no-op', async () => {
  const h = await started({ seed: { [KEYS.SKIN_CUSTOM]: skinRegistry(['gone']) } });
  h.customSkinApi.deleteCustomSkin('gone');
  const after1 = snap(h);
  assert.doesNotThrow(() => h.customSkinApi.deleteCustomSkin('gone'));
  assert.deepEqual(snap(h), after1);
});

test('幂等_重复清空皮肤两次不抛错', async () => {
  const h = await started();
  await h.skinRuntime.applySkin('xp');
  await h.skinRuntime.clearSkin();
  await assert.doesNotReject(h.skinRuntime.clearSkin());
  assert.equal(h.dom.activeSkin, null);
});

test('幂等_重复撤销试穿两次不抛错也不改状态', async () => {
  const h = await started({ seed: { [KEYS.SKIN_BUILTIN]: 'xp' } });
  await new Promise((r) => setImmediate(r));
  h.revertPreview();
  const after1 = snap(h);
  assert.doesNotThrow(() => h.revertPreview());
  assert.deepEqual(snap(h), after1);
});

test('幂等_重复打开关闭面板两轮后storage不变', async () => {
  const h = await started({ seed: { [KEYS.THEME_FAMILY]: 'azure' } });
  const before = snap(h);
  h.entry.openPanel(); h.entry.closePanel();
  h.entry.openPanel(); h.entry.closePanel();
  assert.deepEqual(snap(h), before);
});
