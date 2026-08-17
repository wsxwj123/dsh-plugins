// INTERFACE §3.7 皮肤三件套导入 —— 校验顺序 1–10（缺文件 / JSON / meta / id / client 契约 / 高危 / ctx）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSubject } from './helpers/subject.mjs';
import { ERR, BUILTIN_SKIN_IDS, DANGEROUS_SUBSTRINGS } from './helpers/contract.mjs';
import { skinParts, skinJson, clientJs } from './helpers/fixtures.mjs';

const FULL = { services: { theme: {}, slots: {} } };
const started = async (opts = {}) => { const h = await createSubject(opts); h.start(FULL); return h; };
const code = (c) => (e) => e.code === c;
const imp = (h, over) => h.customSkinApi.importCustomSkin(skinParts(over));

// ---------------- 顺序 1：缺文件 ----------------
test('导入皮肤_skin为undefined抛ERR_SKIN_MISSING_FILE', async () => {
  const h = await started();
  await assert.rejects(imp(h, { skin: undefined }), code(ERR.SKIN_MISSING_FILE));
});

test('导入皮肤_skin为空字符串抛ERR_SKIN_MISSING_FILE', async () => {
  const h = await started();
  await assert.rejects(imp(h, { skin: '' }), code(ERR.SKIN_MISSING_FILE));
});

test('导入皮肤_client为空字符串抛ERR_SKIN_MISSING_FILE', async () => {
  const h = await started();
  await assert.rejects(imp(h, { client: '' }), code(ERR.SKIN_MISSING_FILE));
});

test('导入皮肤_client为null抛ERR_SKIN_MISSING_FILE', async () => {
  const h = await started();
  await assert.rejects(imp(h, { client: null }), code(ERR.SKIN_MISSING_FILE));
});

test('导入皮肤_三件套整体为undefined抛ERR_SKIN_MISSING_FILE', async () => {
  const h = await started();
  await assert.rejects(h.customSkinApi.importCustomSkin(undefined), code(ERR.SKIN_MISSING_FILE));
});

test('导入皮肤_三件套为空对象抛ERR_SKIN_MISSING_FILE', async () => {
  const h = await started();
  await assert.rejects(h.customSkinApi.importCustomSkin({}), code(ERR.SKIN_MISSING_FILE));
});

// ---------------- 顺序 2：skin.json 解析 ----------------
test('导入皮肤_skin不是JSON抛ERR_IMPORT_INVALID_JSON', async () => {
  const h = await started();
  await assert.rejects(imp(h, { skin: '这不是 json' }), code(ERR.IMPORT_INVALID_JSON));
});

test('导入皮肤_skin是JSON数组抛ERR_IMPORT_INVALID_JSON', async () => {
  const h = await started();
  await assert.rejects(imp(h, { skin: '[1,2]' }), code(ERR.IMPORT_INVALID_JSON));
});

test('导入皮肤_skin是数字字面量抛ERR_IMPORT_INVALID_JSON', async () => {
  const h = await started();
  await assert.rejects(imp(h, { skin: '7' }), code(ERR.IMPORT_INVALID_JSON));
});

test('导入皮肤_skin传对象而非字符串抛ERR_IMPORT_INVALID_JSON', async () => {
  const h = await started();
  await assert.rejects(imp(h, { skin: { id: 'demo' } }), code(ERR.IMPORT_INVALID_JSON));
});

// ---------------- 顺序 3：四个必填字段 ----------------
for (const field of ['id', 'name', 'author', 'license']) {
  test(`导入皮肤_缺${field}抛ERR_SKIN_BAD_META`, async () => {
    const h = await started();
    const meta = JSON.parse(skinJson());
    delete meta[field];
    await assert.rejects(imp(h, { skin: JSON.stringify(meta) }), code(ERR.SKIN_BAD_META));
  });

  test(`导入皮肤_${field}为空字符串抛ERR_SKIN_BAD_META`, async () => {
    const h = await started();
    await assert.rejects(imp(h, { skin: skinJson({ [field]: '' }) }), code(ERR.SKIN_BAD_META));
  });

  test(`导入皮肤_${field}为非字符串抛ERR_SKIN_BAD_META`, async () => {
    const h = await started();
    await assert.rejects(imp(h, { skin: skinJson({ [field]: 42 }) }), code(ERR.SKIN_BAD_META));
  });
}

