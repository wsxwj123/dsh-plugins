// 并发：多 agent / 多会话都有事件时，各自独立、不交叉污染、不丢失、不重放
// 说明：INTERFACE 非目标声明"多会话并发取最近活跃会话即可，不做聚合"，
//       但接口层事件里没有会话级时间戳/age 字段，纯黑盒无法判定"谁最活跃"，
//       因此本文件验证的是其可确定的正确行为子集（多源并发各自独立游标、按发生序外发）。
'use strict'

const { test } = require('node:test')
const assert = require('node:assert')
const { plugin, makeCtx, makeAgent, evt, toolCall, startFakePet, serverReceived } = require('./helpers')

test('两个 agent 各自独立增量：各自事件都按发生序外发，不重放、不串扰', async () => {
  const fake = await startFakePet()
  const ctx = makeCtx()
  const a = makeAgent()
  const b = makeAgent()
  const dispose = plugin.apply(ctx, { port: fake.port, pollInterval: 5 })
  ctx._emitAgentCreated(a.agent)
  ctx._emitAgentCreated(b.agent)
  try {
    a.push(evt(1, 'turn/start')) // agent a
    await serverReceived(fake, 1)
    b.push(toolCall(1, 'bash_b', '{}')) // agent b
    await serverReceived(fake, 2)
    a.push(toolCall(2, 'read_a', '{}')) // agent a 又来
    await serverReceived(fake, 3)

    assert.deepStrictEqual(
      fake.requests.map((r) => r.body.kind),
      ['user', 'pre', 'pre'],
    )
    assert.strictEqual(fake.requests[1].body.tool_name, '运行命令') // b
    assert.strictEqual(fake.requests[2].body.tool_name, '读取中') // a
    // 无额外推送（两个 agent 独立游标，各自不重放对方事件）
    await new Promise((r) => setTimeout(r, 200))
    assert.strictEqual(fake.requests.length, 3)
  } finally {
    dispose()
    await fake.stop()
  }
})

test('同一 agent 事件不新增时，多轮询后不重复推送（增量游标不重放）', async () => {
  const fake = await startFakePet()
  const ctx = makeCtx()
  const { agent, push } = makeAgent()
  const dispose = plugin.apply(ctx, { port: fake.port, pollInterval: 5 })
  ctx._emitAgentCreated(agent)
  try {
    push(toolCall(1, 'bash_bar', '{}'))
    await serverReceived(fake, 1)
    await new Promise((r) => setTimeout(r, 300)) // 多轮询但无新事件
    assert.strictEqual(fake.requests.length, 1, '无新增事件不得重复推送')
  } finally {
    dispose()
    await fake.stop()
  }
})
