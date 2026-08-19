// INTERFACE §3.3 皮肤段 S1–S8
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSubject } from './helpers/subject.mjs';
import { KEYS, ALL_KEYS, SEARCH_INPUT_MAX, ERR, runtimeUnknownSkin } from './helpers/contract.mjs';
import { textOf } from './helpers/fake-react.mjs';
import { skinRegistry } from './helpers/fixtures.mjs';

const FULL = { services: { theme: {}, slots: {} } };
const started = async (opts = {}) => { const h = await createSubject(opts); h.start(FULL); return h; };
const snap = (h) => ALL_KEYS.map((k) => h.storage.raw(k));
const code = (c) => (e) => e.code === c;
const tick = () => new Promise((r) => setImmediate(r));

test('S1搜索_无关键词时计数为9分之9', async () => {
  const h = await started();
  h.entry.openPanel();
  assert.ok(textOf(h.entry.render()).includes('9/9'));
});

test('S1搜索_有1个自定义皮肤时总数变10', async () => {
  const h = await started({ seed: { [KEYS.SKIN_CUSTOM]: skinRegistry(['navi']) } });
  h.entry.openPanel();
  assert.ok(textOf(h.entry.render()).includes('10/10'));
});

test('S1搜索_按id命中时计数收敛到1', async () => {
  const h = await started();
  h.entry.openPanel();
  h.entry.skinPanel.setSearch('miku');
  assert.ok(textOf(h.entry.render()).includes('1/9'));
});

test('S1搜索_无命中时计数为0分之9', async () => {
  const h = await started();
  h.entry.openPanel();
  h.entry.skinPanel.setSearch('zzzz-none');
  assert.ok(textOf(h.entry.render()).includes('0/9'));
});

test('S1搜索_输入100字符被截断为64', async () => {
  const h = await started();
  h.entry.openPanel();
  h.entry.skinPanel.setSearch('q'.repeat(100));
  assert.equal(h.entry.skinPanel.state.search.length, SEARCH_INPUT_MAX);
});

test('S2试穿内置皮肤_body属性与皮肤style到位', async () => {
  const h = await started();
  await h.skinRuntime.previewSkin('xp');
  assert.equal(h.dom.body.attrs['data-dsh-xp'], '1');
  assert.equal(h.dom.body.inline['--skin'], 'xp');
  assert.equal(h.dom.styleCount('data-skin'), 1);
});

test('S2试穿内置皮肤_不写任何applied键', async () => {
  const h = await started();
  const before = snap(h);
  await h.skinRuntime.previewSkin('xp');
  assert.deepEqual(snap(h), before);
});

test('S2试穿内置皮肤_未知内置id抛ERR_UNKNOWN_ID', async () => {
  const h = await started();
  await assert.rejects(h.skinRuntime.previewSkin('not-a-skin'), code(ERR.UNKNOWN_ID));
});

test('S2试穿内置皮肤_未知id时不改body也不写storage', async () => {
  const h = await started();
  const before = snap(h);
  await assert.rejects(h.skinRuntime.previewSkin('not-a-skin'), code(ERR.UNKNOWN_ID));
  assert.deepEqual(h.dom.body.attrs, {});
  assert.deepEqual(snap(h), before);
});

test('S2试穿内置皮肤_内嵌bundle缺失时message全文精确匹配', async () => {
  // A4 裁决：以 70c230d 的 skin-engine.js:145 原文为准，可断言全文
  const h = await started({ dropBundle: 'qq98' });
  await assert.rejects(
    h.skinRuntime.previewSkin('qq98'),
    (e) => e.code === undefined
      && e.message === '[theme-gallery-skin] unknown-skin: qq98 (no embedded bundle)'
      && e.message === runtimeUnknownSkin('qq98'),
  );
});

test('S2试穿内置皮肤_执行失败时body回滚到快照不留半成品', async () => {
  const h = await started({ failActivate: 'miku' });
  await assert.rejects(h.skinRuntime.previewSkin('miku'));
  assert.equal('data-half-applied' in h.dom.body.attrs, false);
  assert.deepEqual(h.dom.body.attrs, {});
});

test('S2试穿内置皮肤_执行失败时先跑完disposer再重抛', async () => {
  const h = await started({ failActivate: 'miku' });
  await assert.rejects(h.skinRuntime.previewSkin('miku'));
  assert.equal(h.dom.disposerRuns, 1);
});

