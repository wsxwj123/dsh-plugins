// INTERFACE §3.5 轨道键 dsh-appearance-track-v1 的软互斥语义
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSubject } from './helpers/subject.mjs';
import { KEYS } from './helpers/contract.mjs';
import { themeRegistry, skinRegistry } from './helpers/fixtures.mjs';

const FULL = { services: { theme: {}, slots: {} } };
const started = async (opts = {}) => { const h = await createSubject(opts); h.start(FULL); return h; };
const tick = () => new Promise((r) => setImmediate(r));

// ---------------- 值域 ----------------
test('track值域_theme是合法值', async () => {
  const h = await started({ seed: { [KEYS.TRACK]: 'theme' } });
  assert.equal(h.readTrack(), 'theme');
});

test('track值域_skin是合法值', async () => {
  const h = await started({ seed: { [KEYS.TRACK]: 'skin' } });
  assert.equal(h.readTrack(), 'skin');
});

test('track值域_非法值读作空串', async () => {
  const h = await started({ seed: { [KEYS.TRACK]: 'both' } });
  assert.equal(h.readTrack(), '');
});

test('track值域_大写THEME读作空串', async () => {
  const h = await started({ seed: { [KEYS.TRACK]: 'THEME' } });
  assert.equal(h.readTrack(), '');
});

test('track值域_JSON对象读作空串', async () => {
  const h = await started({ seed: { [KEYS.TRACK]: '{"track":"theme"}' } });
  assert.equal(h.readTrack(), '');
});

test('track值域_键不存在时读作空串', async () => {
  const h = await started();
  assert.equal(h.readTrack(), '');
});

test('track写空串_走removeItem而不是写空值', async () => {
  const h = await started({ seed: { [KEYS.TRACK]: 'theme' } });
  h.surface.writeStored(KEYS.TRACK, '');
  assert.equal(h.storage.raw(KEYS.TRACK), null);
});

// ---------------- 写 'theme' 的时机 ----------------
test('写theme_应用内置主题时写入', async () => {
  const h = await started({ seed: { [KEYS.TRACK]: 'skin' } });
  h.themeApi.activateFamily('horizon');
  assert.equal(h.readTrack(), 'theme');
});

test('写theme_应用自定义主题时写入', async () => {
  const h = await started({ seed: { [KEYS.TRACK]: 'skin', [KEYS.THEME_CUSTOM]: themeRegistry(['m']) } });
  h.themeApi.applyCustomTheme('m');
  assert.equal(h.readTrack(), 'theme');
});

test('写theme_删掉正在应用的自定义主题时写入', async () => {
  const h = await started({
    seed: { [KEYS.TRACK]: 'skin', [KEYS.THEME_CUSTOM]: themeRegistry(['m']), [KEYS.THEME_CUSTOM_APPLIED]: 'm' },
  });
  h.themeApi.deleteCustomTheme('m');
  assert.equal(h.readTrack(), 'theme');
});

test('写theme_恢复默认主题时写入', async () => {
  const h = await started({ seed: { [KEYS.TRACK]: 'skin' } });
  h.themeApi.restoreDefaultTheme();
  assert.equal(h.readTrack(), 'theme');
});

// ---------------- 写 'skin' 的时机 ----------------
test('写skin_应用内置皮肤时写入', async () => {
  const h = await started({ seed: { [KEYS.TRACK]: 'theme' } });
  await h.skinRuntime.applySkin('minecraft');
  assert.equal(h.readTrack(), 'skin');
});

test('写skin_应用自定义皮肤时写入', async () => {
  const h = await started({ seed: { [KEYS.TRACK]: 'theme', [KEYS.SKIN_CUSTOM]: skinRegistry(['s'] ) } });
  await h.customSkinApi.applyCustomSkin('s');
  assert.equal(h.readTrack(), 'skin');
});

test('写skin_删掉正在应用的自定义皮肤时写入', async () => {
  const h = await started({
    seed: { [KEYS.TRACK]: 'theme', [KEYS.SKIN_CUSTOM]: skinRegistry(['s']), [KEYS.SKIN_CUSTOM_APPLIED]: 's' },
  });
  await tick();
  h.customSkinApi.deleteCustomSkin('s');
  assert.equal(h.readTrack(), 'skin');
});

