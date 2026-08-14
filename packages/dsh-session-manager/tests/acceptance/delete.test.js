// delete.test.js — /sm/delete 验收测试
// 覆盖：正常主路径、非法 id 边界、cwd/title 校验、路径越界、运行中护栏、
//       源目录缺失、fence 403、system-error、归档会话两步删除与 partial-failure、幂等。
import { test, before, after, createTestContext, assertCode, exists, path, fs } from './helpers.js';

let ctx;
const proj = 'main-workspace';

before(async () => { ctx = await createTestContext(); });
after(async () => { await ctx.server.close(); ctx.cleanup(); });

// ---------- 正常路径 ----------
test('F1 删除普通会话：200 ok:true，目录移入回收站，原位消失', async (t) => {
  const s = ctx.newSession(proj, 'sess-normal');
  const res = await ctx.server.call('delete', { id: 'sess-normal', cwd: proj, title: '日常会话' });
  assertCode(t, res, 200, null);
  t.assert.equal(exists(s.dir), false, '原会话目录应被移走');
  t.assert.ok(exists(path.join(ctx.trash.root, 'sess-normal')), '回收站根下应出现该 id 目录');
  t.assert.ok(exists(path.join(ctx.trash.root, 'sess-normal', 'session.jsonl.zstd')), '整目录（含会话正文 marker）应被移动');
});

test('F1 删除含 session-local artifacts 的整个目录：artifacts 一并移动', async (t) => {
  const s = ctx.newSession(proj, 'sess-with-artifacts');
  fs.writeFileSync(path.join(s.dir, 'local-artifact.bin'), 'b0');
  const res = await ctx.server.call('delete', { id: 'sess-with-artifacts', cwd: proj });
  assertCode(t, res, 200, null);
  t.assert.ok(exists(path.join(ctx.trash.root, 'sess-with-artifacts', 'local-artifact.bin')), '目录内附属文件整体移动');
});

test('F1 缺省 cwd 也能删除（回落到 sessions 根下直接按 id 定位）', async (t) => {
  const s = ctx.newSession('', 'sess-no-cwd');
  const res = await ctx.server.call('delete', { id: 'sess-no-cwd' });
  assertCode(t, res, 200, null);
  t.assert.equal(exists(s.dir), false);
});

test('F1 删除后会话不在归档集合中时无副作用（普通会话不写归档）', async (t) => {
  const s = ctx.newSession(proj, 'sess-plain');
  const beforeArchive = [...ctx.workspace.archived()];
  await ctx.server.call('delete', { id: 'sess-plain', cwd: proj });
  const afterArchive = ctx.workspace.archived();
  t.assert.deepEqual(afterArchive, beforeArchive, '普通会话删除不应改动归档集合');
});

// ---------- 边界：非法 id ----------
test('边界 非法 id 一律 400 invalid-id（空串/./无法定位/含分隔符/控制字符）', async (t) => {
  const bad = ['', '.', '..', 'a/b', '../etc', 'a\\b', 'a\nb', 'a\tb', 'a\u0000b', 'a\rb'];
  for (const id of bad) {
    const res = await ctx.server.call('delete', { id });
    assertCode(t, res, 400, 'invalid-id');
  }
});

test('边界 id 非字符串类型 → 400 invalid-id', async (t) => {
  for (const id of [123, null, {}, ['x'], true]) {
    const res = await ctx.server.call('delete', { id });
    assertCode(t, res, 400, 'invalid-id');
  }
});

test('边界 id 为 Unicode/中文（契约未禁止）→ 视为合法，可删除', async (t) => {
  const id = '会话-中文-测试';
  const s = ctx.newSession(proj, id);
  const res = await ctx.server.call('delete', { id, cwd: proj });
  assertCode(t, res, 200, null);
  t.assert.equal(exists(s.dir), false, '中文会话目录应被移走');
  t.assert.ok(exists(path.join(ctx.trash.root, id)), '回收站含中文 id 目录');
});

// ---------- 边界：cwd / title 校验 ----------
test('边界 cwd 非字符串 → 400 invalid-cwd', async (t) => {
  const res = await ctx.server.call('delete', { id: 'x', cwd: 42 });
  assertCode(t, res, 400, 'invalid-cwd');
});

test('边界 title 非字符串 → 400 invalid-title', async (t) => {
  const res = await ctx.server.call('delete', { id: 'x', title: 99 });
  assertCode(t, res, 400, 'invalid-title');
});