test('S3应用内置皮肤_写skin-v1并清空custom-applied并写track', async () => {
  const h = await started({ seed: { [KEYS.SKIN_CUSTOM_APPLIED]: 'old' } });
  await h.skinRuntime.applySkin('trading');
  assert.equal(h.storage.read(KEYS.SKIN_BUILTIN), 'trading');
  assert.equal(h.storage.read(KEYS.SKIN_CUSTOM_APPLIED), '');
  assert.equal(h.storage.read(KEYS.TRACK), 'skin');
});

test('S3应用自定义皮肤_写custom-applied并清空skin-v1并写track', async () => {
  const h = await started({
    seed: { [KEYS.SKIN_CUSTOM]: skinRegistry(['navi']), [KEYS.SKIN_BUILTIN]: 'miku' },
  });
  await h.customSkinApi.applyCustomSkin('navi');
  assert.equal(h.storage.read(KEYS.SKIN_CUSTOM_APPLIED), 'navi');
  assert.equal(h.storage.read(KEYS.SKIN_BUILTIN), '');
  assert.equal(h.storage.read(KEYS.TRACK), 'skin');
});

test('S3应用皮肤_未知内置id抛ERR_UNKNOWN_ID', async () => {
  const h = await started();
  await assert.rejects(h.skinRuntime.applySkin('zzz'), code(ERR.UNKNOWN_ID));
});

test('S3应用皮肤_未知自定义id抛ERR_UNKNOWN_ID', async () => {
  const h = await started();
  await assert.rejects(h.customSkinApi.applyCustomSkin('zzz'), code(ERR.UNKNOWN_ID));
});

test('S3应用皮肤_失败时不写applied键也不写track键', async () => {
  const h = await started({ failActivate: 'miku' });
  const before = snap(h);
  await assert.rejects(h.skinRuntime.applySkin('miku'));
  assert.deepEqual(snap(h), before);
});

test('S4点卡片主体_自定义id走applyCustomSkin并写对应键', async () => {
  const h = await started({ seed: { [KEYS.SKIN_CUSTOM]: skinRegistry(['navi']) } });
  await h.customSkinApi.choose('navi');
  assert.equal(h.storage.read(KEYS.SKIN_CUSTOM_APPLIED), 'navi');
  assert.equal(h.storage.read(KEYS.SKIN_BUILTIN), '');
  assert.equal(h.dom.activeSkin, 'navi');
});

test('S4点卡片主体_内置id写skin-v1', async () => {
  const h = await started();
  await h.customSkinApi.choose('ths');
  assert.equal(h.storage.read(KEYS.SKIN_BUILTIN), 'ths');
  assert.equal(h.dom.activeSkin, 'ths');
});

test('S5恢复默认外观_卸载皮肤并清空三个键', async () => {
  const h = await started({
    seed: { [KEYS.SKIN_CUSTOM]: skinRegistry(['navi']), [KEYS.SKIN_CUSTOM_APPLIED]: 'navi' },
  });
  await tick();
  await h.skinRuntime.clearSkin();
  h.customSkinApi.restoreDefaultSkin();
  assert.equal(h.dom.activeSkin, null);
  assert.deepEqual(JSON.parse(h.storage.raw(KEYS.SKIN_CUSTOM)), { version: 1, items: [] });
  assert.equal(h.storage.read(KEYS.SKIN_CUSTOM_APPLIED), '');
  assert.equal(h.storage.read(KEYS.SKIN_BUILTIN), '');
});

test('S5恢复默认外观_写track为skin', async () => {
  const h = await started();
  h.customSkinApi.restoreDefaultSkin();
  assert.equal(h.storage.read(KEYS.TRACK), 'skin');
});

test('S5恢复默认外观_不动主题轨的任何键', async () => {
  const h = await started({ seed: { [KEYS.THEME_FAMILY]: 'azure', [KEYS.THEME_TOUCHED]: '1' } });
  h.customSkinApi.restoreDefaultSkin();
  assert.equal(h.storage.read(KEYS.THEME_FAMILY), 'azure');
  assert.equal(h.storage.read(KEYS.THEME_TOUCHED), '1');
});

test('S6设计助手_勾选版块后textarea内容变化', async () => {
  const h = await started();
  h.entry.openPanel();
  const before = h.entry.skinPanel.designSummary();
  h.entry.skinPanel.toggleSection(0);
  assert.notEqual(h.entry.skinPanel.designSummary(), before);
});

