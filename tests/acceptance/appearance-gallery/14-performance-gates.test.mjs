// INTERFACE §3.11 性能验收口径。P1/P4/P5/P6/P8 可静态或单测断言；P2/P3/P9/P10/P11 需真机测量 → 待接线。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createSubject } from './helpers/subject.mjs';
import { PERF, CLIENT_JS_HARD_MAX_BYTES, KEYS } from './helpers/contract.mjs';
import { skipUnlessPkg, walk, countMatches, findInPackages, PKG_DIR } from './helpers/pkg.mjs';
import { skinRegistry, themeRegistry, themeJson } from './helpers/fixtures.mjs';

const FULL = { services: { theme: {}, slots: {} } };
const started = async (opts = {}) => { const h = await createSubject(opts); h.start(FULL); return h; };

// ---------------- P1：皮肤源码里不得再有 fixed 背景 ----------------
test('P1_皮肤源码中background-attachment-fixed命中数为0', (t) => {
  if (skipUnlessPkg(t)) return;
  // 注意：P1 绿只证明"源码里没有 fixed"，不证明滚动变快了。能证明的只有 P9 三组采样。
  const files = walk('skins', ['.js', '.css']);
  assert.ok(files.length > 0, 'skins/ 下没找到 client.js / a11y.css');
  const hits = files.flatMap((f) => {
    const n = countMatches(fs.readFileSync(f, 'utf8'), /background-attachment\s*:\s*fixed/g);
    return n ? [`${path.basename(path.dirname(f))}/${path.basename(f)}:${n}`] : [];
  });
  assert.deepEqual(hits, []);
});

// ---------------- P4：backdrop-filter 计数 ----------------
test('P4_全仓backdrop-filter出现次数不超过12', (t) => {
  if (skipUnlessPkg(t)) return;
  const files = [...walk('skins', ['.js', '.css']), ...walk('src', ['.js', '.css', '.mjs'])];
  const total = files.reduce((n, f) => n + countMatches(fs.readFileSync(f, 'utf8'), /backdrop-filter/g), 0);
  assert.ok(total <= PERF.backdropFilterTotalMax, `backdrop-filter 总数 ${total} > ${PERF.backdropFilterTotalMax}`);
});

test('P4_单个皮肤backdrop-filter不超过4', (t) => {
  if (skipUnlessPkg(t)) return;
  const perSkin = new Map();
  for (const f of walk('skins', ['.js', '.css'])) {
    const skin = path.basename(path.dirname(f));
    const n = countMatches(fs.readFileSync(f, 'utf8'), /backdrop-filter/g);
    perSkin.set(skin, (perSkin.get(skin) || 0) + n);
  }
  const over = [...perSkin].filter(([, n]) => n > PERF.backdropFilterPerSkinMax);
  assert.deepEqual(over, [], `超标皮肤：${over.map(([s, n]) => `${s}=${n}`).join(',')}`);
});

// ---------------- P5：体积 ----------------
test('P5_产物体积不超过兜底上限900KB', (t) => {
  if (skipUnlessPkg(t)) return;
  const p = path.join(PKG_DIR, 'lib/client.js');
  assert.ok(fs.existsSync(p), 'lib/client.js 不存在');
  const size = fs.statSync(p).size;
  assert.ok(size <= CLIENT_JS_HARD_MAX_BYTES, `${size} B > ${CLIENT_JS_HARD_MAX_BYTES} B`);
});

test('P5_T3.4落定的精确体积阈值待接线', (t) => {
  t.skip('INTERFACE 把 lib/client.js 与 4 图 base64 的阈值写成 TBD(T3.4)；数值落定后把这条改成精确断言');
});

// ---------------- P6：registry 记忆化（两侧各跑一遍）----------------
test('P6_皮肤侧连续10次getSkins只发生1次JSON解析', async () => {
  const h = await started({ seed: { [KEYS.SKIN_CUSTOM]: skinRegistry(['a', 'b']) } });
  h.storage.resetStats();
  for (let i = 0; i < 10; i += 1) h.customSkinApi.getSkins();
  assert.equal(h.storage.stats.parse, PERF.memoizedParseCalls);
});

