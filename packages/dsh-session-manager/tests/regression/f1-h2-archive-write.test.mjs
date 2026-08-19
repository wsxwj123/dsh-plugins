/**
 * F1 (致命) + H2 (高) — the workspace archive write.
 *
 * F1: `domain.global.set()` returns a Promise (dsh-storage-domain
 *     types/domain.d.ts:28) that src/handler.ts:284/:359 neither awaits nor
 *     catches. Consequences: a failed/closed-domain write is reported as
 *     SUCCESS, and the floating rejection hits DSH's process-level
 *     unhandledRejection handler → the whole `dsh web` host exits(1).
 * H2: the domain's in-memory value updates only AFTER the durable write, so two
 *     writes that overlap both read the pre-write snapshot → the first one is
 *     silently reverted (lost update).
 */
import { test } from 'node:test'
import assert from 'node:assert'
import { tick } from './_harness.mjs'
import { makeEnv } from './_env.mjs'

test('F1: 归档写入失败时 /sm/unarchive 必须返回可重试错误，不能报成功', async () => {
  const env = makeEnv({ archivedSessionIds: ['a'], failWrite: true })
  try {
    const res = await env.call('unarchive', { id: 'a' })
    await tick()
    assert.strictEqual(res.json.ok, false, '写盘失败必须 ok:false（当前未 await，落盘前就 return ok()）')
    assert.strictEqual(res.json.code, 'system-error')
    assert.deepStrictEqual(env.ws.current(), ['a'], '写失败后归档集必须保持原样')
  } finally {
    env.cleanup()
  }
})

test('F1: 域正在关闭（disposing）时 /sm/unarchive 必须返回错误而不是假成功', async () => {
  // DomainImpl.enqueue: close() 已开始的域直接 Promise.reject(DomainError('closed'))，
  // 但 get() 仍可读（assertReadable 只在完全关闭后抛）。
  const env = makeEnv({ archivedSessionIds: ['a'], disposing: true })
  try {
    const res = await env.call('unarchive', { id: 'a' })
    await tick()
    assert.strictEqual(res.json.ok, false, '域关闭中不得返回成功（当前同步 set 看不到 reject）')
    assert.deepStrictEqual(env.ws.current(), ['a'], '写没生效，归档集必须保持原样')
  } finally {
    env.cleanup()
  }
})

test('F1: 归档写的 Promise 必须被 await/catch（悬空 rejection 会 exit(1) 整个 dsh web）', async () => {
  const env = makeEnv({ archivedSessionIds: ['a'], failWrite: true })
  try {
    await env.call('unarchive', { id: 'a' })
    await tick()
    assert.strictEqual(
      env.ws.writeHandlerAttached(),
      true,
      'set() 返回的 Promise 上必须挂 handler：dsh-app-boot 装了进程级 unhandledRejection → exit(1)',
    )
  } finally {
    env.cleanup()
  }
})

test('F1: 删除归档会话时归档写失败必须报 moved:true 的部分失败', async () => {
  const env = makeEnv({ archivedSessionIds: ['s1'], failWrite: true })
  try {
    env.newSession('/proj', 's1')
    const res = await env.call('delete', { id: 's1', cwd: '/proj', title: 's1' })
    await tick()
    assert.strictEqual(res.json.ok, false, '文件已移走但归档清理失败 → 必须是失败响应')
    assert.strictEqual(res.json.moved, true, 'moved:true 才让 client 保持隐藏并提供重试（INTERFACE §2.4）')
    assert.strictEqual(env.trash.hasItem('s1'), true, '目录确实已进回收站')
  } finally {
    env.cleanup()
  }
})

test('F1: 返回 ok 之前归档写必须已落盘（否则可重试契约在真后端上失效）', async () => {
  const env = makeEnv({ archivedSessionIds: ['a'] })
  try {
    const res = await env.call('unarchive', { id: 'a' })
    assert.strictEqual(res.json.ok, true)
    assert.deepStrictEqual(
      env.ws.current(),
      [],
      '响应返回时归档集必须已经写入（当前 ok() 在落盘前就返回）',
    )
  } finally {
    env.cleanup()
  }
})

// ---- F1 相邻回归：成功路径的既有行为不得被 await 改坏 ----