test('边界 title 超长(>256) → 400 invalid-title', async (t) => {
  const res = await ctx.server.call('delete', { id: 'x', title: 'a'.repeat(257) });
  assertCode(t, res, 400, 'invalid-title');
});

test('边界 title 恰好 256 → 合法', async (t) => {
  const s = ctx.newSession(proj, 'sess-title256');
  const res = await ctx.server.call('delete', { id: 'sess-title256', cwd: proj, title: 'a'.repeat(256) });
  assertCode(t, res, 200, null);
});

// ---------- 错误路径 ----------
test('错误 缺 body → 400 bad-request', async (t) => {
  const res = await ctx.server.call('delete', undefined);
  assertCode(t, res, 400, 'bad-request');
});

test('错误 body 非法 JSON → 400 bad-request，且不做任何移动', async (t) => {
  const s = ctx.newSession(proj, 'sess-badjson');
  const res = await ctx.server.rawCall('delete', '{ id: "broken', {});
  assertCode(t, res, 400, 'bad-request');
  t.assert.ok(exists(s.dir), '非法 JSON 不应移动任何文件');
});

test('错误 body 为数组/标量 → 400 bad-request', async (t) => {
  const s = ctx.newSession(proj, 'sess-badbody');
  const res1 = await ctx.server.rawCall('delete', '[1,2,3]');
  assertCode(t, res1, 400, 'bad-request');
  const res2 = await ctx.server.rawCall('delete', '"plain-string"');
  assertCode(t, res2, 400, 'bad-request');
  const res3 = await ctx.server.rawCall('delete', '42');
  assertCode(t, res3, 400, 'bad-request');
  t.assert.ok(exists(s.dir), '错误 body 不移动文件');
});

test('错误 源会话目录不存在 → 200 ok:false session-dir-not-found（非幂等完成态）', async (t) => {
  const res = await ctx.server.call('delete', { id: 'ghost-会话', cwd: proj });
  assertCode(t, res, 200, 'session-dir-not-found');
  t.assert.equal(exists(path.join(ctx.trash.root, 'ghost-会话')), false, '不产生回收站条目');
});

test('错误 cwd 无法定位项目目录 → 200 ok:false session-dir-not-found', async (t) => {
  const res = await ctx.server.call('delete', { id: 'sess-x', cwd: '' });
  assertCode(t, res, 200, 'session-dir-not-found');
});

test('错误 运行中会话被删除 → 200 ok:false session-running，host 拒移（不靠 client）', async (t) => {
  const s = ctx.newSession(proj, 'sess-running');
  ctx.live('sess-running');
  const res = await ctx.server.call('delete', { id: 'sess-running', cwd: proj });
  assertCode(t, res, 200, 'session-running');
  t.assert.ok(exists(s.dir), '运行中会话目录不得移动');
  t.assert.equal(exists(path.join(ctx.trash.root, 'sess-running')), false, '不得进入回收站');
});

test('错误 未过信任 fence → 403，且不做任何移动', async (t) => {
  const s = ctx.newSession(proj, 'sess-forbidden');
  const res = await ctx.server.call('delete', { id: 'sess-forbidden', cwd: proj }, { host: 'not-local.tld' });
  assertCode(t, res, 403, null);
  t.assert.ok(exists(s.dir), '403 来源不可信，文件不得移动');
});

// ---------- 路径越界 ----------
test('错误 id 含 encodeSegment 逃逸字符（越界前置） → 200 ok:false path-out-of-bounds 不做移动', async (t) => {
  // 用含 % 或空格段映射差异的 id（契约：encodeSegment(id) !== id 即拒绝）
  const id = 'a%2F..';
  const s = ctx.newSession(proj, id);
  const res = await ctx.server.call('delete', { id, cwd: proj });
  assertCode(t, res, 200, 'path-out-of-bounds');
  t.assert.ok(exists(s.dir), '越界 id 不得移动真实目录');
});

test('错误 cwd 解析落在 sessions 根之外 → 200 ok:false path-out-of-bounds 不做移动', async (t) => {
  // projectCwdMap 模拟 cwd 映射到 sessions 根之外
  const outside = `${ctx.tmpRoot}/outside-place`;
  ctx.projectCwdMap['/etc/yolo'] = outside;
  const res = await ctx.server.call('delete', { id: 'sess-x', cwd: '/etc/yolo' });
  assertCode(t, res, 200, 'path-out-of-bounds');
  t.assert.equal(exists(path.join(ctx.trash.root, 'sess-x')), false, '越界不得移动');
});