// ---------------- 顺序 4：id 正则 ----------------
test('导入皮肤_id含大写抛ERR_SKIN_BAD_META', async () => {
  const h = await started();
  await assert.rejects(imp(h, { skin: skinJson({ id: 'Navi' }) }), code(ERR.SKIN_BAD_META));
});

test('导入皮肤_id以下划线开头抛ERR_SKIN_BAD_META', async () => {
  const h = await started();
  await assert.rejects(imp(h, { skin: skinJson({ id: '_navi' }) }), code(ERR.SKIN_BAD_META));
});

test('导入皮肤_id是中文抛ERR_SKIN_BAD_META', async () => {
  const h = await started();
  await assert.rejects(imp(h, { skin: skinJson({ id: '导航日记' }) }), code(ERR.SKIN_BAD_META));
});

test('导入皮肤_id含斜杠抛ERR_SKIN_BAD_META', async () => {
  const h = await started();
  await assert.rejects(imp(h, { skin: skinJson({ id: 'a/../b' }) }), code(ERR.SKIN_BAD_META));
});

test('导入皮肤_id长度65越界抛ERR_SKIN_BAD_META', async () => {
  const h = await started();
  await assert.rejects(imp(h, { skin: skinJson({ id: `a${'b'.repeat(64)}` }) }), code(ERR.SKIN_BAD_META));
});

test('导入皮肤_id长度64是上边界应通过', async () => {
  const h = await started();
  const id = `a${'b'.repeat(63)}`;
  const r = await h.customSkinApi.importCustomSkin(skinParts({ id, meta: { id } }));
  assert.equal(r.id, id);
});

// ---------------- 顺序 5：与内置皮肤 id 冲突（复用 THEME 前缀的码）----------------
test('导入皮肤_id等于miku抛ERR_THEME_ID_CONFLICT而不是SKIN前缀的码', async () => {
  const h = await started();
  await assert.rejects(imp(h, { skin: skinJson({ id: 'miku' }) }), code(ERR.THEME_ID_CONFLICT));
});

test('导入皮肤_9个内置皮肤id全部抛ERR_THEME_ID_CONFLICT', async () => {
  const h = await started();
  for (const id of BUILTIN_SKIN_IDS) {
    await assert.rejects(imp(h, { skin: skinJson({ id }) }), code(ERR.THEME_ID_CONFLICT), `id=${id}`);
  }
});

// ---------------- 顺序 6–7：client 契约 ----------------
test('导入皮肤_client为数字类型抛ERR_SKIN_CONTRACT', async () => {
  const h = await started();
  await assert.rejects(imp(h, { client: 12345 }), code(ERR.SKIN_CONTRACT));
});

test('导入皮肤_client缺ModuleLoader字面量抛ERR_SKIN_CONTRACT', async () => {
  const h = await started();
  await assert.rejects(imp(h, { client: 'function apply(ctx) {}' }), code(ERR.SKIN_CONTRACT));
});

test('导入皮肤_client缺factory抛ERR_SKIN_CONTRACT', async () => {
  const h = await started();
  const bad = 'window.__ModuleLoader__.load({ id: "x", make: () => { function apply(ctx) {} } });';
  await assert.rejects(imp(h, { client: bad }), code(ERR.SKIN_CONTRACT));
});

test('导入皮肤_client圆括号不配平抛ERR_SKIN_CONTRACT', async () => {
  const h = await started();
  await assert.rejects(imp(h, { client: `${clientJs('demo')}\n/* ( */` }), code(ERR.SKIN_CONTRACT));
});

test('导入皮肤_client右括号多一个抛ERR_SKIN_CONTRACT', async () => {
  const h = await started();
  await assert.rejects(imp(h, { client: `${clientJs('demo')}\n/* ) */` }), code(ERR.SKIN_CONTRACT));
});

// ---------------- 顺序 8：12 条高危黑名单 ----------------
for (const bad of DANGEROUS_SUBSTRINGS) {
  test(`导入皮肤_client命中高危子串「${bad}」抛ERR_SKIN_DANGEROUS`, async () => {
    const h = await started();
    // 用配平的注释承载黑名单串，确保被拒的原因只有"高危"这一条
    const payload = bad.endsWith('(') ? `/* ${bad}) */` : `/* ${bad} */`;
    await assert.rejects(imp(h, { client: clientJs('demo', payload) }), code(ERR.SKIN_DANGEROUS));
  });
}

