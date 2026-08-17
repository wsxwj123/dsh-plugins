// INTERFACE §3.6 自定义主题 JSON 导入契约（校验顺序 / 边界 / 错误码 / 不改状态）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSubject } from './helpers/subject.mjs';
import { ERR, KEYS, ALL_KEYS, BUILTIN_THEME_IDS, STYLE_MARK } from './helpers/contract.mjs';
import { themeJson } from './helpers/fixtures.mjs';

const FULL = { services: { theme: {}, slots: {} } };
const started = async (opts = {}) => { const h = await createSubject(opts); h.start(FULL); return h; };
const code = (c) => (e) => e.code === c;
const okToken = { '--dsw-bg': { light: '#fff', dark: '#000' } };

// ---------------- 校验顺序 1–2：JSON 本身 ----------------
test('导入主题_非JSON文本抛ERR_IMPORT_INVALID_JSON', async () => {
  const h = await started();
  await assert.rejects(h.themeApi.importCustomTheme('这不是 json'), code(ERR.IMPORT_INVALID_JSON));
});

test('导入主题_空字符串抛ERR_IMPORT_INVALID_JSON', async () => {
  const h = await started();
  await assert.rejects(h.themeApi.importCustomTheme(''), code(ERR.IMPORT_INVALID_JSON));
});

test('导入主题_JSON数组抛ERR_IMPORT_INVALID_JSON', async () => {
  const h = await started();
  await assert.rejects(h.themeApi.importCustomTheme('[]'), code(ERR.IMPORT_INVALID_JSON));
});

test('导入主题_JSON字面量null抛ERR_IMPORT_INVALID_JSON', async () => {
  const h = await started();
  await assert.rejects(h.themeApi.importCustomTheme('null'), code(ERR.IMPORT_INVALID_JSON));
});

test('导入主题_JSON数字抛ERR_IMPORT_INVALID_JSON', async () => {
  const h = await started();
  await assert.rejects(h.themeApi.importCustomTheme('42'), code(ERR.IMPORT_INVALID_JSON));
});

test('导入主题_只有半个对象的截断JSON抛ERR_IMPORT_INVALID_JSON', async () => {
  const h = await started();
  await assert.rejects(h.themeApi.importCustomTheme('{"id":"a","label":'), code(ERR.IMPORT_INVALID_JSON));
});

// ---------------- 校验顺序 3：必填字段 ----------------
test('导入主题_缺id抛ERR_THEME_MISSING_FIELD', async () => {
  const h = await started();
  await assert.rejects(
    h.themeApi.importCustomTheme(JSON.stringify({ label: 'x', tokens: okToken })),
    code(ERR.THEME_MISSING_FIELD),
  );
});

test('导入主题_缺label抛ERR_THEME_MISSING_FIELD', async () => {
  const h = await started();
  await assert.rejects(
    h.themeApi.importCustomTheme(JSON.stringify({ id: 'a', tokens: okToken })),
    code(ERR.THEME_MISSING_FIELD),
  );
});

test('导入主题_缺tokens抛ERR_THEME_MISSING_FIELD', async () => {
  const h = await started();
  await assert.rejects(
    h.themeApi.importCustomTheme(JSON.stringify({ id: 'a', label: 'x' })),
    code(ERR.THEME_MISSING_FIELD),
  );
});

test('导入主题_tokens是空对象抛ERR_THEME_MISSING_FIELD', async () => {
  const h = await started();
  await assert.rejects(h.themeApi.importCustomTheme(themeJson({ tokens: {} })), code(ERR.THEME_MISSING_FIELD));
});

test('导入主题_id是空字符串抛ERR_THEME_MISSING_FIELD', async () => {
  const h = await started();
  await assert.rejects(h.themeApi.importCustomTheme(themeJson({ id: '' })), code(ERR.THEME_MISSING_FIELD));
});

