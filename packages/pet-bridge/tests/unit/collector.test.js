'use strict'

// 白盒单测：collector 多会话并发（各源独立游标）、agent/disposed 停用、dispose 清理
const { test } = require('node:test')
const assert = require('node:assert')
const { createCollector } = require('../../lib/collector')

function evt(seq, type, data) {
  const o = { seq, type }
  if (data !== undefined) o.data = data
  return o
}
function ticks(n, ms) {
  return new Promise((r) => setTimeout(r, (n + 1) * ms))
}
function makeAgent() {
  return { session: { events: [] } }
}

test('多 agent 各自独立：watch 两个 agent，事件按发生序各自外发，不串扰不重放', async () => {
  const sent = []
  const c = createCollector({ enabled: true, pollInterval: 5, port: 1 }, (k, t) => sent.push({ k, t }))
  const a = makeAgent()
  const b = makeAgent()
  c.watch(a)
  c.watch(b)
  a.session.events.push(evt(1, 'turn/start'))
  await ticks(1, 5)
  b.session.events.push(evt(1, 'tool/call', { name: 'bash_b', arguments: '{}' }))
  await ticks(1, 5)
  a.session.events.push(evt(2, 'tool/call', { name: 'read_a', arguments: '{}' }))
  await ticks(1, 5)
  assert.deepStrictEqual(
    sent.map((e) => e.k),
    ['user', 'pre', 'pre'],
  )
  assert.strictEqual(sent[1].t, '运行命令')
  assert.strictEqual(sent[2].t, '读取中')
  await ticks(2, 5)
  assert.strictEqual(sent.length, 3, '无新增不得重放')
  c.dispose()
})

test('watch 同一 agent 幂等：不建第二个 watcher，不重复推送', async () => {
  const sent = []
  const c = createCollector({ enabled: true, pollInterval: 5, port: 1 }, (k) => sent.push(k))
  const a = makeAgent()
  c.watch(a)
  c.watch(a)
  c.watch(a)
  a.session.events.push(evt(1, 'turn/start'))
  await ticks(1, 5)
  assert.strictEqual(sent.length, 1)
  c.dispose()
})

test('unwatch（agent/disposed）：补发一条 stop 并彻底停用该 agent', async () => {
  const sent = []
  const c = createCollector({ enabled: true, pollInterval: 5, port: 1 }, (k, t) => sent.push({ k, t }))
  const a = makeAgent()
  c.watch(a)
  c.unwatch(a) // 无事件直接销毁
  assert.deepStrictEqual(sent.map((e) => e.k), ['stop'])
  // 销毁后该 agent 再来事件不得推
  a.session.events.push(evt(1, 'tool/call', { name: 'bash_after', arguments: '{}' }))
  await ticks(2, 5)
  assert.strictEqual(sent.length, 1)
  c.dispose()
})

test('dispose 全停：不再推送任何 agent 的事件', async () => {
  const sent = []
  const c = createCollector({ enabled: true, pollInterval: 5, port: 1 }, (k) => sent.push(k))
  const a = makeAgent()
  c.watch(a)
  c.dispose()
  a.session.events.push(evt(1, 'turn/start'))
  await ticks(2, 5)
  assert.strictEqual(sent.length, 0)
})
