// Windows 侧边界（BRIEF「平台范围」）。断言口径一律以 INTERFACE §3.6 / §3.7 为准：
// 契约明确判定的写真断言；契约没覆盖的写 skip + "需 INTERFACE 补契约"，不自行发明。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createSubject } from './helpers/subject.mjs';
import { ERR, MAX_A11Y_BYTES } from './helpers/contract.mjs';
import { themeJson, skinJson, clientJs, skinParts } from './helpers/fixtures.mjs';

const FULL = { services: { theme: {}, slots: {} } };
const started = async (opts = {}) => { const h = await createSubject(opts); h.start(FULL); return h; };
const code = (c) => (e) => e.code === c;
const WIN_RESERVED = ['con', 'nul', 'aux', 'prn', 'com1', 'lpt1'];
const WIN_ILLEGAL_CHARS = ['<', '>', ':', '"', '|', '?', '*', '\\'];

// ---------------- 测试自身跨平台 ----------------
test('跨平台_测试用的路径拼接不含POSIX-only假设', () => {
  // 这批测试与 harness 一律用 node:path；此处只钉住"分隔符取自 path.sep 而不是写死斜杠"
  const joined = path.join('a', 'b');
  assert.equal(joined, `a${path.sep}b`);
  assert.equal(path.isAbsolute(path.join(path.sep, 'x')), true);
});

// ---------------- Windows 保留名（INTERFACE 未把它们列进冲突名单 ⇒ 合法）----------------
for (const name of WIN_RESERVED) {
  test(`Windows保留名_主题id为${name}时按INTERFACE正则合法应被接受`, async () => {
    const h = await started();
    const r = await h.themeApi.importCustomTheme(themeJson({ id: name }));
    assert.equal(r.id, name);
  });
}

test('Windows保留名_皮肤id为nul时按INTERFACE正则合法应被接受', async () => {
  const h = await started();
  const r = await h.customSkinApi.importCustomSkin(skinParts({ id: 'nul', meta: { id: 'nul' } }));
  assert.equal(r.id, 'nul');
  assert.equal(r.bodyAttr, 'data-dsh-nul');
});

test('Windows保留名_大写CON因正则不允许大写而被拒', async () => {
  const h = await started();
  await assert.rejects(h.themeApi.importCustomTheme(themeJson({ id: 'CON' })), code(ERR.THEME_MISSING_FIELD));
});

test('Windows保留名_大写AUX的皮肤id被拒', async () => {
  const h = await started();
  await assert.rejects(
    h.customSkinApi.importCustomSkin(skinParts({ skin: skinJson({ id: 'AUX' }) })),
    code(ERR.SKIN_BAD_META),
  );
});

test('Windows保留名_带扩展名的con.txt因含点号被拒', async () => {
  const h = await started();
  await assert.rejects(h.themeApi.importCustomTheme(themeJson({ id: 'con.txt' })), code(ERR.THEME_MISSING_FIELD));
});

test('Windows保留名_designSummary建议的目录名是否需回避保留名待定', async (t) => {
  t.skip('INTERFACE §3.3 只要求 designSummary 里的仓库路径换成 packages/appearance-gallery/skins/<skin-id>/，'
    + '没规定 <skin-id> 为 con/nul/aux 时 Windows 无法建同名目录该怎么办 —— 需 INTERFACE 补契约');
});

// ---------------- Windows 文件名非法字符 ----------------
for (const ch of WIN_ILLEGAL_CHARS) {
  test(`Windows非法字符_主题id含${JSON.stringify(ch)}被拒为MISSING_FIELD`, async () => {
    const h = await started();
    await assert.rejects(
      h.themeApi.importCustomTheme(themeJson({ id: `my${ch}theme` })),
      code(ERR.THEME_MISSING_FIELD),
    );
  });

  test(`Windows非法字符_皮肤id含${JSON.stringify(ch)}被拒为BAD_META`, async () => {
    const h = await started();
    await assert.rejects(
      h.customSkinApi.importCustomSkin(skinParts({ skin: skinJson({ id: `sk${ch}in` }) })),
      code(ERR.SKIN_BAD_META),
    );
  });
}

test('Windows非法字符_主题label含这些字符时INTERFACE不限制应被原样接受', async () => {
  const h = await started();
  const label = '主题<>:"|?*\\名';
  const r = await h.themeApi.importCustomTheme(themeJson({ label }));
  assert.equal(r.label, label);
  assert.equal(h.themeApi.getCustomThemes()[0].label, label);
});

test('Windows非法字符_皮肤name含这些字符时应被原样接受', async () => {
  const h = await started();
  const name = 'C:\\皮肤<测试>|1';
  const r = await h.customSkinApi.importCustomSkin(skinParts({ meta: { id: 'demo', name } }));
  assert.equal(r.name, name);
});

test('Windows非法字符_bodyAttr含非法属性名字符时的处置待定', async (t) => {
  t.skip('INTERFACE §3.7 把 bodyAttr 列为"可选字符串"且不做校验，没规定 '
    + '`data-x<y="z"` 这种无法作为 HTML 属性名的值该拒还是该消毒 —— 需 INTERFACE 补契约');
});

