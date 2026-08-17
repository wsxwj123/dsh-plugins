// INTERFACE §3.3 主题段 T1–T7
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSubject } from './helpers/subject.mjs';
import { KEYS, ALL_KEYS, SEARCH_INPUT_MAX, JADE_LABEL } from './helpers/contract.mjs';
import { textOf } from './helpers/fake-react.mjs';
import { themeJson, themeRegistry } from './helpers/fixtures.mjs';

const FULL = { services: { theme: {}, slots: {} } };
const started = async (opts = {}) => { const h = await createSubject(opts); h.start(FULL); return h; };
const snap = (h) => ALL_KEYS.map((k) => h.storage.raw(k));

test('T1搜索_空关键词时计数为15分之15', async () => {
  const h = await started();
  h.entry.openPanel();
  assert.ok(textOf(h.entry.render()).includes('15/15'));
});

test('T1搜索_按label命中时计数收敛到1', async () => {
  const h = await started();
  h.entry.openPanel();
  h.entry.themePanel.setSearch(JADE_LABEL);
  assert.ok(textOf(h.entry.render()).includes('1/15'));
});

test('T1搜索_按id小写包含命中', async () => {
  const h = await started();
  h.entry.openPanel();
  h.entry.themePanel.setSearch('TERRA');
  assert.ok(textOf(h.entry.render()).includes('1/15'));
});

test('T1搜索_无命中时计数为0分之15且不抛错', async () => {
  const h = await started();
  h.entry.openPanel();
  h.entry.themePanel.setSearch('不存在的主题名');
  assert.ok(textOf(h.entry.render()).includes('0/15'));
});

test('T1搜索_输入65字符被截断为64', async () => {
  const h = await started();
  h.entry.openPanel();
  h.entry.themePanel.setSearch('x'.repeat(65));
  assert.equal(h.entry.themePanel.state.search.length, SEARCH_INPUT_MAX);
});

test('T2应用内置主题_写入四个键的确切值', async () => {
  const h = await started();
  h.themeApi.activateFamily('ember');
  assert.equal(h.storage.read(KEYS.THEME_FAMILY), 'ember');
  assert.equal(h.storage.read(KEYS.THEME_CUSTOM_APPLIED), '');
  assert.equal(h.storage.read(KEYS.THEME_TOUCHED), '1');
  assert.equal(h.storage.read(KEYS.TRACK), 'theme');
});

test('T2应用内置主题_未知id静默no-op且storage一个键都不变', async () => {
  const h = await started();
  const before = snap(h);
  assert.doesNotThrow(() => h.themeApi.activateFamily('no-such-family'));
  assert.deepEqual(snap(h), before);
});

test('T2应用内置主题_空字符串id静默no-op', async () => {
  const h = await started();
  const before = snap(h);
  h.themeApi.activateFamily('');
  assert.deepEqual(snap(h), before);
});

test('T3导入主题_成功后registry含该项', async () => {
  const h = await started();
  await h.themeApi.importCustomTheme(themeJson({ id: 'mine', label: '我的' }));
  assert.deepEqual(h.themeApi.getCustomThemes().map((t) => t.id), ['mine']);
});

test('T3导入主题_成功后registry是version1的items形态', async () => {
  const h = await started();
  await h.themeApi.importCustomTheme(themeJson());
  const raw = JSON.parse(h.storage.raw(KEYS.THEME_CUSTOM));
  assert.equal(raw.version, 1);
  assert.equal(Array.isArray(raw.items), true);
});

test('T3导入主题_成功后不写applied键', async () => {
  const h = await started();
  await h.themeApi.importCustomTheme(themeJson());
  assert.equal(h.storage.read(KEYS.THEME_CUSTOM_APPLIED), '');
});

test('T3导入主题_成功后不改变当前生效外观', async () => {
  const h = await started({ seed: { [KEYS.THEME_FAMILY]: 'azure' } });
  const before = h.effectiveAppearance();
  await h.themeApi.importCustomTheme(themeJson());
  assert.deepEqual(h.effectiveAppearance(), before);
});

test('T3导入主题_同id重复导入是覆盖且保留原位', async () => {
  const h = await started();
  await h.themeApi.importCustomTheme(themeJson({ id: 'a', label: 'A' }));
  await h.themeApi.importCustomTheme(themeJson({ id: 'b', label: 'B' }));
  await h.themeApi.importCustomTheme(themeJson({ id: 'a', label: 'A2' }));
  const items = h.themeApi.getCustomThemes();
  assert.deepEqual(items.map((t) => t.id), ['a', 'b']);
  assert.equal(items[0].label, 'A2');
});

test('T4试穿主题_只注入tokens不写任何storage键', async () => {
  const h = await started({ seed: { [KEYS.THEME_CUSTOM]: themeRegistry(['mine']) } });
  const before = snap(h);
  h.themeApi.previewCustomTheme('mine');
  assert.equal(h.dom.tokens.themeId, 'mine');
  assert.deepEqual(snap(h), before);
});

test('T4试穿主题_未知id抛ERR_UNKNOWN_ID', async () => {
  const h = await started();
  assert.throws(() => h.themeApi.previewCustomTheme('nope'), (e) => e.code === 'ERR_UNKNOWN_ID');
});

