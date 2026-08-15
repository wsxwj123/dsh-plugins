// emptyTrash.test.js — /sm/emptyTrash 验收测试
// 覆盖：二次确认门（confirm:true）、无确认 400、fence 403、清空全部、空回收站幂等、system-error。
import { test, before, after, createTestContext, assertCode, exists, path, fs } from './helpers.js';

let ctx;
const proj = 'w';

before(async () => { ctx = await createTestContext(); });
after(async () => { await ctx.server.close(); ctx.cleanup(); });

async function seedTrash(idList) {
  const created = [];
  for (const id of idList) {
    const s = ctx.newSession(proj, id);
    await ctx.server.call('delete', { id, cwd: proj, title: id });
    created.push(s);
  }
  return created;
}

// ---------- 正常路径 ----------
test('F1 清空回收站（confirm:true）→ 200 ok，回收站根全部条目删除、原位不回', async (t) => {
  await seedTrash(['t1', 't2', 't3']);
  const res = await ctx.server.call('emptyTrash', { confirm: true });
  assertCode(t, res, 200, null);
  for (const id of ['t1', 't2', 't3']) {
    t.assert.equal(exists(path.join(ctx.trash.root, id)), false, `回收站条目 ${id} 已删除`);
  }
});

test('清空后 /sm/trash 清单为空', async (t) => {
  await seedTrash(['e1']);
  await ctx.server.call('emptyTrash', { confirm: true });
  const list = await ctx.server.call('trash');
  t.assert.equal(list.json.items.length, 0, '清空后回收站清单应为空');
});

// ---------- 二次确认门（常见误操作：请求缺 confirm）----------
test('F1 关键安全 无 confirm 或 confirm 非严格 true → 400 confirmation-required，不动任何文件', async (t) => {
  await seedTrash(['safe1']);
  const resNoBody = await ctx.server.call('emptyTrash', undefined);
  assertCode(t, resNoBody, 400, 'confirmation-required');
  const resEmpty = await ctx.server.call('emptyTrash', {});
  assertCode(t, resEmpty, 400, 'confirmation-required');
  const resStr = await ctx.server.call('emptyTrash', { confirm: 'true' });
  assertCode(t, resStr, 400, 'confirmation-required');
  const resNum = await ctx.server.call('emptyTrash', { confirm: 1 });
  assertCode(t, resNum, 400, 'confirmation-required');
  t.assert.ok(exists(path.join(ctx.trash.root, 'safe1')), '未确认时不得清空，条目仍在');
});

test('F1 缺 confirm 的 emptyTrash 后文件仍可 restore（数据安全不被误清）', async (t) => {
  await seedTrash(['safe2']);
  await ctx.server.call('emptyTrash', {});
  const list = await ctx.server.call('trash');
  t.assert.ok(list.json.items.some((i) => i.id === 'safe2'), '未确认清空后条目仍可回读');
  const res = await ctx.server.call('restore', { id: 'safe2' });
  assertCode(t, res, 200, null);
});

// ---------- fence ----------
test('F1 未过信任 fence 的 emptyTrash → 403 先于数据操作，不动文件', async (t) => {
  await seedTrash(['fence1']);
  const res = await ctx.server.call('emptyTrash', { confirm: true }, { 'sec-fetch-site': 'cross-site' });
  assertCode(t, res, 403, null);
  t.assert.ok(exists(path.join(ctx.trash.root, 'fence1')), '403 时即使带 confirm:true 也不清空');
});

// ---------- 空回收站幂等 ----------
test('幂等 空回收站清空 → 200 ok（无条目可删，不为错误）', async (t) => {
  const res = await ctx.server.call('emptyTrash', { confirm: true });
  assertCode(t, res, 200, null);
});

test('幂等 重复清空 → 每次都 200 ok 不报错', async (t) => {
  await seedTrash(['idem-trash']);
  await ctx.server.call('emptyTrash', { confirm: true });
  const res2 = await ctx.server.call('emptyTrash', { confirm: true });
  assertCode(t, res2, 200, null);
});

// ---------- system-error ----------
test('错误 emptyTrash 部分失败 → 200 system-error，已删的删了、未删的仍在（日志标注失败项）', async (t) => {
  const [a, b] = await seedTrash(['partA', 'partB']);
  ctx.makeEmptyFail('partB'); // 模拟 partB 无法删除
  const res = await ctx.server.call('emptyTrash', { confirm: true });
  assertCode(t, res, 200, 'system-error');
  t.assert.equal(exists(a.dir), false, '已删条目 partA 应被删除（不在原位）');
  t.assert.equal(exists(path.join(ctx.trash.root, 'partA')), false, 'partA 回收站条目已删');
  t.assert.ok(exists(path.join(ctx.trash.root, 'partB')), '未删条目 partB 仍在回收站');
});
