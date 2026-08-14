// auth.test.js — /sm/* 信任 fence 反向用例（403）
// 覆盖：非本机 Host、跨源 Sec-Fetch-Site、跨源 Origin → 一律 403，且不触发任何文件移动/写入。
// 每个端点（delete/restore/emptyTrash/unarchive/trash）都套同一 fence。
import { test, before, after, createTestContext, assertCode, exists, path } from './helpers.js';

let ctx;
const proj = 'auth';

before(async () => { ctx = await createTestContext(); });
after(async () => { await ctx.server.close(); ctx.cleanup(); });

// 可信来源（同源 loopback）→ 应通过 fence
test('正向 同源 loopback（本地 Host）→ 通过 fence，请求可达业务分支', async (t) => {
  const res = await ctx.server.call('trash', undefined, {});
  t.assert.equal(res.status, 200, '同源 loopback 应通过 fence');
});

// 反向：非本机 Host → 403
test('反向 非本机 Host（evil.example）→ 403，delete 不移动文件', async (t) => {
  const s = ctx.newSession(proj, 'sess-badhost');
  const res = await ctx.server.call('delete', { id: 'sess-badhost', cwd: proj }, { host: 'evil.example' });
  assertCode(t, res, 403, null);
  t.assert.ok(exists(s.dir), '403 不移动文件');
  t.assert.equal(exists(path.join(ctx.trash.root, 'sess-badhost')), false, '不进入回收站');
});

// 反向：跨源 Sec-Fetch-Site → 403
test('反向 跨源（Sec-Fetch-Site: cross-site）→ 403', async (t) => {
  const s = ctx.newSession(proj, 'sess-crosssite');
  const res = await ctx.server.call('delete', { id: 'sess-crosssite', cwd: proj }, { 'sec-fetch-site': 'cross-site' });
  assertCode(t, res, 403, null);
  t.assert.ok(exists(s.dir), '403 不移动文件');
});

// 反向：跨源 Origin → 403
test('反向 跨源 Origin（https://evil.example）→ 403', async (t) => {
  const res = await ctx.server.call('emptyTrash', { confirm: true }, { origin: 'https://evil.example' });
  assertCode(t, res, 403, null);
});

// 反向：403 对 emptyTrash 优先于 confirm 校验（403 先行，即使带 confirm:true）
test('403 对 emptyTrash 优先于 confirm:true（403 仍先行）', async (t) => {
  ctx.newSession(proj, 'sess-empty');
  await ctx.server.call('delete', { id: 'sess-empty', cwd: proj });
  const res = await ctx.server.call('emptyTrash', { confirm: true }, { 'sec-fetch-site': 'cross-site' });
  assertCode(t, res, 403, null);
  t.assert.ok(exists(path.join(ctx.trash.root, 'sess-empty')), '带 confirm:true 的跨源请求仍被 403，不清空');
});

// 反向：403 后普通 delete 语义恢复（fence 是逐请求的，不污染后续）
test('fence 逐请求判定：一次 403 不影响下一次同源请求', async (t) => {
  const s = ctx.newSession(proj, 'sess-after403');
  await ctx.server.call('delete', { id: 'sess-badhost', cwd: proj }, { host: 'evil.example' }); // 403
  const res = await ctx.server.call('delete', { id: 'sess-after403', cwd: proj }, {});
  assertCode(t, res, 200, null);
  t.assert.equal(exists(s.dir), false, '同源请求正常删除');
});

// 反向：restore 也套 fence
test('反向 非本机 Host 的 restore → 403，回收站条目不动', async (t) => {
  const s = ctx.newSession(proj, 'sess-rev-fence');
  await ctx.server.call('delete', { id: 'sess-rev-fence', cwd: proj });
  const res = await ctx.server.call('restore', { id: 'sess-rev-fence' }, { host: '198.18.2.1' });
  assertCode(t, res, 403, null);
  t.assert.ok(!exists(s.dir), '403 不恢复');
  t.assert.ok(exists(path.join(ctx.trash.root, 'sess-rev-fence')), '条目仍在回收站');
});

// 反向：未知 /sm/method → 404（非 fence 场景；未知方法不应被误当 403）
test('未知 /sm/<method> → 404 而非 403', async (t) => {
  const res = await ctx.server.rawCall('nonexistent', '{}');
  t.assert.equal(res.status, 404, '未知方法返回 404');
});
