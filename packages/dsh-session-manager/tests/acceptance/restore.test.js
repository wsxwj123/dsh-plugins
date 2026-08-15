// restore.test.js — /sm/restore 验收测试
// 覆盖：正常恢复、非法 id、回收站无记录 not-in-trash、原路径被占不覆盖、幂等、system-error。
import { test, before, after, createTestContext, assertCode, exists, path, fs } from './helpers.js';

let ctx;
const proj = 'main';

before(async () => { ctx = await createTestContext(); });
after(async () => { await ctx.server.close(); ctx.cleanup(); });

async function deleteAndRestoreSetup(id, title) {
  const s = ctx.newSession(proj, id);
  await ctx.server.call('delete', { id, cwd: proj, title: title || `会话-${id}` });
  return s;
}

// ---------- 正常路径 ----------
test('F1 撤销：/sm/restore 200 ok，目录移回原位，回收站清空该条目', async (t) => {
  const s = ctx.newSession(proj, 'sess-rev');
  await ctx.server.call('delete', { id: 'sess-rev', cwd: proj });
  const res = await ctx.server.call('restore', { id: 'sess-rev' });
  assertCode(t, res, 200, null);
  t.assert.ok(exists(s.dir), '恢复后原目录应存在');
  t.assert.ok(exists(path.join(s.dir, 'session.jsonl.zstd')), '会话正文 marker 回原位');
  t.assert.equal(exists(path.join(ctx.trash.root, 'sess-rev')), false, '回收站不再含该条目');
});

test('F1 撤销后 /sm/trash 不再列出该 id（回收站状态回读）', async (t) => {
  const s = ctx.newSession(proj, 'sess-trash-chk');
  await ctx.server.call('delete', { id: 'sess-trash-chk', cwd: proj });
  const before = await ctx.server.call('trash');
  t.assert.ok(before.json.items.some((i) => i.id === 'sess-trash-chk'), '删除后应在回收站清单');
  await ctx.server.call('restore', { id: 'sess-trash-chk' });
  const after = await ctx.server.call('trash');
  t.assert.ok(!after.json.items.some((i) => i.id === 'sess-trash-chk'), '恢复后回收站清单不含该条目');
});

// ---------- 边界：非法 id ----------
test('边界 restore 非法 id → 400 invalid-id', async (t) => {
  for (const id of ['', 'a/b', '..', 'x\ny']) {
    const res = await ctx.server.call('restore', { id });
    assertCode(t, res, 400, 'invalid-id');
  }
  const resBad = await ctx.server.call('restore', { id: 5 });
  assertCode(t, resBad, 400, 'invalid-id');
});

test('边界 非对象 body → 400', async (t) => {
  const res = await ctx.server.rawCall('restore', '"x"');
  assertCode(t, res, 400, 'bad-request');
});

// ---------- 错误路径 ----------
test('错误 回收站无该 id 记录（从未删除/已清空）→ 200 not-in-trash', async (t) => {
  const res = await ctx.server.call('restore', { id: 'never-deleted' });
  assertCode(t, res, 200, 'not-in-trash');
});

test('错误 回收站无记录但磁盘残留目录 → 仍 not-in-trash（以记录为准）', async (t) => {
  // 造一个只有回收站目录、没有记录的"孤儿"：应判 not-in-trash，不移动
  fs.mkdirSync(path.join(ctx.trash.root, 'orphan'), { recursive: true });
  const res = await ctx.server.call('restore', { id: 'orphan' });
  assertCode(t, res, 200, 'not-in-trash');
  t.assert.ok(exists(path.join(ctx.trash.root, 'orphan')), '孤儿目录不应被动');
});

// ---------- 反向：不覆盖 ----------
test('F1 反向 原路径已被占 → 200 restore-target-exists，绝不覆盖既有目录', async (t) => {
  const s = ctx.newSession(proj, 'sess-collide');
  await ctx.server.call('delete', { id: 'sess-collide', cwd: proj });
  // 原路径被一个"新会话"重新占用（含不同内容）
  const occupant = ctx.newSession(proj, 'sess-collide', { content: 'NEW_SESSION\n' });
  const res = await ctx.server.call('restore', { id: 'sess-collide' });
  assertCode(t, res, 200, 'restore-target-exists');
  t.assert.ok(exists(path.join(ctx.trash.root, 'sess-collide')), '回收站条目保留（未移动）');
  t.assert.equal(
    fs.readFileSync(path.join(occupant.dir, 'session.jsonl.zstd'), 'utf8'),
    'NEW_SESSION\n',
    '被占原路径的既有内容不被覆盖'
  );
});

// ---------- 幂等 ----------
test('幂等 重复 restore（已恢复）→ 第二次 200 not-in-trash（以回收站记录为准）', async (t) => {
  const s = ctx.newSession(proj, 'sess-idem-rev');
  await ctx.server.call('delete', { id: 'sess-idem-rev', cwd: proj });
  const r1 = await ctx.server.call('restore', { id: 'sess-idem-rev' });
  assertCode(t, r1, 200, null);
  const r2 = await ctx.server.call('restore', { id: 'sess-idem-rev' });
  assertCode(t, r2, 200, 'not-in-trash');
  t.assert.ok(exists(s.dir), '重复恢复不产生重复副作用');
});

test('并发 对同一 id 并发 restore 两次 → 都返回判定结果，最终目录恰好恢复一次', async (t) => {
  const s = ctx.newSession(proj, 'sess-conc-rev');
  await ctx.server.call('delete', { id: 'sess-conc-rev', cwd: proj });
  const [a, b] = await Promise.all([
    ctx.server.call('restore', { id: 'sess-conc-rev' }),
    ctx.server.call('restore', { id: 'sess-conc-rev' }),
  ]);
  // 一个 ok，另一个 not-in-trash 或 restore-target-exists（host 操作链串行，无重复副作用）
  t.assert.ok((a.status === 200) && (b.status === 200), '两次都 HTTP 200');
  const okCount = [a, b].filter((r) => r.json && r.json.ok === true).length;
  t.assert.equal(okCount, 1, '恰好一次恢复成功');
  t.assert.ok(exists(s.dir), '原目录恢复');
});

// ---------- system-error ----------
test('错误 restore 回收站条目目录丢失、但有记录 → 200 system-error，不改状态可重试', async (t) => {
  const s = ctx.newSession(proj, 'sess-lost-trash');
  await ctx.server.call('delete', { id: 'sess-lost-trash', cwd: proj });
  fs.rmSync(path.join(ctx.trash.root, 'sess-lost-trash'), { recursive: true, force: true });
  const res = await ctx.server.call('restore', { id: 'sess-lost-trash' });
  assertCode(t, res, 200, 'system-error');
  // 重试仍 system-error（记录仍在、对象目录持续缺失），未恢复
  const res2 = await ctx.server.call('restore', { id: 'sess-lost-trash' });
  assertCode(t, res2, 200, 'system-error');
});
