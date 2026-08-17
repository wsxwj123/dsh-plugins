/**
 * M1–M5 (中) + L2 (低) — /sm 契约面与部署形态。
 *
 * M1 restore 不校验 record（originalDir 越界 + 结构缺字段）
 * M2 sessions root 硬编码 ~/.dsh/sessions，无视 DSH_HOME
 * M3 marker 只认 session.jsonl.zstd，compression:'none' 部署全删不动
 * M4 workspace 域“没打开”被当成“没归档”（与 unarchive 口径不一致）
 * M5 已删会话在 host 回收站没有凭据 → 下次对账又冒出来（幽灵行）
 * L2 /sm/trash 的 deadline 字段装的是 deletedAt，回收站永不过期
 */
import { test } from 'node:test'
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { loadSrc, tmpdir, rmrf, makeCtx, postRoute, tick } from './_harness.mjs'
import { makeEnv, SESSION_MARKER, projectKey, encodeSegment } from './_env.mjs'

const { resolveRoots, apply } = await loadSrc('src/index.ts')
const { createPendingDeletes, memoryStorage } = await loadSrc('src/client/pendingDeletesCore.ts')

/** 允许的拒绝码集合：报告没有钉死码名，但必须是一次明确的拒绝。 */
const REFUSAL_CODES = ['path-out-of-bounds', 'invalid-record', 'not-in-trash', 'system-error']

// ---- M1 ----

test('M1: record 的 originalDir 被改成 sessions root 之外时 /sm/restore 必须拒绝', async () => {
  const env = makeEnv()
  try {
    env.newSession('/proj', 's1')
    assert.strictEqual((await env.call('delete', { id: 's1', cwd: '/proj', title: 's1' })).json.ok, true)

    // 磁盘上的 record 是普通 JSON，任何本机进程都能改写它。
    const outside = path.join(env.base, 'outside', 'target')
    const recPath = env.trash.recordPath('s1')
    const rec = JSON.parse(fs.readFileSync(recPath, 'utf8'))
    rec.originalDir = outside
    fs.writeFileSync(recPath, JSON.stringify(rec))

    const res = await env.call('restore', { id: 's1' })
    assert.strictEqual(res.json.ok, false, 'restore 必须像 delete 一样做边界门')
    assert.ok(REFUSAL_CODES.includes(res.json.code), `拒绝码应属于 ${REFUSAL_CODES.join('/')}，实际 ${res.json.code}`)
    assert.strictEqual(fs.existsSync(outside), false, '绝不能 mkdir + rename 到 sessions root 之外')
    assert.strictEqual(env.trash.hasItem('s1'), true, '拒绝后条目必须仍在回收站里')
  } finally {
    env.cleanup()
  }
})

test('M1: 结构不合法的 record（缺字段）必须被拒绝，而不是抛 TypeError', async () => {
  const env = makeEnv()
  try {
    fs.writeFileSync(env.trash.recordPath('s2'), '{}')
    let res
    try {
      res = await env.call('restore', { id: 's2' })
    } catch (err) {
      assert.fail(`缺字段的 record 必须走结构化拒绝，不能抛异常：${err}`)
    }
    assert.strictEqual(res.json.ok, false)
    assert.ok(REFUSAL_CODES.includes(res.json.code), `拒绝码应属于 ${REFUSAL_CODES.join('/')}，实际 ${res.json.code}`)
  } finally {
    env.cleanup()
  }
})

