// host RPC 传输层公共契约测试（INTERFACE §0）：
//   trust fence → 403；非 POST → 405；无方法名 → 404；body 超限 → 413；
//   body 流读取中断 → 400 bad-request；非法 JSON → 400；方法名不在端点表 → 404 {error}.
//
// 驱动方式：起真实 HTTP 服务，handler 用契约参考实现（helpers/contractHost.mjs）。
// 换真实插件只需把底部 ROUTER 换掉，断言不变（见文件头注释）。
// 用户视角：这是"插件对外 HTTP 接口在非法调用下必须精确拒绝"的守门。

import test from 'node:test'
import assert from 'node:assert/strict'
import { createHttpHarness } from './helpers/http.mjs'
import { ROUTER, MAX_BODY_BYTES } from './helpers/contractHost.mjs'

function harness(ctx) {
  return createHttpHarness((req, res) => ROUTER(req, res, ctx))
}

test.describe('§0 传输层公共契约', () => {
  let srv

  test.beforeEach(async () => {
    srv = await harness({})
  })
  test.afterEach(async () => {
    await srv.stop()
  })

  // —— Order 1: trust fence → 403 plain 'forbidden' ——
  test('信任围栏：Sec-Fetch-Site: cross-site → 403，纯文本 forbidden', async () => {
    const r = await srv.request({
      path: '/ct/instructions.list',
      headers: { 'sec-fetch-site': 'cross-site' },
      body: { cwd: '/tmp' },
    })
    assert.equal(r.status, 403)
    assert.equal(r.text, 'forbidden')
    // 非 JSON body
    assert.equal(r.json, null)
  })

  test('信任围栏：Origin 与 Host 不同源 → 403 forbidden', async () => {
    const r = await srv.request({
      path: '/ct/instructions.list',
      headers: { origin: 'https://evil.example' },
      body: { cwd: '/tmp' },
    })
    assert.equal(r.status, 403)
    assert.equal(r.text, 'forbidden')
  })

  test('信任围栏：Host 非 loopback（伪造 Host: evil.example）→ 403 forbidden', async () => {
    const r = await srv.request({
      path: '/ct/instructions.list',
      headers: { host: 'evil.example' },
      body: { cwd: '/tmp' },
    })
    assert.equal(r.status, 403)
    assert.equal(r.text, 'forbidden')
  })

  // —— Order 2: 非 POST → 405 + allow: POST ——
  test('GET 请求 → 405，header allow: POST，纯文本 method not allowed', async () => {
    const r = await srv.request({ path: '/ct/instructions.list', method: 'GET' })
    assert.equal(r.status, 405)
    assert.equal(r.headers.allow, 'POST')
    assert.equal(r.text, 'method not allowed')
  })

  test('PUT 请求 → 405 method not allowed', async () => {
    const r = await srv.request({ path: '/ct/instructions.list', method: 'PUT', body: {} })
    assert.equal(r.status, 405)
    assert.equal(r.headers.allow, 'POST')
    assert.equal(r.text, 'method not allowed')
  })

  // —— Order 3: 无方法名 → 404 plain 'not found' ——
  test('路径 /ct/（无方法名）→ 404 纯文本 not found', async () => {
    const r = await srv.request({ path: '/ct/', body: {} })
    assert.equal(r.status, 404)
    assert.equal(r.text, 'not found')
  })

  test('路径 /ct → 404 纯文本 not found', async () => {
    const r = await srv.request({ path: '/ct', body: {} })
    assert.equal(r.status, 404)
    assert.equal(r.text, 'not found')
  })

  // —— Order 4: body 超限 → 413 ——
  test('body 超过 2MB（content-length 预声明超限）→ 413 payload-too-large', async () => {
    const big = JSON.stringify({ cwd: '/tmp', pad: 'x'.repeat(MAX_BODY_BYTES + 1) })
    const r = await srv.request({ path: '/ct/instructions.list', body: big })
    assert.equal(r.status, 413)
    assert.deepEqual(r.json, { ok: false, code: 'payload-too-large', message: 'request body exceeds 2097152 bytes' })
  })

  // 用原生 socket 实测 413（超 content-length 由 http server 直接中断，这里用等价断言：
  // 发送超过 2MB 的 body 应得到 413）。参考实现按流累计字节判定。
  test('body 恰好超过 2MB 的实际字节 → 413 payload-too-large', async () => {
    const big = '{"cwd":"/tmp","pad":"' + 'x'.repeat(MAX_BODY_BYTES + 10) + '"}'
    const r = await srv.request({ path: '/ct/instructions.list', body: big })
    assert.equal(r.status, 413)
  })

  // —— Order 6: 非法 JSON → 400 ——
  test('body 非空但非法 JSON → 400 bad-request / invalid JSON', async () => {
    const r = await srv.request({ path: '/ct/instructions.list', body: '{not json' })
    assert.equal(r.status, 400)
    assert.deepEqual(r.json, { ok: false, code: 'bad-request', message: 'invalid JSON' })
  })

  // —— Order 7: 方法名不在端点表 → 404 {error:'not found'}（字段名是 error 不是 code）——
  test('未注册方法 /ct/nope → 404，字段名 error（与 /sm 一致的历史形态）', async () => {
    const r = await srv.request({ path: '/ct/nope', body: {} })
    assert.equal(r.status, 404)
    assert.equal(r.json.ok, false)
    assert.equal(r.json.error, 'not found')
    // 刻意：这里没有 code 字段
    assert.equal('code' in r.json, false)
    assert.equal(r.json.message, undefined)
  })

  // —— body 非对象但不显式非法 JSON（例如裸 string/number）→ 400 body must be an object ——
  test('body 为裸数组（对象端点）→ 400 body must be an object', async () => {
    const r = await srv.request({ path: '/ct/instructions.list', body: '[]' })
    assert.equal(r.status, 400)
    assert.deepEqual(r.json, { ok: false, code: 'bad-request', message: 'body must be an object' })
  })

  test('空 body → 对 /ct/prompts 合法，对需要 body 的端点按 undefined 处理', async () => {
    // 空 body 视为 undefined；instructions.list 要求 body 为对象 → 400
    const r = await srv.request({ path: '/ct/instructions.list' })
    assert.equal(r.status, 400)
    assert.equal(r.json.code, 'bad-request')
  })

  test('请求体多余字段被忽略，不报错', async () => {
    const r = await srv.request({
      path: '/ct/instructions.list',
      body: { cwd: '/', _unrelated: 123, extra: ['x'] },
    })
    // cwd 合法，应正常走发现逻辑（发现对 / 返回 ok:true）
    assert.equal(r.status, 200)
    assert.equal(r.json.ok, true)
  })
})