// ---------------- CRLF 换行（Windows 记事本 / PowerShell 默认）----------------
test('CRLF_client.js用CRLF换行时导入成功', async () => {
  const h = await started();
  const crlf = clientJs('demo').replace(/\n/g, '\r\n');
  const r = await h.customSkinApi.importCustomSkin(skinParts({ client: crlf }));
  assert.equal(r.bundleText, crlf);
});

test('CRLF_client.js用CRLF时高危黑名单依然命中', async () => {
  const h = await started();
  const crlf = clientJs('demo', '/* document.cookie */').replace(/\n/g, '\r\n');
  await assert.rejects(h.customSkinApi.importCustomSkin(skinParts({ client: crlf })), code(ERR.SKIN_DANGEROUS));
});

test('CRLF_client.js用CRLF时ctx白名单依然生效', async () => {
  const h = await started();
  const crlf = clientJs('demo', 'var a = ctx.nope;').replace(/\n/g, '\r\n');
  await assert.rejects(h.customSkinApi.importCustomSkin(skinParts({ client: crlf })), code(ERR.SKIN_CONTRACT));
});

test('CRLF_a11y用CRLF时@import依然被拒', async () => {
  const h = await started();
  await assert.rejects(
    h.customSkinApi.importCustomSkin(skinParts({ a11y: '/* x */\r\n@import "y.css";\r\n' })),
    code(ERR.SKIN_DANGEROUS),
  );
});

test('CRLF_a11y体积按字节算_CRLF的回车也计入', async () => {
  const h = await started();
  // 32768 组 CRLF = 65536 字节，正好等于上限
  const r = await h.customSkinApi.importCustomSkin(skinParts({ a11y: '\r\n'.repeat(MAX_A11Y_BYTES / 2) }));
  assert.equal(Buffer.byteLength(r.a11yText, 'utf8'), MAX_A11Y_BYTES);
});

test('CRLF_a11y比上限多一组CRLF时抛ERR_SKIN_SIZE', async () => {
  const h = await started();
  await assert.rejects(
    h.customSkinApi.importCustomSkin(skinParts({ a11y: '\r\n'.repeat(MAX_A11Y_BYTES / 2 + 1) })),
    code(ERR.SKIN_SIZE),
  );
});

test('CRLF_主题token值含CRLF时不属于危险字符应被接受', async () => {
  const h = await started();
  const r = await h.themeApi.importCustomTheme(themeJson({ tokens: { '--dsw-bg': { light: '#fff\r\n', dark: '#000' } } }));
  assert.equal(r.tokens['--dsw-bg'].light, '#fff\r\n');
});

// ---------------- BOM（Windows 记事本默认存 UTF-8 with BOM）----------------
test('BOM_主题JSON带BOM时按JSON解析失败抛INVALID_JSON', async () => {
  const h = await started();
  await assert.rejects(h.themeApi.importCustomTheme(`\uFEFF${themeJson()}`), code(ERR.IMPORT_INVALID_JSON));
});

test('BOM_skin.json带BOM时按JSON解析失败抛INVALID_JSON', async () => {
  const h = await started();
  await assert.rejects(
    h.customSkinApi.importCustomSkin(skinParts({ skin: `\uFEFF${skinJson()}` })),
    code(ERR.IMPORT_INVALID_JSON),
  );
});

test('BOM_client.js带BOM时不影响契约校验仍导入成功', async () => {
  const h = await started();
  const withBom = `\uFEFF${clientJs('demo')}`;
  const r = await h.customSkinApi.importCustomSkin(skinParts({ client: withBom }));
  assert.equal(r.bundleText, withBom);
});

test('BOM_是否应在导入前剥离BOM待定', async (t) => {
  t.skip('Windows 记事本默认存 UTF-8 with BOM，用户会拿到 ERR_IMPORT_INVALID_JSON 却看不懂原因。'
    + 'INTERFACE 未规定是否剥离 BOM 或给专门提示 —— 需 INTERFACE 补契约');
});

// ---------------- a11y 远程资源的 Windows 形态 ----------------
test('a11y_UNC路径url的处置待定', async (t) => {
  t.skip('INTERFACE §3.7 只拦 url() 后紧跟 http 或 // 的情况；Windows UNC 写法 '
    + 'url(\\\\server\\share\\x.png) 同样是远程取资源却不在拦截范围 —— 需 INTERFACE 补契约');
});

test('a11y_file协议url的处置待定', async (t) => {
  t.skip('url(file:///C:/x.png) 不匹配 http 也不匹配 //，当前契约放行 —— 需 INTERFACE 补契约');
});

// ---------------- 平台无关性：同一份输入两平台同结论 ----------------
test('平台无关_导入结果不依赖process.platform', async () => {
  const h = await started();
  const r = await h.customSkinApi.importCustomSkin(skinParts({ id: 'plat', meta: { id: 'plat' } }));
  // 落盘形态里不得出现任何平台相关字段
  assert.deepEqual(Object.keys(r).sort(), [
    'a11yText', 'accent', 'author', 'bodyAttr', 'bundleText', 'id',
    'license', 'name', 'nameEn', 'order', 'source',
  ]);
});

test('平台无关_storage键名不含路径分隔符', async () => {
  const h = await started();
  await h.themeApi.importCustomTheme(themeJson({ id: 'x' }));
  for (const k of h.storage.keys()) {
    assert.equal(k.includes('/'), false, `键名 ${k} 含斜杠`);
    assert.equal(k.includes('\\'), false, `键名 ${k} 含反斜杠`);
  }
});