test('M1: record 里的 id 与请求 id 不一致时 /sm/restore 必须拒绝', async () => {
  const env = makeEnv()
  try {
    const dirA = env.newSession('/proj', 'victim')
    await env.call('delete', { id: 'victim', cwd: '/proj', title: 'victim' })
    // 攻击/损坏形态：请求 id 'decoy' 的 record 指向 victim 的条目。
    fs.writeFileSync(
      env.trash.recordPath('decoy'),
      JSON.stringify({ id: 'victim', originalDir: dirA, title: null, deletedAt: Date.now(), projectKey: 'proj' }),
    )
    const res = await env.call('restore', { id: 'decoy' })
    assert.strictEqual(res.json.ok, false, 'record.id 必须与请求 id 一致')
    assert.strictEqual(env.trash.hasItem('victim'), true, 'victim 的条目不得被 decoy 请求搬走')
  } finally {
    env.cleanup()
  }
})

test('M1-相邻: 正常 record 的 /sm/restore 仍然成功还原', async () => {
  const env = makeEnv()
  try {
    const dir = env.newSession('/proj', 'ok1')
    await env.call('delete', { id: 'ok1', cwd: '/proj', title: 'ok1' })
    assert.strictEqual(fs.existsSync(dir), false)
    const res = await env.call('restore', { id: 'ok1' })
    assert.strictEqual(res.json.ok, true)
    assert.strictEqual(fs.existsSync(path.join(dir, SESSION_MARKER)), true, '目录连内容一起回到原位')
    assert.strictEqual(env.trash.hasRecord('ok1'), false, 'record 清理')
  } finally {
    env.cleanup()
  }
})

test('M1-相邻: 原位置被占用时仍返回 restore-target-exists 且不覆盖', async () => {
  const env = makeEnv()
  try {
    const dir = env.newSession('/proj', 'occ')
    await env.call('delete', { id: 'occ', cwd: '/proj', title: 'occ' })
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, SESSION_MARKER), 'NEW')
    const res = await env.call('restore', { id: 'occ' })
    assert.strictEqual(res.json.ok, false)
    assert.strictEqual(res.json.code, 'restore-target-exists')
    assert.strictEqual(fs.readFileSync(path.join(dir, SESSION_MARKER), 'utf8'), 'NEW', '不得覆盖新内容')
  } finally {
    env.cleanup()
  }
})

// ---- M2 ----

test('M2: sessions root 必须跟随 $DSH_HOME（自定义部署下否则全删不动）', () => {
  const prev = process.env.DSH_HOME
  const fake = tmpdir('dsh-home')
  try {
    process.env.DSH_HOME = fake
    const { sessionsRoot } = resolveRoots({})
    assert.strictEqual(sessionsRoot, path.join(fake, 'sessions'), 'DSH home 优先级：显式配置 > $DSH_HOME > ~/.dsh')
  } finally {
    if (prev === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = prev
    rmrf(fake)
  }
})

test('M2-相邻: 显式 config.sessionsRoot 仍然优先于 $DSH_HOME', () => {
  const prev = process.env.DSH_HOME
  const fake = tmpdir('dsh-home2')
  try {
    process.env.DSH_HOME = fake
    const { sessionsRoot } = resolveRoots({ sessionsRoot: '/explicit/sessions' })
    assert.strictEqual(sessionsRoot, '/explicit/sessions')
  } finally {
    if (prev === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = prev
    rmrf(fake)
  }
})

test('M2-相邻: 没有 $DSH_HOME 时仍回落到 ~/.dsh/sessions', () => {
  const prev = process.env.DSH_HOME
  try {
    delete process.env.DSH_HOME
    const { sessionsRoot, trashRoot } = resolveRoots({})
    assert.strictEqual(sessionsRoot, path.join(os.homedir(), '.dsh', 'sessions'))
    assert.strictEqual(trashRoot, path.join(os.homedir(), '.dsh', 'session-manager-trash'))
  } finally {
    if (prev !== undefined) process.env.DSH_HOME = prev
  }
})

// ---- M3 ----

test("M3: compression:'none' 部署（session.jsonl）的会话必须能删除", async () => {
  const env = makeEnv()
  try {
    env.newSession('/proj', 'p1', 'session.jsonl')
    const res = await env.call('delete', { id: 'p1', cwd: '/proj', title: 'p1' })
    assert.strictEqual(res.json.ok, true, 'plaintext 模式的 marker 也是会话标记')
    assert.strictEqual(env.trash.hasItem('p1'), true)
  } finally {
    env.cleanup()
  }
})

test('M3-相邻: 压缩模式（session.jsonl.zstd）仍然可删', async () => {
  const env = makeEnv()
  try {
    env.newSession('/proj', 'z1')
    const res = await env.call('delete', { id: 'z1', cwd: '/proj', title: 'z1' })
    assert.strictEqual(res.json.ok, true)
    assert.strictEqual(env.trash.hasItem('z1'), true)
  } finally {
    env.cleanup()
  }
})

test('M3-相邻: 完全没有 marker 的同名目录仍然被拒（not-a-session）', async () => {
  const env = makeEnv()
  try {
    env.newSession('/proj', 'nope', null)
    const res = await env.call('delete', { id: 'nope', cwd: '/proj', title: 'nope' })
    assert.strictEqual(res.json.ok, false)
    assert.strictEqual(res.json.code, 'not-a-session', '非会话目录绝不能被搬进回收站')
    assert.strictEqual(env.trash.hasItem('nope'), false)
  } finally {
    env.cleanup()
  }
})

// ---- M4（走 src/index.ts 的 readGlobal，只能从路由层驱动）----

function applyEnv(services) {
  const base = tmpdir('m4')
  const sessionsRoot = path.join(base, 'sessions')
  const trashRoot = path.join(base, 'trash')
  const dir = path.join(sessionsRoot, projectKey('/proj'), encodeSegment('p1'))
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, SESSION_MARKER), 'DUMMY')
  const { ctx, routes, warnings } = makeCtx(services)
  apply(ctx, { sessionsRoot, trashRoot })
  return { base, dir, routes, warnings, cleanup: () => rmrf(base) }
}

