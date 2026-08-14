'use strict'

// 白盒单测：agentWatcher 位置游标增量轮询 + 事件->kind 映射 + 停用语义
const { test } = require('node:test')
const assert = require('node:assert')
const { createWatcher } = require('../../lib/agentWatcher')

function evt(seq, type, data) {
  const o = { seq, type }
  if (data !== undefined) o.data = data
  return o
}

/** 等待 n 个 interval tick 的辅助 */
function ticks(n, ms) {
  return new Promise((r) => setTimeout(r, (n + 1) * ms))
}

/** 构造 watcher：收集 emit，固定 pollInterval=5 */
function setup(initialEvents) {
  const emitted = []
  const agent = { session: { events: initialEvents ? initialEvents.map((e) => ({ ...e })) : [] } }
  const w = createWatcher(agent, { enabled: true, pollInterval: 5, port: 1 }, (k, t) => emitted.push({ k, t }))
  return { agent, emitted, w }
}

test('事件 -> kind 映射：turn/start→user、tool/call→pre、tool/result→post、turn/end→stop、assistant/message 不推', async () => {
  const { agent, emitted, w } = setup()
  agent.session.events.push(evt(1, 'turn/start'))
  agent.session.events.push(evt(2, 'tool/call', { name: 'bash_x', arguments: '{}' }))
  agent.session.events.push(evt(3, 'tool/result', { name: 'bash_x' }))
  agent.session.events.push(evt(4, 'turn/end'))
  agent.session.events.push(evt(5, 'assistant/message', { content: 'x' }))
  await ticks(2, 5)
  assert.deepStrictEqual(
    emitted.map((e) => e.k),
    ['user', 'pre', 'post', 'stop'],
  )
  assert.strictEqual(emitted[1].t, '运行命令') // tool/call 带中文文案
  w.dispose()
})

test('位置游标：seq 乱序（seq2 排在 seq1 前）仍按 append 序外发', async () => {
  const { agent, emitted, w } = setup()
  agent.session.events.push(evt(2, 'tool/call', { name: 'bash_y', arguments: '{}' }))
  agent.session.events.push(evt(1, 'tool/call', { name: 'read_z', arguments: '{}' }))
  await ticks(2, 5)
  assert.deepStrictEqual(
    emitted.map((e) => e.t),
    ['运行命令', '读取中'], // 按 append 序，不是 seq 序
  )
  w.dispose()
})

test('位置游标：无新增事件不重放（游标只增）', async () => {
  const { agent, emitted, w } = setup()
  agent.session.events.push(evt(1, 'turn/start'))
  await ticks(2, 5)
  assert.strictEqual(emitted.length, 1)
  await ticks(3, 5) // 多轮询，无新事件
  assert.strictEqual(emitted.length, 1, '无新增不得重复推送')
  w.dispose()
})

test('session.events 缺失（undefined）时该 tick 跳过不崩', async () => {
  const { w } = setup()
  const naked = createWatcher({ session: {} }, { enabled: true, pollInterval: 5, port: 1 }, () => {})
  // 无 events 字段的 agent 轮询数次不抛
  await ticks(2, 5)
  assert.ok(true)
  naked.dispose()
  w.dispose()
})

test('dispose 后不再推送（timer 已停、dead 置位）', async () => {
  const { agent, emitted, w } = setup()
  w.dispose()
  agent.session.events.push(evt(1, 'turn/start'))
  await ticks(3, 5)
  assert.strictEqual(emitted.length, 0, 'dispose 后不得再推送')
})

test('finalStop（agent/disposed）：补发一条 stop（幂等）并彻底停用', async () => {
  const { agent, emitted, w } = setup()
  w.finalStop() // 无任何 turn 事件，直接补发 stop
  assert.deepStrictEqual(emitted.map((e) => e.k), ['stop'])
  assert.strictEqual(emitted[0].t, undefined) // tool_name 无
  // 之后再补事件，不得再推
  agent.session.events.push(evt(1, 'tool/call', { name: 'bash_x', arguments: '{}' }))
  await ticks(3, 5)
  assert.strictEqual(emitted.length, 1, 'finalStop 后不得再推送')
})

test('enabled=false 的 watcher：完全不轮询不推送', async () => {
  const emitted = []
  const agent = { session: { events: [] } }
  const w = createWatcher(agent, { enabled: false, pollInterval: 5, port: 1 }, (k) => emitted.push(k))
  agent.session.events.push(evt(1, 'turn/start'))
  await ticks(2, 5)
  assert.strictEqual(emitted.length, 0)
  w.dispose()
})
