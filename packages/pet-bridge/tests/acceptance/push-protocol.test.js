// 正常路径：事件 → 推送 kind / 常量字段
// 契约：turn/start→user、tool/call→pre、tool/result→post、turn/end→stop、
//       assistant/message 不推送；agent_source 恒 "dsh"；caller_pid=process.pid
'use strict'

const { test } = require('node:test')
const assert = require('node:assert')
const { plugin, makeCtx, makeAgent, evt, toolCall, startFakePet, serverReceived } = require('./helpers')

/** 挂载插件到 minictx，返回 { ctx, agent, push } */ 
function mount(fakePet, extraConfig = {}) {
  const ctx = makeCtx()
  const { agent, push } = makeAgent()
  const dispose = plugin.apply(ctx, { port: fakePet.port, pollInterval: 5, ...extraConfig })
  assert.strictEqual(typeof dispose, 'function', 'apply 必须返回可调用卸载函数')
  ctx._emitAgentCreated(agent)
  return { ctx, agent, push, dispose }
}

test('turn/start 推 kind=user、agent_source="dsh"、tool_name=null、tool_input=null', async () => {
  const fake = await startFakePet()
  const { push } = mount(fake)
  try {
    push(evt(1, 'turn/start', { message: ['hi'] }))
    await serverReceived(fake, 1)
    const r = fake.requests[0]
    assert.strictEqual(r.url, '/bubble')
    assert.strictEqual(r.method, 'POST')
    assert.deepStrictEqual(r.body, {
      kind: 'user',
      agent_source: 'dsh',
      tool_name: null,
      tool_input: null,
      caller_pid: process.pid,
    })
  } finally {
    await fake.stop()
  }
})

test('tool/call 推 kind=pre，tool_name=中文文案，tool_input 恒 null', async () => {
  const fake = await startFakePet()
  const { push } = mount(fake)
  try {
    push(toolCall(1, 'bash_bar', '{}'))
    await serverReceived(fake, 1)
    const b = fake.requests[0].body
    assert.strictEqual(b.kind, 'pre')
    assert.strictEqual(b.tool_name, '运行命令')
    assert.strictEqual(b.tool_input, null, 'tool/call 的 tool_input 也必须为 null')
  } finally {
    await fake.stop()
  }
})

test('tool/result 推 kind=post，tool_name=null、tool_input=null', async () => {
  const fake = await startFakePet()
  const { push } = mount(fake)
  try {
    push(evt(1, 'tool/result', { name: 'bash_bar', response: 'ok' }))
    await serverReceived(fake, 1)
    const b = fake.requests[0].body
    assert.strictEqual(b.kind, 'post')
    assert.strictEqual(b.tool_name, null)
    assert.strictEqual(b.tool_input, null)
  } finally {
    await fake.stop()
  }
})

test('turn/end 推 kind=stop，tool_name=null、tool_input=null', async () => {
  const fake = await startFakePet()
  const { push } = mount(fake)
  try {
    push(evt(1, 'turn/end'))
    await serverReceived(fake, 1)
    const b = fake.requests[0].body
    assert.strictEqual(b.kind, 'stop')
    assert.strictEqual(b.tool_name, null)
    assert.strictEqual(b.tool_input, null)
  } finally {
    await fake.stop()
  }
})

test('assistant/message 不推送（喂入后等待，0 次推送）', async () => {
  const fake = await startFakePet()
  const { push } = mount(fake)
  try {
    push(evt(1, 'assistant/message', { content: '正在思考…' }))
    // pollInterval=5ms；等 250ms 足够多轮询确认无推送
    await new Promise((r) => setTimeout(r, 250))
    assert.strictEqual(fake.requests.length, 0, 'assistant/message 不得外发任何推送')
  } finally {
    await fake.stop()
  }
})

test('一个完整回合：start→call→result→end 依次外发 user/pre/post/stop', async () => {
  const fake = await startFakePet()
  const { push } = mount(fake)
  try {
    push(
      evt(1, 'turn/start'),
      toolCall(2, 'glob_ts', '{}'),
      evt(3, 'tool/result', { name: 'glob_ts' }),
      evt(4, 'turn/end'),
    )
    await serverReceived(fake, 4)
    assert.deepStrictEqual(
      fake.requests.map((r) => r.body.kind),
      ['user', 'pre', 'post', 'stop'],
    )
    // 逐一核对四个 payload 的关键字段
    assert.strictEqual(fake.requests[1].body.tool_name, '读取中')
    assert.strictEqual(fake.requests[1].body.tool_input, null)
    fake.requests.forEach((r) => {
      assert.strictEqual(r.body.agent_source, 'dsh')
      assert.strictEqual(r.body.caller_pid, process.pid)
    })
  } finally {
    await fake.stop()
  }
})
