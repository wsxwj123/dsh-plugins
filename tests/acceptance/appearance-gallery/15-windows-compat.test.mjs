// Windows 侧边界（BRIEF「平台范围」）。断言口径一律以 INTERFACE §3.6 / §3.7 为准：
// 契约明确判定的写真断言；契约没覆盖的写 skip + "需 INTERFACE 补契约"，不自行发明。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createSubject } from './helpers/subject.mjs';
import { ERR, MAX_A11Y_BYTES, TEXT, BODY_ATTR_RE } from './helpers/contract.mjs';
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

test('Windows保留名_designSummary带出保留名提示且不收紧id正则', async () => {
  // A7-1 裁决：只加文档提示，不加校验（受控导入不落磁盘目录）
  const h = await started();
  h.entry.openPanel();
  assert.ok(h.entry.skinPanel.designSummary().includes(TEXT.winReservedHint), 'designSummary 缺保留名提示');
  assert.equal(
    TEXT.winReservedHint,
    'id 不要用 Windows 保留名（con / prn / aux / nul / com1-9 / lpt1-9），否则在 Windows 上无法创建同名目录。',
  );
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

// A7-2 裁决：bodyAttr 必须匹配 /^data-[a-z0-9-]{1,64}$/，否则 ERR_SKIN_BAD_META（校验顺序 4b）
test('bodyAttr_含非法属性名字符时抛ERR_SKIN_BAD_META', async () => {
  const h = await started();
  await assert.rejects(
    h.customSkinApi.importCustomSkin(skinParts({ meta: { id: 'demo', bodyAttr: 'data-x<y="z"' } })),
    code(ERR.SKIN_BAD_META),
  );
});

test('bodyAttr_不以data-开头时抛ERR_SKIN_BAD_META', async () => {
  const h = await started();
  await assert.rejects(
    h.customSkinApi.importCustomSkin(skinParts({ meta: { id: 'demo', bodyAttr: 'skin-demo' } })),
    code(ERR.SKIN_BAD_META),
  );
});

test('bodyAttr_含大写字母时抛ERR_SKIN_BAD_META', async () => {
  const h = await started();
  await assert.rejects(
    h.customSkinApi.importCustomSkin(skinParts({ meta: { id: 'demo', bodyAttr: 'data-Demo' } })),
    code(ERR.SKIN_BAD_META),
  );
});

test('bodyAttr_只有data-前缀没有后续字符时抛ERR_SKIN_BAD_META', async () => {
  const h = await started();
  await assert.rejects(
    h.customSkinApi.importCustomSkin(skinParts({ meta: { id: 'demo', bodyAttr: 'data-' } })),
    code(ERR.SKIN_BAD_META),
  );
});

test('bodyAttr_后缀正好64字符是上边界应通过', async () => {
  const h = await started();
  const bodyAttr = `data-${'a'.repeat(64)}`;
  assert.equal(BODY_ATTR_RE.test(bodyAttr), true, '前置条件：样本必须落在边界上');
  const r = await h.customSkinApi.importCustomSkin(skinParts({ meta: { id: 'demo', bodyAttr } }));
  assert.equal(r.bodyAttr, bodyAttr);
});

test('bodyAttr_后缀65字符越界抛ERR_SKIN_BAD_META', async () => {
  const h = await started();
  await assert.rejects(
    h.customSkinApi.importCustomSkin(skinParts({ meta: { id: 'demo', bodyAttr: `data-${'a'.repeat(65)}` } })),
    code(ERR.SKIN_BAD_META),
  );
});

test('bodyAttr_非法时先于id冲突报错', async () => {
  // 校验顺序 4b 在第 5 步（id 冲突）之前
  const h = await started();
  await assert.rejects(
    h.customSkinApi.importCustomSkin(skinParts({ skin: skinJson({ id: 'miku', bodyAttr: 'bad!' }) })),
    code(ERR.SKIN_BAD_META),
  );
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
// A7-3 裁决：只对要 JSON.parse 的文本剥前导 BOM；client.js / a11y.css 一律不动
test('BOM_主题JSON带BOM时剥掉BOM后导入成功', async () => {
  const h = await started();
  const r = await h.themeApi.importCustomTheme(`﻿${themeJson({ id: 'bom' })}`);
  assert.equal(r.id, 'bom');
});

test('BOM_skinjson带BOM时剥掉BOM后导入成功', async () => {
  const h = await started();
  const r = await h.customSkinApi.importCustomSkin(skinParts({ skin: `﻿${skinJson()}` }));
  assert.equal(r.id, 'demo');
});

test('BOM_剥离不放松任何安全闸', async () => {
  const h = await started();
  await assert.rejects(
    h.customSkinApi.importCustomSkin(skinParts({ skin: `﻿${skinJson({ id: 'miku' })}` })),
    code(ERR.THEME_ID_CONFLICT),
  );
});

test('BOM_只剥一个前导BOM_两个BOM仍解析失败', async () => {
  const h = await started();
  await assert.rejects(h.themeApi.importCustomTheme(`﻿﻿${themeJson()}`), code(ERR.IMPORT_INVALID_JSON));
});

test('BOM_clientjs的BOM不被剥离原文入库', async () => {
  const h = await started();
  const withBom = `﻿${clientJs('demo')}`;
  const r = await h.customSkinApi.importCustomSkin(skinParts({ client: withBom }));
  assert.equal(r.bundleText, withBom, 'client 文本必须原样保留，否则体积计算与用户粘贴内容不一致');
  assert.equal(r.bundleText.charCodeAt(0), 0xFEFF);
});

test('BOM_a11y的BOM不被剥离原文入库', async () => {
  const h = await started();
  const withBom = `﻿:root{--dsh-focus:2px}`;
  const r = await h.customSkinApi.importCustomSkin(skinParts({ a11y: withBom }));
  assert.equal(r.a11yText, withBom);
});

// ---------------- a11y 的 url() 门禁：A7-4 裁决后拦 6 种前缀 ----------------
test('a11y_UNC路径url抛ERR_SKIN_DANGEROUS', async () => {
  const h = await started();
  await assert.rejects(
    h.customSkinApi.importCustomSkin(skinParts({ a11y: 'body{background:url(\\\\server\\share\\x.png)}' })),
    code(ERR.SKIN_DANGEROUS),
  );
});

test('a11y_file协议url抛ERR_SKIN_DANGEROUS', async () => {
  const h = await started();
  await assert.rejects(
    h.customSkinApi.importCustomSkin(skinParts({ a11y: 'body{background:url(file:///C:/x.png)}' })),
    code(ERR.SKIN_DANGEROUS),
  );
});

test('a11y_ftp协议url抛ERR_SKIN_DANGEROUS', async () => {
  const h = await started();
  await assert.rejects(
    h.customSkinApi.importCustomSkin(skinParts({ a11y: 'body{background:url(ftp://h/x.png)}' })),
    code(ERR.SKIN_DANGEROUS),
  );
});

test('a11y_websocket协议url抛ERR_SKIN_DANGEROUS', async () => {
  const h = await started();
  await assert.rejects(
    h.customSkinApi.importCustomSkin(skinParts({ a11y: 'body{background:url(wss://h/x)}' })),
    code(ERR.SKIN_DANGEROUS),
  );
});

test('a11y_同目录相对路径url仍被允许', async () => {
  const h = await started();
  const r = await h.customSkinApi.importCustomSkin(skinParts({ a11y: 'body{background:url(bg.png)}' }));
  assert.ok(r.a11yText.includes('url(bg.png)'));
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