test('导入主题_id是数字类型抛ERR_THEME_MISSING_FIELD', async () => {
  const h = await started();
  await assert.rejects(h.themeApi.importCustomTheme(themeJson({ id: 123 })), code(ERR.THEME_MISSING_FIELD));
});

test('导入主题_label是空字符串抛ERR_THEME_MISSING_FIELD', async () => {
  const h = await started();
  await assert.rejects(h.themeApi.importCustomTheme(themeJson({ label: '' })), code(ERR.THEME_MISSING_FIELD));
});

test('导入主题_tokens是非空数组抛ERR_THEME_MISSING_FIELD', async () => {
  // A3 裁决：数组一律按"缺字段"处理（第 3 步），不落第 7 步的 BAD_TOKEN
  const h = await started();
  await assert.rejects(
    h.themeApi.importCustomTheme(themeJson({ tokens: [{ '--dsw-bg': { light: '#1', dark: '#2' } }] })),
    code(ERR.THEME_MISSING_FIELD),
  );
});

test('导入主题_tokens是空数组抛ERR_THEME_MISSING_FIELD', async () => {
  const h = await started();
  await assert.rejects(h.themeApi.importCustomTheme(themeJson({ tokens: [] })), code(ERR.THEME_MISSING_FIELD));
});

// ---------------- 校验顺序 4：id 正则 ----------------
test('导入主题_id含大写字母抛ERR_THEME_MISSING_FIELD', async () => {
  const h = await started();
  await assert.rejects(h.themeApi.importCustomTheme(themeJson({ id: 'Mine' })), code(ERR.THEME_MISSING_FIELD));
});

test('导入主题_id以连字符开头抛ERR_THEME_MISSING_FIELD', async () => {
  const h = await started();
  await assert.rejects(h.themeApi.importCustomTheme(themeJson({ id: '-mine' })), code(ERR.THEME_MISSING_FIELD));
});

test('导入主题_id含空格抛ERR_THEME_MISSING_FIELD', async () => {
  const h = await started();
  await assert.rejects(h.themeApi.importCustomTheme(themeJson({ id: 'my theme' })), code(ERR.THEME_MISSING_FIELD));
});

test('导入主题_id是中文抛ERR_THEME_MISSING_FIELD', async () => {
  const h = await started();
  await assert.rejects(h.themeApi.importCustomTheme(themeJson({ id: '我的主题' })), code(ERR.THEME_MISSING_FIELD));
});

test('导入主题_id是emoji抛ERR_THEME_MISSING_FIELD', async () => {
  const h = await started();
  await assert.rejects(h.themeApi.importCustomTheme(themeJson({ id: '🎨' })), code(ERR.THEME_MISSING_FIELD));
});

test('导入主题_id长度64是上边界应通过', async () => {
  const h = await started();
  const id = `a${'b'.repeat(63)}`;
  const r = await h.themeApi.importCustomTheme(themeJson({ id }));
  assert.equal(r.id, id);
});

test('导入主题_id长度65越界抛ERR_THEME_MISSING_FIELD', async () => {
  const h = await started();
  await assert.rejects(
    h.themeApi.importCustomTheme(themeJson({ id: `a${'b'.repeat(64)}` })),
    code(ERR.THEME_MISSING_FIELD),
  );
});

test('导入主题_id长度1是下边界应通过', async () => {
  const h = await started();
  const r = await h.themeApi.importCustomTheme(themeJson({ id: 'x' }));
  assert.equal(r.id, 'x');
});

// ---------------- 校验顺序 5：label 长度 ----------------
test('导入主题_label长度80是上边界应通过', async () => {
  const h = await started();
  const label = '字'.repeat(80);
  const r = await h.themeApi.importCustomTheme(themeJson({ label }));
  assert.equal(r.label, label);
});

test('导入主题_label长度81越界抛ERR_THEME_MISSING_FIELD', async () => {
  const h = await started();
  await assert.rejects(h.themeApi.importCustomTheme(themeJson({ label: '字'.repeat(81) })), code(ERR.THEME_MISSING_FIELD));
});

