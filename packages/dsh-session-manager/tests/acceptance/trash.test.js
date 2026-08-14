// trash.test.js — /sm/trash 验收测试（回收站清单回读）
// 覆盖：列出条目、缺省字段、多条目、空回收站、不回传 originalDir（路径泄漏防护）、幂等。
import { test, before, after, createTestContext, assertCode, exists } from './helpers.js';

let ctx;
const proj = 'x';

before(async () => { ctx = await createTestContext(); });
after(async () => { ctx.server.close(); ctx.cleanup(); });

// ---------- 正常路径 ----------
test('F1 /sm/trash 列出回收站条目：id + title + deadline，不含 originalDir', async (t) => {
  const s1 = ctx.newSession(proj, 'a-session');
  ctx.newSession(proj, 'b-session');
  await ctx.server.call('delete', { id: 'a-session', cwd: proj, title: '会话A' });
  await ctx.server.call('delete', { id: 'b-session', cwd: proj, title: '会话B' });
  const res = await ctx.server.call('trash');
  assertCode(t, res, 200, null);
  const items = res.json.items;
  t.assert.equal(items.length, 2, '应列两条');
  const a = items.find((i) => i.id === 'a-session');
  t.assert.ok(a, '含 a-session');
  t.assert.equal(a.title, '会话A', 'title 用于角色识别');
  t.assert.ok(typeof a.deadline === 'number', 'deadline 应为时间戳');
  // 路径泄漏防护：不回传 originalDir（审查 F-1）
  const serialized = JSON.stringify(res.json);
  t.assert.ok(!serialized.includes('originalDir'), '清单不回传 originalDir');
  t.assert.ok(!serialized.includes(ctx.tmpRoot), '清单不回传任何本地路径');
  t.assert.equal(exists(s1.dir), false, '文件确在回收站');
});

test('边界 title 缺失的条目 → 回收站清单 title 缺省或为空（不报错）', async (t) => {
  ctx.newSession(proj, 'no-title');
  await ctx.server.call('delete', { id: 'no-title', cwd: proj });
  const res = await ctx.server.call('trash');
  const item = res.json.items.find((i) => i.id === 'no-title');
  t.assert.ok(!(item && item.title && item.title.length > 0), '无 title 时不报错');
});

// ---------- 边界：空回收站 ----------
test('边界 空回收站 → 200 ok:true items:[]（非错误）', async (t) => {
  const c = await createTestContext();
  try {
    const res = await c.server.call('trash');
    assertCode(t, res, 200, null);
    t.assert.deepEqual(res.json.items, [], '空回收站返回空数组');
  } finally {
    await c.server.close();
    c.cleanup();
  }
});

// ---------- 幂等 / 一致性 ----------
test('幂等 连续读 trash 多次 → 结果一致（只读不改变状态）', async (t) => {
  const r1 = await ctx.server.call('trash');
  const r2 = await ctx.server.call('trash');
  t.assert.deepEqual(r1.json.items, r2.json.items, '多次读结果一致');
});