test('M4: workspace 域未打开时删除不得报纯 ok（“没打开”≠“没归档”）', async () => {
  const env = applyEnv({ storageDomain: { get: () => null } })
  try {
    assert.strictEqual(env.routes.length, 1)
    const res = await postRoute(env.routes[0], 'delete', { id: 'p1', cwd: '/proj', title: 'p1' })
    assert.strictEqual(res.json.ok, false, '归档状态未知时必须走可重试分支，而不是宣布成功')
    assert.strictEqual(res.json.moved, true, '文件已移走 → moved:true，让 client 保持隐藏并可重试')
    assert.strictEqual(fs.existsSync(env.dir), false, '文件确实已经移走')
  } finally {
    env.cleanup()
  }
})

test('M4-相邻: workspace 域未打开时 /sm/unarchive 仍返回 workspace-domain-unavailable', async () => {
  const env = applyEnv({ storageDomain: { get: () => null } })
  try {
    const res = await postRoute(env.routes[0], 'unarchive', { id: 'p1' })
    assert.strictEqual(res.json.ok, false)
    assert.strictEqual(res.json.code, 'workspace-domain-unavailable')
  } finally {
    env.cleanup()
  }
})

test('M4-相邻: 域可读时路由层删除仍然返回 ok', async () => {
  const env = applyEnv({
    storageDomain: {
      get: () => ({ global: { get: () => ({ initialized: true, workspaceIds: ['main'], archivedSessionIds: [] }), set: () => Promise.resolve() } }),
    },
  })
  try {
    const res = await postRoute(env.routes[0], 'delete', { id: 'p1', cwd: '/proj', title: 'p1' })
    assert.strictEqual(res.status, 200)
    assert.strictEqual(res.json.ok, true)
  } finally {
    env.cleanup()
  }
})

// ---- M5（host 响应 + client 对账的联合行为）----