test('导入皮肤_高危串出现在注释里同样被拒', async () => {
  const h = await started();
  await assert.rejects(imp(h, { client: clientJs('demo', '// 这里只是注释里写了 document.cookie') }), code(ERR.SKIN_DANGEROUS));
});

test('导入皮肤_高危串出现在字符串字面量里同样被拒', async () => {
  const h = await started();
  await assert.rejects(imp(h, { client: clientJs('demo', 'var s = "localStorage";') }), code(ERR.SKIN_DANGEROUS));
});

// ---------------- 顺序 9：未导出 apply ----------------
test('导入皮肤_未导出apply抛ERR_SKIN_CONTRACT', async () => {
  const h = await started();
  const noApply = 'window.__ModuleLoader__.load({ id: "x", factory: (r) => { return {}; } });';
  await assert.rejects(imp(h, { client: noApply }), code(ERR.SKIN_CONTRACT));
});

test('导入皮肤_以apply冒号形式导出即通过', async () => {
  const h = await started();
  const ok = 'window.__ModuleLoader__.load({ id: "x", factory: (r) => { return { apply: (ctx) => { ctx.get("a"); } }; } });';
  const r = await h.customSkinApi.importCustomSkin(skinParts({ client: ok }));
  assert.equal(r.bundleText, ok);
});

// ---------------- 顺序 10：ctx 白名单 ----------------
test('导入皮肤_使用ctx.window抛ERR_SKIN_CONTRACT', async () => {
  const h = await started();
  await assert.rejects(imp(h, { client: clientJs('demo', 'var w = ctx.window;') }), code(ERR.SKIN_CONTRACT));
});

test('导入皮肤_越权ctx名字出现在错误message里', async () => {
  const h = await started();
  await assert.rejects(
    imp(h, { client: clientJs('demo', 'var w = ctx.scope;') }),
    (e) => e.code === ERR.SKIN_CONTRACT && e.message.includes('scope'),
  );
});

test('导入皮肤_越权ctx名字写在注释里也被拒', async () => {
  const h = await started();
  await assert.rejects(imp(h, { client: clientJs('demo', '// 别用 ctx.root') }), code(ERR.SKIN_CONTRACT));
});

test('导入皮肤_只用ctx.effect与ctx.get时通过', async () => {
  const h = await started();
  const r = await h.customSkinApi.importCustomSkin(skinParts({ client: clientJs('demo', 'ctx0(); function f(ctx) { ctx.get("x"); ctx.effect(() => {}); }') }));
  assert.equal(r.id, 'demo');
});

// ---------------- 顺序优先级：两处同时违规先报哪个 ----------------
test('导入皮肤_缺文件与JSON非法同时存在时先报MISSING_FILE', async () => {
  const h = await started();
  await assert.rejects(imp(h, { skin: '' }), code(ERR.SKIN_MISSING_FILE));
});

test('导入皮肤_JSON非法与meta缺失同时存在时先报INVALID_JSON', async () => {
  const h = await started();
  await assert.rejects(imp(h, { skin: '{oops' }), code(ERR.IMPORT_INVALID_JSON));
});

test('导入皮肤_meta缺字段与id冲突同时存在时先报BAD_META', async () => {
  const h = await started();
  await assert.rejects(imp(h, { skin: skinJson({ id: 'miku', author: '' }) }), code(ERR.SKIN_BAD_META));
});

test('导入皮肤_id冲突与client类型错同时存在时先报ID_CONFLICT', async () => {
  const h = await started();
  await assert.rejects(imp(h, { skin: skinJson({ id: 'xp' }), client: 999 }), code(ERR.THEME_ID_CONFLICT));
});

test('导入皮肤_缺loader契约与高危串同时存在时先报CONTRACT', async () => {
  const h = await started();
  await assert.rejects(imp(h, { client: 'function apply(ctx) { eval("1"); }' }), code(ERR.SKIN_CONTRACT));
});

test('导入皮肤_高危串与未导出apply同时存在时先报DANGEROUS', async () => {
  const h = await started();
  const bad = 'window.__ModuleLoader__.load({ id: "x", factory: (r) => { fetch("/x"); return {}; } });';
  await assert.rejects(imp(h, { client: bad }), code(ERR.SKIN_DANGEROUS));
});

test('导入皮肤_高危串与越权ctx同时存在时先报DANGEROUS', async () => {
  const h = await started();
  await assert.rejects(imp(h, { client: clientJs('demo', 'var x = ctx.foo; /* fetch() */') }), code(ERR.SKIN_DANGEROUS));
});