test('F1-相邻: 写入成功时 /sm/unarchive 仍返回 ok 且只改 archivedSessionIds', async () => {
  const env = makeEnv({ archivedSessionIds: ['a', 'b'] })
  try {
    const res = await env.call('unarchive', { id: 'a' })
    await tick()
    await tick()
    assert.strictEqual(res.json.ok, true)
    assert.deepStrictEqual(env.ws.current(), ['b'], '只移除目标 id')
    const g = env.ws.currentGlobal()
    assert.strictEqual(g.initialized, true, 'initialized 不得被覆盖')
    assert.deepStrictEqual(g.workspaceIds, ['main'], 'workspaceIds 不得被覆盖')
  } finally {
    env.cleanup()
  }
})

test('F1-相邻: 未归档 id 的 /sm/unarchive 仍是幂等 ok 且不写盘', async () => {
  const env = makeEnv({ archivedSessionIds: ['a'] })
  try {
    const res = await env.call('unarchive', { id: 'zzz' })
    await tick()
    assert.strictEqual(res.json.ok, true)
    assert.strictEqual(env.ws.setPayloads.length, 0, '幂等 no-op 不得触发写入')
  } finally {
    env.cleanup()
  }
})

test('F1-相邻: 删除归档会话成功时仍返回纯 ok（无 moved 标记）', async () => {
  const env = makeEnv({ archivedSessionIds: ['s1'] })
  try {
    env.newSession('/proj', 's1')
    const res = await env.call('delete', { id: 's1', cwd: '/proj', title: 's1' })
    await tick()
    await tick()
    assert.strictEqual(res.json.ok, true)
    assert.strictEqual('moved' in res.json, false, '成功响应不带 moved 字段')
    assert.strictEqual(env.trash.hasItem('s1'), true)
    assert.deepStrictEqual(env.ws.current(), [], '归档集已清理')
  } finally {
    env.cleanup()
  }
})

test('F1-相邻: workspace 域不可用时删除仍返回 moved:true 的部分失败', async () => {
  const env = makeEnv({ archivedSessionIds: ['s1'], domainUnavailable: true })
  try {
    env.newSession('/proj', 's1')
    const res = await env.call('delete', { id: 's1', cwd: '/proj', title: 's1' })
    assert.strictEqual(res.json.ok, false)
    assert.strictEqual(res.json.code, 'system-error')
    assert.strictEqual(res.json.moved, true)
  } finally {
    env.cleanup()
  }
})

// ---- H2：stale read → lost update ----

test('H2: 连续两次取消归档（写未落盘就再读）不得丢掉第一次的结果', async () => {
  const env = makeEnv({ archivedSessionIds: ['a', 'b'] })
  try {
    // 用户连点两次 / 两个请求几乎同时到：第二次读到的还是第一次落盘前的快照。
    const r1 = env.dispatch('unarchive', { id: 'a' })
    const r2 = env.dispatch('unarchive', { id: 'b' })
    await Promise.all([r1, r2])
    await tick()
    await tick()
    assert.deepStrictEqual(env.ws.current(), [], '两个 id 都必须被移出归档集（读-改-写要串行）')
  } finally {
    env.cleanup()
  }
})

test('H2: 同时删除两个归档会话不得丢掉其中一个的归档清理', async () => {
  const env = makeEnv({ archivedSessionIds: ['s1', 's2'] })
  try {
    env.newSession('/proj', 's1')
    env.newSession('/proj', 's2')
    const r1 = env.dispatch('delete', { id: 's1', cwd: '/proj', title: 's1' })
    const r2 = env.dispatch('delete', { id: 's2', cwd: '/proj', title: 's2' })
    const [res1, res2] = await Promise.all([r1, r2])
    await tick()
    await tick()
    assert.strictEqual(res1.json.ok, true)
    assert.strictEqual(res2.json.ok, true)
    assert.deepStrictEqual(env.ws.current(), [], '两条归档记录都要清掉，不能被对方的快照写回')
  } finally {
    env.cleanup()
  }
})

test('H2-相邻: 落盘后再发第二个写请求仍然正确（串行化不得破坏顺序写）', async () => {
  const env = makeEnv({ archivedSessionIds: ['a', 'b'] })
  try {
    await env.call('unarchive', { id: 'a' })
    await tick()
    await tick()
    await env.call('unarchive', { id: 'b' })
    await tick()
    await tick()
    assert.deepStrictEqual(env.ws.current(), [])
  } finally {
    env.cleanup()
  }
})