test('写skin_恢复默认外观时写入', async () => {
  const h = await started({ seed: { [KEYS.TRACK]: 'theme' } });
  h.customSkinApi.restoreDefaultSkin();
  assert.equal(h.readTrack(), 'skin');
});

// ---------------- preview 刻意不写键 ----------------
test('不写track_试穿自定义主题时不写', async () => {
  const h = await started({ seed: { [KEYS.TRACK]: 'skin', [KEYS.THEME_CUSTOM]: themeRegistry(['m']) } });
  h.themeApi.previewCustomTheme('m');
  assert.equal(h.readTrack(), 'skin');
});

test('不写track_试穿内置皮肤时不写', async () => {
  const h = await started({ seed: { [KEYS.TRACK]: 'theme' } });
  await h.skinRuntime.previewSkin('whale-song');
  assert.equal(h.readTrack(), 'theme');
});

test('不写track_试穿自定义皮肤时不写', async () => {
  const h = await started({ seed: { [KEYS.TRACK]: 'theme', [KEYS.SKIN_CUSTOM]: skinRegistry(['s']) } });
  await h.customSkinApi.previewCustomSkin('s');
  assert.equal(h.readTrack(), 'theme');
});

test('不写track_键原本不存在时试穿也不会创建它', async () => {
  const h = await started();
  await h.skinRuntime.previewSkin('miku');
  assert.equal(h.storage.raw(KEYS.TRACK), null);
});

// ---------------- 软互斥：不抢占、不卸载对侧 ----------------
test('软互斥_启动恢复不写track键', async () => {
  const h = await createSubject({ seed: { [KEYS.TRACK]: 'skin', [KEYS.SKIN_BUILTIN]: 'miku' } });
  h.start(FULL);
  await tick();
  assert.equal(h.storage.raw(KEYS.TRACK), 'skin');
});

test('软互斥_对侧skin已激活时启动恢复主题不覆盖track', async () => {
  const h = await createSubject({
    seed: { [KEYS.TRACK]: 'skin', [KEYS.SKIN_BUILTIN]: 'xp', [KEYS.THEME_FAMILY]: 'azure' },
  });
  h.start(FULL);
  await tick();
  assert.equal(h.readTrack(), 'skin');
});

test('软互斥_应用主题不卸载正在生效的皮肤', async () => {
  const h = await started({ seed: { [KEYS.SKIN_BUILTIN]: 'xp', [KEYS.TRACK]: 'skin' } });
  await tick();
  h.themeApi.activateFamily('azure');
  assert.equal(h.dom.activeSkin, 'xp', '§3.5 是软互斥：不因写 track 就卸载对侧');
});

test('软互斥_应用皮肤不清空主题轨的键', async () => {
  const h = await started({ seed: { [KEYS.THEME_FAMILY]: 'azure', [KEYS.THEME_TOUCHED]: '1' } });
  await h.skinRuntime.applySkin('xp');
  assert.equal(h.storage.read(KEYS.THEME_FAMILY), 'azure');
  assert.equal(h.storage.read(KEYS.THEME_TOUCHED), '1');
});

test('软互斥_应用主题不清空皮肤轨的键', async () => {
  const h = await started({ seed: { [KEYS.SKIN_BUILTIN]: 'xp' } });
  await tick();
  h.themeApi.activateFamily('azure');
  assert.equal(h.storage.read(KEYS.SKIN_BUILTIN), 'xp');
});

test('软互斥_track值与实际生效外观不一致时不做纠正写入', async () => {
  // track 说 theme，但实际生效的是皮肤 —— 读到不一致不许"顺手改正"
  const h = await createSubject({ seed: { [KEYS.TRACK]: 'theme', [KEYS.SKIN_BUILTIN]: 'ths' } });
  h.start(FULL);
  await tick();
  assert.equal(h.storage.raw(KEYS.TRACK), 'theme');
  assert.equal(h.dom.activeSkin, 'ths');
});
