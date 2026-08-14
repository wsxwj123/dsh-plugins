// 边界用例：空/缺失事件、超长参数不外发、enabled=false 零推送、缺省 config
'use strict'

const { test } = require('node:test')
const assert = require('node:assert')
const { plugin, makeCtx, makeAgent, evt, toolCall, startFakePet, serverReceived } = require('./helpers')

function mount(ctx, agentHolder, fake, extra = {}) {
  const h = makeAgent()
  Object.assign(agentHolder, { agent: h.agent, push: h.push })
  const dispose = plugin.apply(ctx, { port: fake.port, pollInterval: 5, ...extra })
  ctx._emitAgentCreated(h.agent)
  return { dispose }
}

test('空 events 数组：装载不崩、无推送', async () => {
  const fake = await startFakePet()
  const ctx = makeCtx()
  const holder = {}
  const { dispose } = mount(ctx, holder, fake)
  try {
    await new Promise((r) => setTimeout(r, 150))
    assert.strictEqual(fake.requests.length, 0)
  } finally {
    dispose()
    await fake.stop()
  }
})

test('session.events 缺失（undefined）：该 tick 跳过、不崩、不推送', async () => {
  const fake = await startFakePet()
  const ctx = makeCtx()
  const agent = { session: {} } // 无 events 字段
  const dispose = plugin.apply(ctx, { port: fake.port, pollInterval: 5 })
  ctx._emitAgentCreated(agent)
  try {
    await new Promise((r) => setTimeout(r, 150))
    assert.strictEqual(fake.requests.length, 0)
  } finally {
    dispose()
    await fake.stop()
  }
})

test('超长 arguments：不外发，payload 里不出现参数内容', async () => {
  const fake = await startFakePet()
  const ctx = makeCtx()
  const h = makeAgent()
  const longArgs = 'x'.repeat(6000)
  const dispose = plugin.apply(ctx, { port: fake.port, pollInterval: 5 })
  ctx._emitAgentCreated(h.agent)
  try {
    h.push(toolCall(1, 'bash_pwd', JSON.stringify({ cmd: longArgs, secret: 'sk-abc123' })))
    await serverReceived(fake, 1)
    const b = fake.requests[0].body
    assert.strictEqual(b.tool_input, null, '参数恒不进 tool_input')
    const raw = fake.requests[0].raw
    assert.ok(!raw.includes('sk-abc123'), '敏感参数不得出现在任何外发内容里')
    assert.ok(!raw.includes('x'.repeat(6000).slice(0, 100)), '超长参数内容不得外发')
    // payload 只允许契约规定的 5 个字段
    assert.deepStrictEqual(Object.keys(b).sort(), [
      'agent_source',
      'caller_pid',
      'kind',
      'tool_input',
      'tool_name',
    ])
  } finally {
    dispose()
    await fake.stop()
  }
})

test('enabled=false：正常装载、零推送（有事件也不发）', async () => {
  const fake = await startFakePet()
  const ctx = makeCtx()
  const h = makeAgent()
  const dispose = plugin.apply(ctx, { port: fake.port, pollInterval: 5, enabled: false })
  ctx._emitAgentCreated(h.agent)
  try {
    assert.strictEqual(typeof dispose, 'function', 'enabled=false 也应返回卸载函数（正常装载）')
    h.push(
      evt(1, 'turn/start'),
      toolCall(2, 'bash_bar', '{}'),
      evt(3, 'tool/result', { name: 'bash_bar' }),
      evt(4, 'turn/end'),
    )
    await new Promise((r) => setTimeout(r, 250))
    assert.strictEqual(fake.requests.length, 0, 'enabled=false 必须零推送')
  } finally {
    dispose()
    await fake.stop()
  }
})

test('config 缺省（不传 pollInterval/port 不崩，返回卸载函数）', async () => {
  const fake = await startFakePet()
  const ctx = makeCtx()
  const h = makeAgent()
  // 故意给 port 指向假 server，pollInterval 不给（走默认 250）
  const dispose = plugin.apply(ctx, { port: fake.port })
  ctx._emitAgentCreated(h.agent)
  try {
    // pollInterval 默认 250ms，等 500ms 应至少看到一次轮询推送
    h.push(evt(1, 'turn/start'))
    await serverReceived(fake, 1)
    const b = fake.requests[0].body
    assert.strictEqual(b.kind, 'user')
  } finally {
    dispose()
    await fake.stop()
  }
})

test('apply(ctx) 不带 config：不抛错、返回卸载函数（契约签名兼容）', async () => {
  const ctx = makeCtx()
  const h = makeAgent()
  // 不传 config，插件表现不应崩（此用例不断言推送，仅断言调用契约）
  const dispose = plugin.apply(ctx)
  ctx._emitAgentCreated(h.agent)
  assert.strictEqual(typeof dispose, 'function')
  // 直接卸载，无残留
  const r0 = dispose()
  assert.strictEqual(r0, undefined, '卸载函数无额外返回值要求')
})