test('P6_皮肤侧registry写入后下一次读恰好重新解析1次', async () => {
  const h = await started({ seed: { [KEYS.SKIN_CUSTOM]: skinRegistry(['a']) } });
  h.customSkinApi.getSkins();
  h.customSkinApi.deleteCustomSkin('a');
  h.storage.resetStats();
  h.customSkinApi.getSkins();
  h.customSkinApi.getSkins();
  assert.equal(h.storage.stats.parse, 1);
});

test('P6_主题侧连续10次读registry只发生1次JSON解析', async () => {
  const h = await started({ seed: { [KEYS.THEME_CUSTOM]: themeRegistry(['a', 'b']) } });
  h.storage.resetStats();
  for (let i = 0; i < 10; i += 1) h.themeApi.getCustomThemes();
  assert.equal(h.storage.stats.parse, PERF.memoizedParseCalls);
});

test('P6_主题侧registry写入后下一次读恰好重新解析1次', async () => {
  const h = await started();
  await h.themeApi.importCustomTheme(themeJson({ id: 'x' }));
  h.storage.resetStats();
  h.themeApi.getCustomThemes();
  h.themeApi.getCustomThemes();
  assert.equal(h.storage.stats.parse, 1);
});

// ---------------- P7：入口懒挂载（口径与 §3.3 E2 相同，见 03 号文件）----------------
test('P7_闭合态节点数与卡片缺席已在03号文件断言', (t) => {
  t.skip('P7 与 §3.3 E2 是同一口径，断言写在 03-entry-panel.test.mjs，避免重复门禁');
});

// ---------------- P8：skins 目录唯一 ----------------
test('P8_全仓skin.json命中9条', (t) => {
  if (skipUnlessPkg(t)) return;
  assert.equal(findInPackages('skin.json').length, PERF.skinJsonCount);
});

test('P8_9个skin.json都在同一个skins目录下', (t) => {
  if (skipUnlessPkg(t)) return;
  const roots = new Set(findInPackages('skin.json').map((p) => path.dirname(path.dirname(p))));
  assert.equal(roots.size, 1, `skins 目录出现在多处：${[...roots].join(' | ')}`);
});

// ---------------- 需真机测量：待接线（04 之后按注释里的方法跑）----------------
test('P2_应用皮肤后body的backgroundAttachment不是fixed', (t) => {
  t.skip('真机项：dsh web --port 3199 → 应用任一皮肤 → 控制台跑 '
    + 'getComputedStyle(document.body).backgroundAttachment !== "fixed"；接线方式见 e2e/ 目录');
});

test('P3_专用背景层数量不超过1且带fixed与pointer-events-none与负z-index', (t) => {
  t.skip('真机项，且仅在采用"专用背景层"方案时适用：控制台跑 '
    + 'document.querySelectorAll("[data-skin-bg]").length <= 1 并检查该层三条样式');
});

test('P9_归因三组采样必须给出数字', (t) => {
  t.skip('卡点项（T4.3）：① 未应用皮肤 ② 应用 blue-fantasy ③ 应用 blue-fantasy 且把 '
    + 'background-attachment 改成 scroll；requestAnimationFrame 采 60 帧 p95。'
    + '②③ 差值显著才证明 fixed 是主因；治理后 ② 应逼近 ①。三个数字缺一不算达标');
});

test('P10_设置页通用可交互耗时对比卸载本插件后的基线', (t) => {
  t.skip('真机项（BRIEF 用户原话场景）：performance.mark 量"点击通用 → 可交互"，'
    + '与卸载本插件后的同一测量对比，差值须 ≤ T0 实测基线落定的阈值');
});

test('P11_面板打开时面板内滚动60帧p95对比面板关闭', (t) => {
  t.skip('真机项，与 P9 同一采样脚本。这条同时是"不做列表虚拟化"的证据；超标则虚拟化重新讨论');
});
