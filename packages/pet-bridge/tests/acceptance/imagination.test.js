// 用户可能没想到、但按常理必须正确的场景
'use strict'

const { test } = require('node:test')
const assert = require('node:assert')
const { plugin, makeCtx, makeAgent, evt, toolCall, startFakePet, serverReceived } = require('./helpers')

test('assistant/message 混入事件流：只推送非 assistant 事件，不污染', async () => {
  const fake = await startFakePet()
  const ctx = makeCtx()
  const h = makeAgent()
  const dispose = plugin.apply(ctx, { port: fake.port, pollInterval: 5 })
  ctx._emitAgentCreated(h.agent)
  const { push } = h
  try {
    push(
      evt(1, 'assistant/message', { content: '思考' }),
      evt(2, 'tool/call', { name: 'read_x', arguments: '{}' }),
      evt(3, 'assistant/message', { content: '再想想' }),
      evt(4, 'turn/end'),
    )
    await serverReceived(fake, 2)
    assert.deepStrictEqual(
      fake.requests.map((r) => r.body.kind),
      ['pre', 'stop'],
      'assistant/message 应被完全跳过，只推 tool/call 与 turn/end',
    )
  } finally {
    dispose()
    await fake.stop()
  }
})

test('tool/call 缺 data.name（undefined）：tool_name 兜底为「执行中」，恒非空字符串', async () => {
  const fake = await startFakePet()
  const ctx = makeCtx()
  const h = makeAgent()
  const dispose = plugin.apply(ctx, { port: fake.port, pollInterval: 5 })
  ctx._emitAgentCreated(h.agent)
  try {
    h.push(evt(1, 'tool/call', {})) // data 里没有 name
    await serverReceived(fake, 1)
    const tn = fake.requests[0].body.tool_name
    assert.strictEqual(typeof tn, 'string')
    assert.ok(tn.length > 0, 'tool_name 恒非空字符串')
    assert.strictEqual(tn, '执行中') // 无 name → 兜底
  } finally {
    dispose()
    await fake.stop()
  }
})

test('seq 追加时位置乱序（seq2 排在 seq1 前）：两条都是新增、各自动作正确，不因数值乱而丢', async () => {
  const fake = await startFakePet()
  const ctx = makeCtx()
  const h = makeAgent()
  const dispose = plugin.apply(ctx, { port: fake.port, pollInterval: 5 })
  ctx._emitAgentCreated(h.agent)
  try {
    // 注意 push 顺序：seq2 先被追加、seq1 后追加（数值乱序但位置都在游标之后）
    h.push(toolCall(2, 'bash_y', '{}'), toolCall(1, 'read_z', '{}'))
    await serverReceived(fake, 2)
    assert.deepStrictEqual(
      fake.requests.map((r) => r.body.tool_name),
      ['运行命令', '读取中'],
    )
  } finally {
    dispose()
    await fake.stop()
  }
})

test('重复 feed：同一事件重复 append 同内容会各推一次，但同一位置的增量不重放（见 concurrency）', async () => {
  // 说明：位置增量语义下，append 两条同内容 = 两个不同事件，理应各推一次（忠于列表）。
  const fake = await startFakePet()
  const ctx = makeCtx()
  const h = makeAgent()
  const dispose = plugin.apply(ctx, { port: fake.port, pollInterval: 5 })
  ctx._emitAgentCreated(h.agent)
  try {
    h.push(toolCall(1, 'bash_dup', '{}'), toolCall(2, 'bash_dup', '{}'))
    await serverReceived(fake, 2)
    assert.strictEqual(fake.requests.length, 2)
    fake.requests.forEach((r) => assert.strictEqual(r.body.tool_name, '运行命令'))
  } finally {
    dispose()
    await fake.stop()
  }
})
