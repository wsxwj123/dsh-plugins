// 生命周期 / 卸载 / 幂等：apply 返回值、卸载后零推送且 timer 停、多次 apply/卸载不泄漏
'use strict'

const { test } = require('node:test')
const assert = require('node:assert')
const { plugin, makeCtx, makeAgent, evt, toolCall, startFakePet, serverReceived } = require('./helpers')

test('apply 必须返回一个可调用的卸载函数', () => {
  const ctx = makeCtx()
  const dispose = plugin.apply(ctx, { port: 1, pollInterval: 5 })
  assert.strictEqual(typeof dispose, 'function')
  dispose() // 能调用且不抛
})

test('卸载后：再喂事件不再推送（timer 已停、观察已解绑）', async () => {
  const fake = await startFakePet()
  const ctx = makeCtx()
  const h = makeAgent()
  const dispose = plugin.apply(ctx, { port: fake.port, pollInterval: 5 })
  ctx._emitAgentCreated(h.agent)
  // 卸载前能推
  h.push(toolCall(1, 'bash_bar', '{}'))
  await serverReceived(fake, 1)
  assert.strictEqual(fake.requests[0].body.tool_name, '运行命令')

  // 卸载
  dispose()

  // 卸载后再喂多个事件，等待多轮，断言不再有任何推送
  h.push(evt(2, 'turn/start'), toolCall(3, 'read_x', '{}'), evt(4, 'turn/end'))
  await new Promise((r) => setTimeout(r, 250))
  assert.strictEqual(fake.requests.length, 1, '卸载后不得再推送')
})

test('多次 apply + 卸载不泄漏：各自推送独立、卸载后全停', async () => {
  const fake = await startFakePet()
  const a = makeCtx()
  const b = makeCtx()
  const ha = makeAgent()
  const hb = makeAgent()
  const da = plugin.apply(a, { port: fake.port, pollInterval: 5 })
  const db = plugin.apply(b, { port: fake.port, pollInterval: 5 })
  a._emitAgentCreated(ha.agent)
  b._emitAgentCreated(hb.agent)

  ha.push(toolCall(1, 'bash_a', '{}'))
  hb.push(evt(1, 'turn/start'))
  await serverReceived(fake, 2)
  assert.strictEqual(fake.requests[0].body.tool_name, '运行命令')
  assert.strictEqual(fake.requests[1].body.kind, 'user')

  // 卸载其中一个，其事件不再推，另一个仍正常
  da()
  ha.push(evt(2, 'turn/end'))
  hb.push(evt(2, 'turn/end'))
  await serverReceived(fake, 3) // 只该多出一条（来自 b）
  assert.strictEqual(fake.requests[2].body.kind, 'stop')
  await new Promise((r) => setTimeout(r, 200))
  assert.strictEqual(fake.requests.length, 3, '已卸载一方不得再推')

  db()
  hb.push(evt(3, 'tool/result', { name: 'x' }))
  await new Promise((r) => setTimeout(r, 200))
  assert.strictEqual(fake.requests.length, 3, '全部卸载后不得再推')
})

test('agent/disposed（created 后无任何 turn 事件）：补发一条 kind=stop，payload 与 turn/end→stop 完全一致', async () => {
  const fake = await startFakePet()
  const ctx = makeCtx()
  const { agent } = makeAgent() // 不推任何事件，直接销毁
  const dispose = plugin.apply(ctx, { port: fake.port, pollInterval: 5 })
  ctx._emitAgentCreated(agent)
  try {
    // created 后立刻 disposed，不带任何 turn 事件
    ctx._emit('agent/disposed', { agent })
    await serverReceived(fake, 1)

    const b = fake.requests[0].body
    assert.strictEqual(b.kind, 'stop')
    // 与 turn/end→stop 相同的 payload（§2.2 映射表）
    assert.deepStrictEqual(b, {
      kind: 'stop',
      agent_source: 'dsh',
      tool_name: null,
      tool_input: null,
      caller_pid: process.pid,
    })
  } finally {
    dispose()
    await fake.stop()
  }
})

test('agent/disposed 后：该 agent 不再产生任何推送、轮询资源已清理', async () => {
  const fake = await startFakePet()
  const ctx = makeCtx()
  const h = makeAgent()
  const dispose = plugin.apply(ctx, { port: fake.port, pollInterval: 5 })
  ctx._emitAgentCreated(h.agent)
  try {
    // 销毁时补发一条 stop
    ctx._emit('agent/disposed', { agent: h.agent })
    await serverReceived(fake, 1)
    const first = fake.requests.length

    // 销毁后同一 agent 再来事件，不得再推（轮询已解绑）
    h.push(toolCall(2, 'bash_after_dispose', '{}'))
    await new Promise((r) => setTimeout(r, 250)) // 多次轮询窗口
    assert.strictEqual(fake.requests.length, first, '销毁后该 agent 不得再推送任何事件')
  } finally {
    dispose()
    await fake.stop()
  }
})