// ---------------- 校验顺序 6：id 冲突 ----------------
test('导入主题_id等于jade抛ERR_THEME_ID_CONFLICT', async () => {
  const h = await started();
  await assert.rejects(h.themeApi.importCustomTheme(themeJson({ id: 'jade' })), code(ERR.THEME_ID_CONFLICT));
});

test('导入主题_15个内置id全部抛ERR_THEME_ID_CONFLICT', async () => {
  const h = await started();
  for (const id of BUILTIN_THEME_IDS) {
    await assert.rejects(h.themeApi.importCustomTheme(themeJson({ id })), code(ERR.THEME_ID_CONFLICT), `id=${id}`);
  }
});

// ---------------- 校验顺序 7：token 形状 ----------------
test('导入主题_token键不以--dsw-开头抛ERR_THEME_BAD_TOKEN', async () => {
  const h = await started();
  await assert.rejects(
    h.themeApi.importCustomTheme(themeJson({ tokens: { '--other-bg': { light: '#1', dark: '#2' } } })),
    code(ERR.THEME_BAD_TOKEN),
  );
});

test('导入主题_token值是字符串而非对象抛ERR_THEME_BAD_TOKEN', async () => {
  const h = await started();
  await assert.rejects(
    h.themeApi.importCustomTheme(themeJson({ tokens: { '--dsw-bg': '#fff' } })),
    code(ERR.THEME_BAD_TOKEN),
  );
});

test('导入主题_token值缺dark抛ERR_THEME_BAD_TOKEN', async () => {
  const h = await started();
  await assert.rejects(
    h.themeApi.importCustomTheme(themeJson({ tokens: { '--dsw-bg': { light: '#fff' } } })),
    code(ERR.THEME_BAD_TOKEN),
  );
});

test('导入主题_token的light是空字符串抛ERR_THEME_BAD_TOKEN', async () => {
  const h = await started();
  await assert.rejects(
    h.themeApi.importCustomTheme(themeJson({ tokens: { '--dsw-bg': { light: '', dark: '#000' } } })),
    code(ERR.THEME_BAD_TOKEN),
  );
});

// ---------------- 校验顺序 8：token 值危险字符 ----------------
test('导入主题_token值含右花括号抛ERR_THEME_BAD_TOKEN', async () => {
  const h = await started();
  await assert.rejects(
    h.themeApi.importCustomTheme(themeJson({ tokens: { '--dsw-bg': { light: '#fff} body{display:none', dark: '#000' } } })),
    code(ERR.THEME_BAD_TOKEN),
  );
});

test('导入主题_token值含非末尾分号抛ERR_THEME_BAD_TOKEN', async () => {
  const h = await started();
  await assert.rejects(
    h.themeApi.importCustomTheme(themeJson({ tokens: { '--dsw-bg': { light: '#fff; color:red', dark: '#000' } } })),
    code(ERR.THEME_BAD_TOKEN),
  );
});

test('导入主题_token值以分号结尾是允许的边界', async () => {
  const h = await started();
  const r = await h.themeApi.importCustomTheme(themeJson({ tokens: { '--dsw-bg': { light: '#fff;', dark: '#000' } } }));
  assert.equal(r.tokens['--dsw-bg'].light, '#fff;');
});

// ---------------- 顺序优先级（两处同时违规时先报哪个）----------------
test('导入主题_JSON非法与字段缺失同时存在时先报INVALID_JSON', async () => {
  const h = await started();
  await assert.rejects(h.themeApi.importCustomTheme('{oops'), code(ERR.IMPORT_INVALID_JSON));
});

test('导入主题_缺label且id冲突时先报MISSING_FIELD', async () => {
  const h = await started();
  await assert.rejects(
    h.themeApi.importCustomTheme(JSON.stringify({ id: 'jade', tokens: okToken })),
    code(ERR.THEME_MISSING_FIELD),
  );
});

