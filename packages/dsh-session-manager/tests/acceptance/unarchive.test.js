// unarchive.test.js — /sm/unarchive 验收测试
// 覆盖：正常取消归档、非归档 id 幂等 no-op、非法 id、存储域不可用、存储写失败、保留其他字段。
import { test, before, after, createTestContext, assertCode } from './helpers.js';

let ctx;

before(async () => { ctx = await createTestContext({ archived: ['a1', 'a2', '中文归档'] }); });
after(async () => { await ctx.server.close(); ctx.cleanup(); });

// ---------- 正常路径 ----------
test('F2 正常取消归档 → 200 ok，该 id 从 archivedSessionIds 移除，其他字段保留', async (t) => {
  const res = await ctx.server.call('unarchive', { id: 'a1' });
  assertCode(t, res, 200, null);
  const arch = ctx.workspace.archived();
  t.assert.ok(!arch.includes('a1'), 'a1 已移除');
  t.assert.ok(arch.includes('a2') && arch.includes('中文归档'), '其他归档条目保留');
  const g = ctx.workspace.read();
  t.assert.equal(g.initialized, true, 'initialized 字段保留');
  t.assert.deepEqual(g.workspaceIds, ['main'], 'workspaceIds 字段保留');
});

test('F2 取消归档中文 id → 200 ok', async (t) => {
  const res = await ctx.server.call('unarchive', { id: '中文归档' });
  assertCode(t, res, 200, null);
  t.assert.ok(!ctx.workspace.archived().includes('中文归档'));
});

// ---------- 幂等 ----------
test('F2 幂等 取消归档一个不在集合中的 id → 200 ok（no-op，不报错）', async (t) => {
  const res = await ctx.server.call('unarchive', { id: 'never-archived' });
  assertCode(t, res, 200, null);
});

test('F2 幂等 对同一 id 重复取消 → 每次 200 ok', async (t) => {
  // a2 仍在
  const r1 = await ctx.server.call('unarchive', { id: 'a2' });
  assertCode(t, r1, 200, null);
  const r2 = await ctx.server.call('unarchive', { id: 'a2' });
  assertCode(t, r2, 200, null);
  t.assert.ok(!ctx.workspace.archived().includes('a2'));
});

// ---------- 边界：非法 id ----------
test('边界 unarchive 非法 id → 400 invalid-id', async (t) => {
  for (const id of ['', 'x/y', '..', 'a\nb', 7, null, ['x']]) {
    const res = await ctx.server.call('unarchive', { id });
    assertCode(t, res, 400, 'invalid-id');
  }
});

test('边界 unarchive 非对象 body → 400', async (t) => {
  const res = await ctx.server.rawCall('unarchive', '"str"');
  assertCode(t, res, 400, 'bad-request');
});

// ---------- 依赖不可用 ----------
test('错误 存储域不可用 → 200 workspace-domain-unavailable，未写任何状态', async (t) => {
  const c = await createTestContext({ archived: ['na-1'] });
  try {
    const before = c.workspace.read();
    c.makeDomainUnavailable();
    const res = await c.server.call('unarchive', { id: 'na-1' });
    assertCode(t, res, 200, 'workspace-domain-unavailable');
    t.assert.ok(c.workspace.archived().includes('na-1'), '集合未被改动');
    t.assert.deepEqual(c.workspace.read(), before, '域不可用不改任何状态');
  } finally {
    await c.server.close();
    c.cleanup();
  }
});

test('错误 存储写失败 → 200 system-error，未改集合可重试', async (t) => {
  const c = await createTestContext({ archived: ['wf-1'] });
  try {
    c.makeStorageWriteFail();
    const res = await c.server.call('unarchive', { id: 'wf-1' });
    assertCode(t, res, 200, 'system-error');
    t.assert.ok(c.workspace.archived().includes('wf-1'), '写失败时集合保持原样');
    c.cfg.state.storageWriteFail = false;
    const res2 = await c.server.call('unarchive', { id: 'wf-1' });
    assertCode(t, res2, 200, null);
    t.assert.ok(!c.workspace.archived().includes('wf-1'), '重试成功');
  } finally {
    await c.server.close();
    c.cleanup();
  }
});
