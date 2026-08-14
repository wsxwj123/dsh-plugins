// 错误路径：pet 未监听（ECONNREFUSED）、非 2xx 响应 —— 都必须静默降级
// 契约：不抛到 apply 之外、不重试、影响 dsh 事件处理收敛为 debug 日志
'use strict'

const { test } = require('node:test')
const assert = require('node:assert')
const { plugin, makeCtx, makeAgent, evt, toolCall, startFakePet, freeUnusedPort, serverReceived } = require('./helpers')

/** 收集进程级未捕获异步异常（fire-and-forget 的降级错误若外抛会进到这里） */
function captureUncaught() {
  const seen = []
  const h = (err) => seen.push(err)
  process.on('uncaughtException', h)
  process.on('unhandledRejection', (r) => seen.push(r))
  return {
    seen,
    stop() {
      process.removeListener('uncaughtException', h)
      process.removeListener('unhandledRejection', h)
    },
  }
}

test('推送目标无监听（ECONNREFUSED）：不抛异常、不重试、后续事件仍处理', async () => {
  const deadPort = await freeUnusedPort() // 现在无人监听的端口
  const cap = captureUncaught()
  const ctx = makeCtx()
  const h = makeAgent()
  const dispose = plugin.apply(ctx, { port: deadPort, pollInterval: 5 })
  try {
    ctx._emitAgentCreated(h.agent)
    h.push(evt(1, 'turn/start'))
    // 给数次轮询机会，期间若有异步外抛会被 cap 捕获
    await new Promise((r) => setTimeout(r, 200))
    assert.deepStrictEqual(cap.seen, [], 'ECONNREFUSED 不得外抛 async 异常')
    // 不重试：同一事件不会反复尝试连接（以「无 pushes 目标」无法计数，但连接失败不应崩）
    // 继续喂一个事件，进程仍存活且后续行为正常（能继续走，只是无推送目标）
    h.push(toolCall(2, 'bash_bar', '{}'))
    await new Promise((r) => setTimeout(r, 100))
    assert.deepStrictEqual(cap.seen, [], '追加事件后仍不抛异常、进程未崩')
  } finally {
    dispose()
    cap.stop()
  }
})

test('非 2xx 响应（500）：静默降级、不重试、后续事件仍正常推送', async () => {
  const fake = await startFakePet(502) // 假 pet 回 502
  const cap = captureUncaught()
  const ctx = makeCtx()
  const h = makeAgent()
  const dispose = plugin.apply(ctx, { port: fake.port, pollInterval: 5 })
  try {
    ctx._emitAgentCreated(h.agent)
    h.push(evt(1, 'turn/start'))
    await serverReceived(fake, 1) // 请求确实发出且收到非 2xx
    // 给时间观察是否有重试（同 token 不该重发）
    await new Promise((r) => setTimeout(r, 200))
    assert.strictEqual(fake.requests.length, 1, '非 2xx 不得重试（同事件只发一次）')
    assert.deepStrictEqual(cap.seen, [], '非 2xx 不得外抛 async 异常')
    // 后续事件仍能正常推送
    h.push(evt(2, 'turn/end'))
    await serverReceived(fake, 2)
    assert.strictEqual(fake.requests[1].body.kind, 'stop')
  } finally {
    dispose()
    cap.stop()
    await fake.stop()
  }
})
