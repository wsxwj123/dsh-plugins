// INTERFACE §3.7 皮肤导入 —— 校验顺序 11–14（体积 / a11y / 数量）+ 落盘形态 + 覆盖生效项语义
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSubject } from './helpers/subject.mjs';
import {
  ERR, KEYS, ALL_KEYS, MAX_BUNDLE_B64, MAX_A11Y_BYTES, MAX_CUSTOM_COUNT, STYLE_MARK,
} from './helpers/contract.mjs';
import { skinParts, skinJson, clientJs, skinRegistry, bytes } from './helpers/fixtures.mjs';

const FULL = { services: { theme: {}, slots: {} } };
const started = async (opts = {}) => { const h = await createSubject(opts); h.start(FULL); return h; };
const code = (c) => (e) => e.code === c;
const imp = (h, over) => h.customSkinApi.importCustomSkin(skinParts(over));
const tick = () => new Promise((r) => setImmediate(r));
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64').length;

/**
 * 造一份 UTF-8 字节数恰好等于 rawTotal 的三件套（padding 塞进配平的注释里）。
 * base64 长度 = 4*ceil(bytes/3)，所以 rawTotal=196608 ⇒ 恰好 262144。
 */
function sizedParts(rawTotal) {
  const skin = skinJson({ id: 'big', name: 'big', author: 'a', license: 'MIT' });
  const base = clientJs('big');
  const pad = rawTotal - Buffer.byteLength(skin, 'utf8') - Buffer.byteLength(base, 'utf8') - 4;
  return { skin, client: clientJs('big', `/*${'a'.repeat(pad)}*/`) };
}

// ---------------- 顺序 11：bundle 体积 ----------------
test('导入皮肤_bundle的base64恰好262144是上边界应通过', async () => {
  const h = await started();
  const parts = sizedParts(196608);          // 4*ceil(196608/3) = 262144
  assert.equal(b64(parts.skin + parts.client), MAX_BUNDLE_B64, '样本没落在边界上，先修样本');
  const r = await h.customSkinApi.importCustomSkin(skinParts(parts));
  assert.equal(r.id, 'big');
});

test('导入皮肤_bundle的base64超262144抛ERR_SKIN_SIZE', async () => {
  const h = await started();
  const parts = sizedParts(196609);          // 比边界只多 1 字节
  assert.ok(b64(parts.skin + parts.client) > MAX_BUNDLE_B64, '样本没超界，先修样本');
  await assert.rejects(h.customSkinApi.importCustomSkin(skinParts(parts)), code(ERR.SKIN_SIZE));
});

test('导入皮肤_a11y文本不计入bundle的256KB上限', async () => {
  const h = await started();
  const parts = sizedParts(196608);
  const r = await h.customSkinApi.importCustomSkin(skinParts({ ...parts, a11y: bytes(60000) }));
  assert.equal(r.a11yText.length, 60000);
});

// ---------------- 顺序 12：a11y 体积 ----------------
test('导入皮肤_a11y恰好65536字节是上边界应通过', async () => {
  const h = await started();
  const r = await h.customSkinApi.importCustomSkin(skinParts({ a11y: bytes(MAX_A11Y_BYTES) }));
  assert.equal(Buffer.byteLength(r.a11yText, 'utf8'), MAX_A11Y_BYTES);
});

test('导入皮肤_a11y超65536字节抛ERR_SKIN_SIZE', async () => {
  const h = await started();
  await assert.rejects(imp(h, { a11y: bytes(MAX_A11Y_BYTES + 1) }), code(ERR.SKIN_SIZE));
});

test('导入皮肤_a11y按UTF8字节计而不是字符数', async () => {
  const h = await started();
  // 中文 3 字节/字：21846 字 = 65538 字节 > 64KB，但字符数只有 21846
  await assert.rejects(imp(h, { a11y: '中'.repeat(21846) }), code(ERR.SKIN_SIZE));
});

test('导入皮肤_a11y缺省时降级为空串且皮肤仍可用', async () => {
  const h = await started();
  const r = await h.customSkinApi.importCustomSkin({ skin: skinJson(), client: clientJs('demo') });
  assert.equal(r.a11yText, '');
  assert.equal(r.id, 'demo');
});

test('导入皮肤_a11y是数字类型时按缺省静默降级不报错', async () => {
  const h = await started();
  const r = await h.customSkinApi.importCustomSkin(skinParts({ a11y: 42 }));
  assert.equal(r.a11yText, '');
});

// ---------------- 顺序 13：a11y 危险内容 ----------------
test('导入皮肤_a11y含@import抛ERR_SKIN_DANGEROUS', async () => {
  const h = await started();
  await assert.rejects(imp(h, { a11y: '@import url("x.css");' }), code(ERR.SKIN_DANGEROUS));
});

test('导入皮肤_a11y含http远程url抛ERR_SKIN_DANGEROUS', async () => {
  const h = await started();
  await assert.rejects(imp(h, { a11y: 'body{background:url(http://x/y.png)}' }), code(ERR.SKIN_DANGEROUS));
});