test('T4试穿主题_未知id时不注入tokens也不写键', async () => {
  const h = await started({ seed: { [KEYS.THEME_FAMILY]: 'azure' } });
  const before = snap(h);
  const tokensBefore = h.dom.tokens.themeId;
  try { h.themeApi.previewCustomTheme('nope'); } catch { /* 已在上一条断言 */ }
  assert.equal(h.dom.tokens.themeId, tokensBefore);
  assert.deepEqual(snap(h), before);
});

test('T5应用自定义主题_写入四个键的确切值', async () => {
  const h = await started({ seed: { [KEYS.THEME_CUSTOM]: themeRegistry(['mine']) } });
  h.themeApi.applyCustomTheme('mine');
  assert.equal(h.storage.read(KEYS.THEME_CUSTOM_APPLIED), 'mine');
  assert.equal(h.storage.read(KEYS.THEME_FAMILY), '');
  assert.equal(h.storage.read(KEYS.THEME_TOUCHED), '1');
  assert.equal(h.storage.read(KEYS.TRACK), 'theme');
});

test('T5应用自定义主题_未知id抛ERR_UNKNOWN_ID且storage不变', async () => {
  const h = await started();
  const before = snap(h);
  assert.throws(() => h.themeApi.applyCustomTheme('nope'), (e) => e.code === 'ERR_UNKNOWN_ID');
  assert.deepEqual(snap(h), before);
});

test('T6删除自定义主题_从registry移除', async () => {
  const h = await started({ seed: { [KEYS.THEME_CUSTOM]: themeRegistry(['a', 'b']) } });
  h.themeApi.deleteCustomTheme('a');
  assert.deepEqual(h.themeApi.getCustomThemes().map((t) => t.id), ['b']);
});

test('T6删除自定义主题_删掉正在应用的项时回落jade并写四个键', async () => {
  const h = await started({
    seed: { [KEYS.THEME_CUSTOM]: themeRegistry(['a']), [KEYS.THEME_CUSTOM_APPLIED]: 'a' },
  });
  h.themeApi.deleteCustomTheme('a');
  assert.equal(h.storage.read(KEYS.THEME_CUSTOM_APPLIED), '');
  assert.equal(h.storage.read(KEYS.THEME_FAMILY), 'jade');
  assert.equal(h.storage.read(KEYS.THEME_TOUCHED), '1');
  assert.equal(h.storage.read(KEYS.TRACK), 'theme');
  assert.equal(h.dom.tokens.themeId, 'jade');
});

test('T6删除自定义主题_删非应用项时不动applied键', async () => {
  const h = await started({
    seed: { [KEYS.THEME_CUSTOM]: themeRegistry(['a', 'b']), [KEYS.THEME_CUSTOM_APPLIED]: 'b' },
  });
  h.themeApi.deleteCustomTheme('a');
  assert.equal(h.storage.read(KEYS.THEME_CUSTOM_APPLIED), 'b');
});

test('T6删除自定义主题_传内置id时静默no-op且storage不变', async () => {
  const h = await started({ seed: { [KEYS.THEME_CUSTOM]: themeRegistry(['a']) } });
  const before = snap(h);
  assert.doesNotThrow(() => h.themeApi.deleteCustomTheme('jade'));
  assert.deepEqual(snap(h), before);
});

test('T6删除自定义主题_传不存在id时静默no-op且storage不变', async () => {
  const h = await started({ seed: { [KEYS.THEME_CUSTOM]: themeRegistry(['a']) } });
  const before = snap(h);
  assert.doesNotThrow(() => h.themeApi.deleteCustomTheme('zzz'));
  assert.deepEqual(snap(h), before);
});

test('T7恢复默认主题_registry被清成空items', async () => {
  const h = await started({ seed: { [KEYS.THEME_CUSTOM]: themeRegistry(['a', 'b']) } });
  h.themeApi.restoreDefaultTheme();
  assert.deepEqual(JSON.parse(h.storage.raw(KEYS.THEME_CUSTOM)), { version: 1, items: [] });
});

test('T7恢复默认主题_family写jade且applied清空', async () => {
  const h = await started({ seed: { [KEYS.THEME_CUSTOM_APPLIED]: 'a', [KEYS.THEME_CUSTOM]: themeRegistry(['a']) } });
  h.themeApi.restoreDefaultTheme();
  assert.equal(h.storage.read(KEYS.THEME_FAMILY), 'jade');
  assert.equal(h.storage.read(KEYS.THEME_CUSTOM_APPLIED), '');
});

test('T7恢复默认主题_touched键是removeItem而不是写空串', async () => {
  const h = await started({ seed: { [KEYS.THEME_TOUCHED]: '1' } });
  h.themeApi.restoreDefaultTheme();
  assert.equal(h.storage.raw(KEYS.THEME_TOUCHED), null);
});

test('T7恢复默认主题_track写theme并重绘jade', async () => {
  const h = await started();
  h.themeApi.restoreDefaultTheme();
  assert.equal(h.storage.read(KEYS.TRACK), 'theme');
  assert.equal(h.dom.tokens.themeId, 'jade');
});
