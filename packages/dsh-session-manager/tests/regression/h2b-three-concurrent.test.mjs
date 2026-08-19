/**
 * H2b — 三并发归档写（2 并发用例照不到的盲区）。
 *
 * 机理：只按“当前在飞的那个写”挂链（`chain = inFlight.then(run)`）时，
 * A 在飞、B 和 C 相继到达 → B、C 都挂在 A 上；A 落盘后 B、C 在同一批微任务里
 * 并行跑，C 读到的是 B 落盘前的快照，B 的改动被 C 的 `{...global}` 整份写回还原。
 * 正确修法是每次都挂在**队尾**（tail = tail.then(run)），读-改-写整段进队列。
 */
import { test } from 'node:test'
import assert from 'node:assert'
import { tick } from './_harness.mjs'
import { makeEnv } from './_env.mjs'

/** 让所有排队的写都落完（stub 的每次落盘要一个宏任务）。 */
async function drain() {
  for (let i = 0; i < 8; i++) await tick()
}

test('H2b: 三个取消归档相继到达（A 在飞时 B、C 入队）时，三个 id 都必须被移出', async () => {
  const env = makeEnv({ archivedSessionIds: ['a', 'b', 'c'] })
  try {
    const rA = env.dispatch('unarchive', { id: 'a' })
    await Promise.resolve() // A 已发出、落盘未完成
    const rB = env.dispatch('unarchive', { id: 'b' })
    await Promise.resolve() // B 入队
    const rC = env.dispatch('unarchive', { id: 'c' })
    const results = await Promise.all([rA, rB, rC])
    await drain()

    for (const res of results) assert.strictEqual(res.json.ok, true, '三个请求都应报成功')
    assert.deepStrictEqual(
      env.ws.current(),
      [],
      '读-改-写必须整段串到队尾；只挂“在飞那个”会让 B、C 同批并行，B 的改动被 C 写回还原',
    )
  } finally {
    env.cleanup()
  }
})

test('H2b: 三个归档会话相继删除时，三条归档记录都必须被清理', async () => {
  const env = makeEnv({ archivedSessionIds: ['s1', 's2', 's3'] })
  try {
    for (const id of ['s1', 's2', 's3']) env.newSession('/proj', id)
    const r1 = env.dispatch('delete', { id: 's1', cwd: '/proj', title: 's1' })
    await Promise.resolve()
    const r2 = env.dispatch('delete', { id: 's2', cwd: '/proj', title: 's2' })
    await Promise.resolve()
    const r3 = env.dispatch('delete', { id: 's3', cwd: '/proj', title: 's3' })
    await Promise.all([r1, r2, r3])
    await drain()

    assert.deepStrictEqual(env.ws.current(), [], '三条归档记录都要清掉，不能被彼此的快照写回')
    for (const id of ['s1', 's2', 's3']) assert.strictEqual(env.trash.hasItem(id), true, `${id} 已进回收站`)
  } finally {
    env.cleanup()
  }
})

test('H2b-相邻: 三个写各自等落盘后再发（严格顺序）时仍然全部生效', async () => {
  const env = makeEnv({ archivedSessionIds: ['a', 'b', 'c'] })
  try {
    for (const id of ['a', 'b', 'c']) {
      await env.call('unarchive', { id })
      await drain()
    }
    assert.deepStrictEqual(env.ws.current(), [])
  } finally {
    env.cleanup()
  }
})