test('导入皮肤_a11y含协议相对url抛ERR_SKIN_DANGEROUS', async () => {
  const h = await started();
  await assert.rejects(imp(h, { a11y: 'body{background:url(//cdn/x.png)}' }), code(ERR.SKIN_DANGEROUS));
});

test('导入皮肤_a11y的url带引号加空白仍被识破', async () => {
  const h = await started();
  await assert.rejects(imp(h, { a11y: 'body{background:url( "https://x/y.png" )}' }), code(ERR.SKIN_DANGEROUS));
});

test('导入皮肤_a11y的dataURI是允许的', async () => {
  const h = await started();
  const r = await h.customSkinApi.importCustomSkin(skinParts({ a11y: 'body{background:url(data:image/png;base64,AAAA)}' }));
  assert.ok(r.a11yText.includes('data:image/png'));
});

test('导入皮肤_a11y超界且含@import时先报SIZE', async () => {
  const h = await started();
  await assert.rejects(imp(h, { a11y: `@import "x";${bytes(MAX_A11Y_BYTES)}` }), code(ERR.SKIN_SIZE));
});

// ---------------- 顺序 14：数量上限 ----------------
test('导入皮肤_已有7个时新增第8个应通过', async () => {
  const ids = Array.from({ length: 7 }, (_, i) => `s${i}`);
  const h = await started({ seed: { [KEYS.SKIN_CUSTOM]: skinRegistry(ids) } });
  await imp(h, { id: 'newone', meta: { id: 'newone' } });
  assert.equal(h.customSkinApi.getSkins().length, MAX_CUSTOM_COUNT);
});

test('导入皮肤_已有8个时新增第9个抛ERR_SKIN_COUNT', async () => {
  const ids = Array.from({ length: 8 }, (_, i) => `s${i}`);
  const h = await started({ seed: { [KEYS.SKIN_CUSTOM]: skinRegistry(ids) } });
  await assert.rejects(imp(h, { id: 'newone', meta: { id: 'newone' } }), code(ERR.SKIN_COUNT));
});

test('导入皮肤_已有8个时覆盖同id不受数量限制', async () => {
  const ids = Array.from({ length: 8 }, (_, i) => `s${i}`);
  const h = await started({ seed: { [KEYS.SKIN_CUSTOM]: skinRegistry(ids) } });
  const r = await imp(h, { id: 's3', meta: { id: 's3', name: '改过的' } });
  assert.equal(r.name, '改过的');
  assert.equal(h.customSkinApi.getSkins().length, 8);
});

test('导入皮肤_数量超限时a11y危险内容先报DANGEROUS', async () => {
  const ids = Array.from({ length: 8 }, (_, i) => `s${i}`);
  const h = await started({ seed: { [KEYS.SKIN_CUSTOM]: skinRegistry(ids) } });
  await assert.rejects(
    imp(h, { id: 'newone', meta: { id: 'newone' }, a11y: '@import "x";' }),
    code(ERR.SKIN_DANGEROUS),
  );
});

// ---------------- 落盘形态 ----------------
test('导入皮肤成功_bundleText是client全文', async () => {
  const h = await started();
  const client = clientJs('demo', '/* marker-v1 */');
  const r = await h.customSkinApi.importCustomSkin(skinParts({ client }));
  assert.equal(r.bundleText, client);
  assert.equal(h.customSkinApi.getSkins()[0].bundleText, client);
});

test('导入皮肤成功_registry是version1的items形态', async () => {
  const h = await started();
  await imp(h, {});
  const raw = JSON.parse(h.storage.raw(KEYS.SKIN_CUSTOM));
  assert.equal(raw.version, 1);
  assert.equal(raw.items.length, 1);
});

test('导入皮肤成功_bodyAttr缺省为data-dsh加id', async () => {
  const h = await started();
  const r = await imp(h, { id: 'navi', meta: { id: 'navi' } });
  assert.equal(r.bodyAttr, 'data-dsh-navi');
});

test('导入皮肤成功_bodyAttr给了就用给的', async () => {
  const h = await started();
  const r = await imp(h, { meta: { id: 'demo', bodyAttr: 'data-x' } });
  assert.equal(r.bodyAttr, 'data-x');
});

test('导入皮肤成功_accent缺省为空串', async () => {
  const h = await started();
  const r = await imp(h, {});
  assert.equal(r.accent, '');
});

test('导入皮肤成功_order缺省为100加已有项数', async () => {
  const h = await started({ seed: { [KEYS.SKIN_CUSTOM]: skinRegistry(['a', 'b']) } });
  const r = await imp(h, { id: 'c', meta: { id: 'c' } });
  assert.equal(r.order, 102);
});

test('导入皮肤成功_source标记为custom', async () => {
  const h = await started();
  const r = await imp(h, {});
  assert.equal(r.source, 'custom');
});