test('S6设计助手_取消勾选后内容回到原样', async () => {
  const h = await started();
  h.entry.openPanel();
  const before = h.entry.skinPanel.designSummary();
  h.entry.skinPanel.toggleSection(3);
  h.entry.skinPanel.toggleSection(3);
  assert.equal(h.entry.skinPanel.designSummary(), before);
});

test('S6设计助手_版块数量恰好11', async () => {
  const h = await started();
  h.entry.openPanel();
  assert.equal(h.entry.skinPanel.sectionCount, 11);
});

test('S6设计助手_全程不读写storage', async () => {
  const h = await started();
  h.entry.openPanel();
  h.storage.resetStats();
  for (let i = 0; i < 11; i += 1) h.entry.skinPanel.toggleSection(i);
  h.entry.skinPanel.designSummary();
  assert.deepEqual(
    { set: h.storage.stats.set, remove: h.storage.stats.remove },
    { set: 0, remove: 0 },
  );
});

test('S6设计助手_仓库路径已更新为appearance-gallery', async () => {
  const h = await started();
  h.entry.openPanel();
  const text = h.entry.skinPanel.designSummary();
  assert.ok(text.includes('packages/dsh-appearance-gallery/skins/'), '缺新仓库路径');
  assert.equal(text.includes('packages/skin-gallery/skins/'), false, '仍残留旧仓库路径');
});

test('S6设计助手_验收命令已更新为dsh-appearance-gallery', async () => {
  const h = await started();
  h.entry.openPanel();
  const text = h.entry.skinPanel.designSummary();
  assert.ok(text.includes('pnpm --filter dsh-appearance-gallery'), '缺新验收命令');
  assert.equal(text.includes('pnpm --filter dsh-skin-gallery'), false, '仍残留旧验收命令');
});

test('S8删除皮肤_从registry移除', async () => {
  const h = await started({ seed: { [KEYS.SKIN_CUSTOM]: skinRegistry(['a', 'b']) } });
  h.customSkinApi.deleteCustomSkin('a');
  assert.deepEqual(h.customSkinApi.getSkins().map((s) => s.id), ['b']);
});

test('S8删除皮肤_删掉正在应用的项时清三个键并卸载皮肤', async () => {
  const h = await started({
    seed: { [KEYS.SKIN_CUSTOM]: skinRegistry(['a']), [KEYS.SKIN_CUSTOM_APPLIED]: 'a' },
  });
  await tick();
  h.customSkinApi.deleteCustomSkin('a');
  assert.equal(h.storage.read(KEYS.SKIN_CUSTOM_APPLIED), '');
  assert.equal(h.storage.read(KEYS.SKIN_BUILTIN), '');
  assert.equal(h.storage.read(KEYS.TRACK), 'skin');
  assert.equal(h.dom.activeSkin, null);
});

test('S8删除皮肤_删非应用项时不动applied键', async () => {
  const h = await started({
    seed: { [KEYS.SKIN_CUSTOM]: skinRegistry(['a', 'b']), [KEYS.SKIN_CUSTOM_APPLIED]: 'b' },
  });
  h.customSkinApi.deleteCustomSkin('a');
  assert.equal(h.storage.read(KEYS.SKIN_CUSTOM_APPLIED), 'b');
});

test('S8删除皮肤_传内置id时静默no-op且storage不变', async () => {
  const h = await started({ seed: { [KEYS.SKIN_CUSTOM]: skinRegistry(['a']) } });
  const before = snap(h);
  assert.doesNotThrow(() => h.customSkinApi.deleteCustomSkin('miku'));
  assert.deepEqual(snap(h), before);
});

test('S8删除皮肤_传不存在id时静默no-op且storage不变', async () => {
  const h = await started({ seed: { [KEYS.SKIN_CUSTOM]: skinRegistry(['a']) } });
  const before = snap(h);
  assert.doesNotThrow(() => h.customSkinApi.deleteCustomSkin('zzz'));
  assert.deepEqual(snap(h), before);
});

test('S8删除皮肤_勾选多项时逐个删除全部生效', async () => {
  const h = await started({ seed: { [KEYS.SKIN_CUSTOM]: skinRegistry(['a', 'b', 'c']) } });
  for (const id of ['a', 'c']) h.customSkinApi.deleteCustomSkin(id);
  assert.deepEqual(h.customSkinApi.getSkins().map((s) => s.id), ['b']);
});
