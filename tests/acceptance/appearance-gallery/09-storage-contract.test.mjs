// INTERFACE §3.4 storage 键沿用与老用户兼容 + §3.8 第 5/6 条（storage 不可用 / registry 损坏）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSubject } from './helpers/subject.mjs';
import { KEYS, ALL_KEYS, KEY_PREFIXES, JADE_LABEL } from './helpers/contract.mjs';
import { themeJson, themeRegistry, skinRegistry, skinParts } from './helpers/fixtures.mjs';

const FULL = { services: { theme: {}, slots: {} } };
const started = async (opts = {}) => { const h = await createSubject(opts); h.start(FULL); return h; };
const tick = () => new Promise((r) => setImmediate(r));

/** 老用户升级前的完整 8 键现场 */
const LEGACY_STATE = {
  [KEYS.TRACK]: 'skin',
  [KEYS.THEME_FAMILY]: '',
  [KEYS.THEME_CUSTOM]: themeRegistry(['mytheme']),
  [KEYS.THEME_CUSTOM_APPLIED]: 'mytheme',
  [KEYS.THEME_TOUCHED]: '1',
  [KEYS.SKIN_CUSTOM]: skinRegistry(['myskin']),
  [KEYS.SKIN_CUSTOM_APPLIED]: 'myskin',
  [KEYS.SKIN_BUILTIN]: '',
};

test('键名清单_恰好是INTERFACE列的8个键一字不差', async () => {
  assert.deepEqual([...ALL_KEYS].sort(), [
    'dsh-appearance-track-v1',
    'skin-gallery-custom-applied-v1',
    'skin-gallery-custom-v1',
    'skin-gallery-skin-v1',
    'theme-gallery-custom-applied-v1',
    'theme-gallery-custom-touched-v1',
    'theme-gallery-custom-v1',
    'theme-gallery-family-v5',
  ]);
});

test('迁移_老用户8键已有值时首次加载一个键都不改写', async () => {
  const h = await started({ seed: { ...LEGACY_STATE } });
  await tick();
  assert.deepEqual(h.storage.snapshot(), LEGACY_STATE);
});

test('迁移_老用户首次加载不新增任何键', async () => {
  const h = await started({ seed: { ...LEGACY_STATE } });
  await tick();
  assert.deepEqual([...h.storage.keys()].sort(), [...ALL_KEYS].sort());
});

test('迁移_老用户已导入的自定义主题仍在列表里', async () => {
  const h = await started({ seed: { ...LEGACY_STATE } });
  assert.equal(h.themeApi.getCustomThemes().some((t) => t.id === 'mytheme'), true);
});

test('迁移_老用户已导入的自定义皮肤仍在列表里', async () => {
  const h = await started({ seed: { ...LEGACY_STATE } });
  assert.equal(h.customSkinApi.getSkins().some((s) => s.id === 'myskin'), true);
});

test('迁移_老用户当前应用的自定义皮肤升级后仍生效', async () => {
  const h = await started({ seed: { ...LEGACY_STATE } });
  await tick();
  assert.equal(h.dom.activeSkin, 'myskin');
});

test('迁移_老用户全新安装无任何键时不报错且回落jade', async () => {
  const h = await started();
  assert.equal(h.effectiveAppearance().label, JADE_LABEL);
  assert.deepEqual(h.storage.keys(), []);
});

test('越权写入_跑完整流程后不出现8个键以外的相关前缀新键', async () => {
  const h = await started();
  await h.themeApi.importCustomTheme(themeJson({ id: 'flow' }));
  h.themeApi.applyCustomTheme('flow');
  h.themeApi.activateFamily('azure');
  await h.customSkinApi.importCustomSkin(skinParts({ id: 'fskin', meta: { id: 'fskin' } }));
  await h.customSkinApi.applyCustomSkin('fskin');
  await h.skinRuntime.applySkin('miku');
  h.customSkinApi.deleteCustomSkin('fskin');
  h.themeApi.deleteCustomTheme('flow');
  h.themeApi.restoreDefaultTheme();
  h.customSkinApi.restoreDefaultSkin();
  const strays = h.storage.keys().filter((k) => !ALL_KEYS.includes(k) && KEY_PREFIXES.some((p) => k.startsWith(p)));
  assert.deepEqual(strays, []);
});

test('越权写入_跑完整流程后总键数不超过8', async () => {
  const h = await started();
  await h.themeApi.importCustomTheme(themeJson({ id: 'flow' }));
  h.themeApi.applyCustomTheme('flow');
  await h.skinRuntime.applySkin('ths');
  assert.ok(h.storage.keys().length <= 8, `多写了键：${h.storage.keys().join(',')}`);
});