test('导入皮肤成功_name含中文emoji与超长文本原样保留', async () => {
  const h = await started();
  const name = `导航日记🗺️${'长'.repeat(500)}`;
  const r = await imp(h, { meta: { id: 'demo', name } });
  assert.equal(r.name, name);
});

test('导入皮肤成功_不改变当前选中的id', async () => {
  const h = await started({ seed: { [KEYS.SKIN_BUILTIN]: 'xp' } });
  await tick();
  await imp(h, {});
  assert.equal(h.storage.read(KEYS.SKIN_BUILTIN), 'xp');
  assert.equal(h.storage.read(KEYS.SKIN_CUSTOM_APPLIED), '');
});

// ---------------- 覆盖当前生效项 → 立即用新 bundle 重新激活 ----------------
test('导入皮肤_覆盖已应用的同id时bundleText换成新的', async () => {
  const h = await started({
    seed: { [KEYS.SKIN_CUSTOM]: skinRegistry(['navi']), [KEYS.SKIN_CUSTOM_APPLIED]: 'navi' },
  });
  await tick();
  const client = clientJs('navi', '/* v2 */');
  await imp(h, { id: 'navi', meta: { id: 'navi' }, client });
  assert.equal(h.customSkinApi.getSkins()[0].bundleText, client);
});

test('导入皮肤_覆盖已应用的同id时body上换成新bundle的标记且旧标记不残留', async () => {
  const h = await started({
    seed: { [KEYS.SKIN_CUSTOM]: skinRegistry(['navi']), [KEYS.SKIN_CUSTOM_APPLIED]: 'navi' },
  });
  await tick();
  assert.equal(h.dom.body.attrs['data-dsh-navi'], '1');
  await imp(h, { id: 'navi', meta: { id: 'navi', bodyAttr: 'data-dsh-navi-v2' } });
  assert.equal(h.dom.body.attrs['data-dsh-navi-v2'], '1');
  assert.equal('data-dsh-navi' in h.dom.body.attrs, false, '旧 bundle 的 body 标记残留了');
});

test('导入皮肤_覆盖未应用的同id时不动当前生效外观', async () => {
  const h = await started({
    seed: { [KEYS.SKIN_CUSTOM]: skinRegistry(['navi', 'other']), [KEYS.SKIN_CUSTOM_APPLIED]: 'other' },
  });
  await tick();
  await imp(h, { id: 'navi', meta: { id: 'navi', bodyAttr: 'data-dsh-navi-v2' } });
  assert.equal(h.dom.activeSkin, 'other');
  assert.equal('data-dsh-navi-v2' in h.dom.body.attrs, false);
});

// ---------------- 不改状态保证（§3.8 第 1 条）----------------
test('导入皮肤失败_8个storage键一个都不写', async () => {
  const h = await started();
  const before = ALL_KEYS.map((k) => h.storage.raw(k));
  h.storage.resetStats();
  await assert.rejects(imp(h, { client: clientJs('demo', '/* eval() */') }), code(ERR.SKIN_DANGEROUS));
  assert.deepEqual(ALL_KEYS.map((k) => h.storage.raw(k)), before);
  assert.equal(h.storage.stats.set, 0);
  assert.equal(h.storage.stats.remove, 0);
});

test('导入皮肤失败_不注册进引擎不执行任何脚本', async () => {
  const h = await started();
  const before = h.execCount;
  await assert.rejects(imp(h, { client: clientJs('demo', '/* fetch() */') }), code(ERR.SKIN_DANGEROUS));
  assert.equal(h.execCount, before);
});

test('导入皮肤失败_registry里不出现该id', async () => {
  const h = await started();
  await assert.rejects(imp(h, { id: 'bad', meta: { id: 'bad' }, a11y: '@import "x";' }), code(ERR.SKIN_DANGEROUS));
  assert.equal(h.customSkinApi.getSkins().some((s) => s.id === 'bad'), false);
});

test('导入皮肤失败_当前生效皮肤不变', async () => {
  const h = await started({ seed: { [KEYS.SKIN_BUILTIN]: 'xp' } });
  await tick();
  await assert.rejects(imp(h, { skin: '{bad' }), code(ERR.IMPORT_INVALID_JSON));
  assert.equal(h.dom.activeSkin, 'xp');
});

test('导入皮肤失败_注入的style数量不变', async () => {
  const h = await started();
  const before = h.dom.styleCount(STYLE_MARK);
  await assert.rejects(imp(h, { skin: 'nope' }), code(ERR.IMPORT_INVALID_JSON));
  assert.equal(h.dom.styleCount(STYLE_MARK), before);
});

test('导入皮肤失败_已有registry不被清空', async () => {
  const h = await started({ seed: { [KEYS.SKIN_CUSTOM]: skinRegistry(['keep']) } });
  const before = h.storage.raw(KEYS.SKIN_CUSTOM);
  await assert.rejects(imp(h, { skin: skinJson({ id: 'ths' }) }), code(ERR.THEME_ID_CONFLICT));
  assert.equal(h.storage.raw(KEYS.SKIN_CUSTOM), before);
});