test('导入主题_id冲突且token非法时先报ID_CONFLICT', async () => {
  const h = await started();
  await assert.rejects(
    h.themeApi.importCustomTheme(themeJson({ id: 'jade', tokens: { bad: 1 } })),
    code(ERR.THEME_ID_CONFLICT),
  );
});

test('导入主题_label超长且token非法时先报MISSING_FIELD', async () => {
  const h = await started();
  await assert.rejects(
    h.themeApi.importCustomTheme(themeJson({ label: 'x'.repeat(81), tokens: { bad: 1 } })),
    code(ERR.THEME_MISSING_FIELD),
  );
});

// ---------------- Unicode / 超长 / 数量 ----------------
test('导入主题_label是中文加emoji时原样保留', async () => {
  const h = await started();
  const label = '深夜🌙的墨色';
  const r = await h.themeApi.importCustomTheme(themeJson({ label }));
  assert.equal(r.label, label);
  assert.equal(h.themeApi.getCustomThemes()[0].label, label);
});

test('导入主题_500个token也接受因为主题无体积上限', async () => {
  const h = await started();
  const tokens = {};
  for (let i = 0; i < 500; i += 1) tokens[`--dsw-c${i}`] = { light: '#fff', dark: '#000' };
  const r = await h.themeApi.importCustomTheme(themeJson({ tokens }));
  assert.equal(Object.keys(r.tokens).length, 500);
});

test('导入主题_连续导入20个自定义主题都保留因为无数量上限', async () => {
  const h = await started();
  for (let i = 0; i < 20; i += 1) await h.themeApi.importCustomTheme(themeJson({ id: `t${i}` }));
  assert.equal(h.themeApi.getCustomThemes().length, 20);
});

test('导入主题_其他未知字段被忽略不落盘', async () => {
  const h = await started();
  await h.themeApi.importCustomTheme(themeJson({ evil: 'x', version: 9 }));
  assert.deepEqual(Object.keys(h.themeApi.getCustomThemes()[0]).sort(), ['id', 'label', 'tokens']);
});

// ---------------- 不改状态保证（§3.8 第 1 条）----------------
test('导入主题失败_8个storage键一个都不写', async () => {
  const h = await started();
  const before = ALL_KEYS.map((k) => h.storage.raw(k));
  h.storage.resetStats();
  await assert.rejects(h.themeApi.importCustomTheme('{bad'), code(ERR.IMPORT_INVALID_JSON));
  assert.deepEqual(ALL_KEYS.map((k) => h.storage.raw(k)), before);
  assert.equal(h.storage.stats.set, 0);
  assert.equal(h.storage.stats.remove, 0);
});

test('导入主题失败_已有registry不被清空', async () => {
  const h = await started();
  await h.themeApi.importCustomTheme(themeJson({ id: 'keep', label: '留着' }));
  const before = h.storage.raw(KEYS.THEME_CUSTOM);
  await assert.rejects(h.themeApi.importCustomTheme(themeJson({ id: 'jade' })), code(ERR.THEME_ID_CONFLICT));
  assert.equal(h.storage.raw(KEYS.THEME_CUSTOM), before);
});

test('导入主题失败_当前生效外观不变', async () => {
  const h = await started({ seed: { [KEYS.THEME_FAMILY]: 'azure' } });
  const before = h.effectiveAppearance();
  await assert.rejects(h.themeApi.importCustomTheme(themeJson({ tokens: { bad: 1 } })), code(ERR.THEME_BAD_TOKEN));
  assert.deepEqual(h.effectiveAppearance(), before);
  assert.equal(h.dom.tokens.themeId, 'azure');
});

test('导入主题失败_注入的style数量不变', async () => {
  const h = await started();
  const before = h.dom.styleCount(STYLE_MARK);
  await assert.rejects(h.themeApi.importCustomTheme('nope'), code(ERR.IMPORT_INVALID_JSON));
  assert.equal(h.dom.styleCount(STYLE_MARK), before);
});