// ---------- 归档会话：两步删除 ----------
test('F2 删除归档会话（两步）：文件移入回收站 + 从 archivedSessionIds 移除，200 ok', async (t) => {
  const s = ctx.newSession(proj, 'sess-archived-del');
  ctx.workspace.setArchived(['sess-archived-del', 'keep-me']);
  const res = await ctx.server.call('delete', { id: 'sess-archived-del', cwd: proj });
  assertCode(t, res, 200, null);
  t.assert.equal(exists(s.dir), false, '文件已移走');
  const arch = ctx.workspace.archived();
  t.assert.ok(!arch.includes('sess-archived-del'), '归档集合应移除该 id');
  t.assert.ok(arch.includes('keep-me'), '归档集合其他条目保留');
});

test('partial-failure 删除归档会话第二步失败 → 200 system-error，但文件已移走、集合待重试', async (t) => {
  const s = ctx.newSession(proj, 'sess-partial');
  ctx.workspace.setArchived(['sess-partial']);
  ctx.makeStorageWriteFail();
  const res = await ctx.server.call('delete', { id: 'sess-partial', cwd: proj });
  assertCode(t, res, 200, 'system-error');
  t.assert.equal(exists(s.dir), false, '文件已移走（partial-failure 中间态）');
  t.assert.ok(ctx.workspace.archived().includes('sess-partial'), '归档集合仍含该 id（中间态）');
  ctx.cfg.state.storageWriteFail = false; // 复位供其他用例
});

test('partial-failure 后重试 delete → 幂等跳第一步、补齐归档清理，200 ok', async (t) => {
  const s = ctx.newSession(proj, 'sess-retry');
  ctx.workspace.setArchived(['sess-retry']);
  ctx.makeStorageWriteFail();
  await ctx.server.call('delete', { id: 'sess-retry', cwd: proj }); // 第一步成功，第二步失败
  // 恢复存储可用，重试
  ctx.cfg.state.storageWriteFail = false;
  const res2 = await ctx.server.call('delete', { id: 'sess-retry', cwd: proj });
  assertCode(t, res2, 200, null);
  t.assert.equal(exists(s.dir), false);
  t.assert.ok(!ctx.workspace.archived().includes('sess-retry'), '重试后归档集合已清理');
});

// ---------- 幂等 / 并发 ----------
test('幂等 重复 delete（已移走）→ 第二次仍 200 ok，不报错不重复副作用', async (t) => {
  const s = ctx.newSession(proj, 'sess-idem');
  const r1 = await ctx.server.call('delete', { id: 'sess-idem', cwd: proj });
  assertCode(t, r1, 200, null);
  const r2 = await ctx.server.call('delete', { id: 'sess-idem', cwd: proj });
  assertCode(t, r2, 200, null);
  t.assert.equal(exists(s.dir), false);
});

test('并发 对同一个归档会话并发 delete 两次 → 都 200 ok，最终文件在回收站且集合只清一次', async (t) => {
  const s = ctx.newSession(proj, 'sess-conc');
  ctx.workspace.setArchived(['sess-conc']);
  const [a, b] = await Promise.all([
    ctx.server.call('delete', { id: 'sess-conc', cwd: proj }),
    ctx.server.call('delete', { id: 'sess-conc', cwd: proj }),
  ]);
  // 两次都必须 ok（第二次幂等）
  t.assert.equal(a.status, 200);
  t.assert.equal(b.status, 200);
  t.assert.ok(a.json && a.json.ok === true);
  t.assert.ok(b.json && b.json.ok === true);
  t.assert.equal(exists(s.dir), false);
  t.assert.ok(!ctx.workspace.archived().includes('sess-conc'));
});

// ---------- 用户没想到的 ----------
test('用户没想到 中文/空格会话目录名可正常删除（回收站路径合法）', async (t) => {
  for (const id of ['含空格 会话', '中文会话文件']) {
    const s = ctx.newSession(proj, id);
    const res = await ctx.server.call('delete', { id, cwd: proj });
    assertCode(t, res, 200, null);
    t.assert.equal(exists(s.dir), false);
    t.assert.ok(exists(path.join(ctx.trash.root, id)), `回收站含 ${JSON.stringify(id)}`);
  }
});

test('用户没想到 会话标题远长于 id 也无碍（title 仅作展示）', async (t) => {
  const s = ctx.newSession(proj, 'sess-longtitle');
  const res = await ctx.server.call('delete', { id: 'sess-longtitle', cwd: proj, title: '很长的标题 '.repeat(20) });
  assertCode(t, res, 200, null);
});
