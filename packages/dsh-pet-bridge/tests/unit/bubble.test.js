'use strict'

// 白盒单测：bubble 推送 payload 契约 + 静默降级（ECONNREFUSED / 非 2xx / 不抛到外部）
const { test } = require('node:test')
const assert = require('node:assert')
const http = require('node:http')
const { push, buildPayload } = require('../../lib/bubble')

function startFakePet(status = 200) {
  return new Promise((resolve, reject) => {
    const requests = []
    const server = http.createServer((req, res) => {
      let raw = ''
      req.on('data', (c) => (raw += c))
      req.on('end', () => {
        requests.push({ url: req.url, body: JSON.parse(raw || 'null') })
        res.statusCode = status
        res.end()
      })
    })
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () =>
      resolve({ port: server.address().port, server, requests, stop: () => new Promise((r) => server.close(r)) }),
    )
  })
}

function freePort() {
  return new Promise((resolve, reject) => {
    const s = http.createServer()
    s.on('error', reject)
    s.listen(0, '127.0.0.1', () => {
      const p = s.address().port
      s.close(() => resolve(p))
    })
  })
}

function waitFor(predicate, ms) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now()
    const tick = () => {
      if (predicate()) return resolve()
      if (Date.now() - t0 > ms) return reject(new Error('timeout'))
      setTimeout(tick, 5)
    }
    tick()
  })
}

test('buildPayload 恒为契约五字段：agent_source 恒 dsh、caller_pid=process.pid、tool_input 可携摘要', () => {
  for (const kind of ['user', 'post', 'stop']) {
    const p = buildPayload(kind)
    assert.deepStrictEqual(Object.keys(p).sort(), ['agent_source', 'caller_pid', 'kind', 'tool_input', 'tool_name'])
    assert.strictEqual(p.kind, kind)
    assert.strictEqual(p.agent_source, 'dsh')
    assert.strictEqual(p.tool_input, null) // 非 pre 恒 null
    assert.strictEqual(p.tool_name, null)
    assert.strictEqual(p.caller_pid, process.pid)
  }
  // pre：tool_name=原始名、tool_input=精简摘要对象
  const pre = buildPayload('pre', 'bash', { command: 'ls' })
  assert.strictEqual(pre.tool_name, 'bash')
  assert.deepStrictEqual(pre.tool_input, { command: 'ls' })
  // 缺省归一为 null
  assert.strictEqual(buildPayload('user', undefined).tool_name, null)
  assert.strictEqual(buildPayload('user', null).tool_name, null)
  assert.strictEqual(buildPayload('user', 'bash', undefined).tool_input, null)
})

test('push 正常路径：POST /bubble、收到 2xx、payload 正确（pre 携摘要）', async () => {
  const fake = await startFakePet(200)
  try {
    push(fake.port, 'pre', 'bash', { command: 'ls' })
    await waitFor(() => fake.requests.length >= 1, 500)
    assert.strictEqual(fake.requests[0].url, '/bubble')
    assert.strictEqual(fake.requests[0].body.kind, 'pre')
    assert.strictEqual(fake.requests[0].body.tool_name, 'bash')
    assert.deepStrictEqual(fake.requests[0].body.tool_input, { command: 'ls' })
  } finally {
    await fake.stop()
  }
})

test('ECONNREFUSED（无人监听）：不抛异常、不重试（无请求发出）', async () => {
  const dead = await freePort()
  const cap = []
  const h = (e) => cap.push(e)
  process.on('uncaughtException', h)
  process.on('unhandledRejection', h)
  try {
    push(dead, 'user', undefined) // fire-and-forget，立即返回不抛
    await new Promise((r) => setTimeout(r, 150))
    assert.deepStrictEqual(cap, [], 'ECONNREFUSED 不得外抛异步异常')
  } finally {
    process.removeListener('uncaughtException', h)
    process.removeListener('unhandledRejection', h)
  }
})

test('非 2xx：请求发出、不重试、不抛异常', async () => {
  const fake = await startFakePet(500)
  const cap = []
  const h = (e) => cap.push(e)
  process.on('uncaughtException', h)
  process.on('unhandledRejection', h)
  try {
    push(fake.port, 'stop', undefined)
    await waitFor(() => fake.requests.length >= 1, 500)
    await new Promise((r) => setTimeout(r, 100))
    assert.strictEqual(fake.requests.length, 1, '非 2xx 不得重试')
    assert.deepStrictEqual(cap, [], '非 2xx 不得外抛异步异常')
  } finally {
    process.removeListener('uncaughtException', h)
    process.removeListener('unhandledRejection', h)
    await fake.stop()
  }
})