// ---------------- §3.8 第 5 条：storage 不可用 ----------------
test('storage不可用_getItem抛异常时启动不报错', async () => {
  const h = await createSubject();
  h.storage.fail('get');
  assert.doesNotThrow(() => h.start(FULL));
});

test('storage不可用_getItem抛异常时读回落到jade', async () => {
  const h = await createSubject();
  h.storage.fail('get');
  h.start(FULL);
  assert.equal(h.effectiveAppearance().id, 'jade');
});

test('storage不可用_setItem抛异常时应用内置主题不报错', async () => {
  const h = await started();
  h.storage.fail('set');
  assert.doesNotThrow(() => h.themeApi.activateFamily('ember'));
});

test('storage不可用_setItem抛异常时主题仍在页面上生效', async () => {
  const h = await started();
  h.storage.fail('set');
  h.themeApi.activateFamily('ember');
  assert.equal(h.dom.tokens.themeId, 'ember');
});

test('storage不可用_setItem抛异常时导入主题不报错只是不持久化', async () => {
  const h = await started();
  h.storage.fail('set');
  const r = await h.themeApi.importCustomTheme(themeJson({ id: 'ghost' }));
  assert.equal(r.id, 'ghost');
});

test('storage不可用_setItem抛异常时应用皮肤不报错', async () => {
  const h = await started();
  h.storage.fail('set');
  await assert.doesNotReject(h.skinRuntime.applySkin('xp'));
  assert.equal(h.dom.activeSkin, 'xp');
});

test('storage不可用_removeItem抛异常时恢复默认主题不报错', async () => {
  const h = await started({ seed: { [KEYS.THEME_TOUCHED]: '1' } });
  h.storage.fail('set');
  assert.doesNotThrow(() => h.themeApi.restoreDefaultTheme());
});

test('storage不可用_全面失效时插件停止也不报错', async () => {
  const h = await createSubject();
  const r = h.start(FULL);
  h.storage.fail('all');
  assert.doesNotThrow(() => r.dispose());
});

// ---------------- §3.8 第 6 条：registry 损坏 ----------------
test('registry损坏_皮肤registry不是JSON时读作空列表', async () => {
  const h = await started({ seed: { [KEYS.SKIN_CUSTOM]: '这不是 json' } });
  assert.deepEqual(h.customSkinApi.getSkins(), []);
});

test('registry损坏_皮肤registry不是JSON时不抛错', async () => {
  const h = await createSubject({ seed: { [KEYS.SKIN_CUSTOM]: '{{{' } });
  assert.doesNotThrow(() => h.start(FULL));
});

test('registry损坏_不主动removeItem用户数据', async () => {
  const h = await started({ seed: { [KEYS.SKIN_CUSTOM]: '半个 json {' } });
  h.customSkinApi.getSkins();
  assert.equal(h.storage.raw(KEYS.SKIN_CUSTOM), '半个 json {');
});

test('registry损坏_主题registry不是JSON时读作空列表', async () => {
  const h = await started({ seed: { [KEYS.THEME_CUSTOM]: 'oops' } });
  assert.deepEqual(h.themeApi.getCustomThemes(), []);
});

test('registry损坏_主题registry损坏且applied悬空时生效外观回落jade', async () => {
  const h = await started({ seed: { [KEYS.THEME_CUSTOM]: 'oops', [KEYS.THEME_CUSTOM_APPLIED]: 'mine' } });
  assert.equal(h.effectiveAppearance().id, 'jade');
});

test('registry损坏_合法JSON但items不是数组时读作空列表', async () => {
  const h = await started({ seed: { [KEYS.SKIN_CUSTOM]: '{"version":1,"items":"nope"}' } });
  assert.deepEqual(h.customSkinApi.getSkins(), []);
});

test('registry损坏_合法JSON但是数组时读作空列表', async () => {
  const h = await started({ seed: { [KEYS.THEME_CUSTOM]: '[1,2,3]' } });
  assert.deepEqual(h.themeApi.getCustomThemes(), []);
});

test('registry损坏_applied皮肤悬空时启动不激活任何皮肤也不抛错', async () => {
  const h = await createSubject({ seed: { [KEYS.SKIN_CUSTOM]: 'broken', [KEYS.SKIN_CUSTOM_APPLIED]: 'gone' } });
  assert.doesNotThrow(() => h.start(FULL));
  await tick();
  assert.equal(h.dom.activeSkin, null);
});

test('registry损坏_损坏后仍能成功导入新项并覆盖成合法registry', async () => {
  const h = await started({ seed: { [KEYS.THEME_CUSTOM]: 'broken' } });
  await h.themeApi.importCustomTheme(themeJson({ id: 'fresh' }));
  assert.deepEqual(h.themeApi.getCustomThemes().map((t) => t.id), ['fresh']);
});