/** 把 /sm 响应映射成 pendingDeletes 需要的 FireOutcome。 */
function fireVia(env) {
  return async (entry) => {
    const res = await env.call('delete', { id: entry.id, cwd: entry.cwd, title: entry.title })
    return { ok: res.json.ok === true, code: res.json.code, moved: res.json.moved === true }
  }
}

test('M5: live-but-not-persisted 会话删除成功后，与 /sm/trash 对账不得让它重新冒出来', async () => {
  const env = makeEnv({ live: ['ghost1'] }) // 只在内存里、磁盘上从未落盘
  try {
    const pd = createPendingDeletes({ fire: fireVia(env), now: () => 0, schedule: () => () => {}, storage: memoryStorage() })
    pd.requestDelete('ghost1', '/proj', 'ghost')
    const outcome = await pd.fireNow('ghost1')
    assert.strictEqual(outcome.ok, true, 'host 把这种删除判为生效')
    assert.strictEqual(pd.isDeleted('ghost1'), true, '行被隐藏')

    const items = (await env.call('trash', {})).json.items
    pd.reconcileWithTrash(items.map((i) => i.id))
    assert.strictEqual(
      pd.isDeleted('ghost1'),
      true,
      '回收站里没有凭据 → 对账把已删会话解除隐藏，行又冒出来（需要 tombstone 或独立码）',
    )
  } finally {
    env.cleanup()
  }
})

test('M5-相邻: 真实落盘会话删除后对账仍然保持隐藏', async () => {
  const env = makeEnv()
  try {
    env.newSession('/proj', 'real1')
    const pd = createPendingDeletes({ fire: fireVia(env), now: () => 0, schedule: () => () => {}, storage: memoryStorage() })
    pd.requestDelete('real1', '/proj', 'real')
    await pd.fireNow('real1')
    await tick()
    const items = (await env.call('trash', {})).json.items
    assert.deepStrictEqual(items.map((i) => i.id), ['real1'])
    pd.reconcileWithTrash(items.map((i) => i.id))
    assert.strictEqual(pd.isDeleted('real1'), true)
  } finally {
    env.cleanup()
  }
})

// ---- L2 ----

test('L2: /sm/trash 条目必须给出真实删除时间 deletedAt', async () => {
  const env = makeEnv()
  try {
    env.newSession('/proj', 't1')
    await env.call('delete', { id: 't1', cwd: '/proj', title: '标题' })
    const item = (await env.call('trash', {})).json.items[0]
    const rec = env.trash.readRecord('t1')
    assert.strictEqual(item.deletedAt, rec.deletedAt, '删除时间必须以 deletedAt 的名字暴露')
  } finally {
    env.cleanup()
  }
})

test('L2: deadline 字段必须是真正的过期时间（严格晚于删除时间）', async () => {
  const env = makeEnv()
  try {
    env.newSession('/proj', 't2')
    await env.call('delete', { id: 't2', cwd: '/proj', title: '标题' })
    const item = (await env.call('trash', {})).json.items[0]
    const rec = env.trash.readRecord('t2')
    assert.ok(
      item.deadline === undefined || item.deadline > rec.deletedAt,
      `deadline 要么不出现，要么是 deletedAt + 保留期；当前 deadline=${item.deadline} 等于 deletedAt=${rec.deletedAt}（回收站永不过期）`,
    )
  } finally {
    env.cleanup()
  }
})

test('L2-相邻: /sm/trash 仍然只暴露 id/title，绝不泄露 originalDir', async () => {
  const env = makeEnv()
  try {
    env.newSession('/proj', 't3')
    await env.call('delete', { id: 't3', cwd: '/proj', title: '标题' })
    const item = (await env.call('trash', {})).json.items[0]
    assert.strictEqual(item.id, 't3')
    assert.strictEqual(item.title, '标题')
    assert.strictEqual('originalDir' in item, false, '路径泄露门（INTERFACE §3.5 / F-1）')
    assert.strictEqual('projectKey' in item, false)
  } finally {
    env.cleanup()
  }
})
