// host RPC 端点 /ct/prompts — 提示词库全量下发 契约测试（INTERFACE §1.4）
// 正常路径（items 完整、\r\n 归一、source 含来源与 AGPL-3.0 标注）、
// body 约定、数据不可读 → system-error、重复请求缓存语义（单测层面以幂等性体现）。

import test from 'node:test'
import assert from 'node:assert/strict'
import { createHttpHarness } from './helpers/http.mjs'
import { ROUTER } from './helpers/contractHost.mjs'

test.describe('POST /ct/prompts 提示词库', () => {
  let srv

  test.beforeEach(async () => {
    const items = [
      { id: 'a', name: '翻译', description: 'desc a\r\nline2', prompt: '请翻译：\r\n{text}', emoji: '🌐', group: ['工具'] },
      { id: 'b', name: '代码', description: 'desc b', prompt: 'inline', emoji: '💻', group: ['开发'] },
    ]
    srv = await createHttpHarness((req, res) => ROUTER(req, res, { promptsItems: items }))
  })
  test.afterEach(async () => {
    await srv.stop()
  })

  test('正常下发：items 字段完整、source 含来源与 AGPL-3.0 标注', async () => {
    const r = await srv.request({ path: '/ct/prompts', body: {} })
    assert.equal(r.status, 200)
    assert.equal(r.json.ok, true)
    assert.deepEqual(r.json.source, {
      name: 'Cherry Studio agents-zh.json',
      url: 'https://github.com/CherryHQ/cherry-studio',
      license: 'AGPL-3.0',
    })
    assert.equal(r.json.items.length, 2)
    assert.equal(r.json.items[0].id, 'a')
    assert.equal(r.json.items[0].name, '翻译')
    assert.equal(r.json.items[0].emoji, '🌐')
    assert.deepEqual(r.json.items[0].group, ['工具'])
  })

  test('\\r\\n 归一为 \\n：description 与 prompt 都归一', async () => {
    const r = await srv.request({ path: '/ct/prompts', body: {} })
    assert.equal(r.json.items[0].description, 'desc a\nline2', 'description 里的 \\r\\n 应变 \\n')
    assert.equal(r.json.items[0].prompt, '请翻译：\n{text}', 'prompt 里的 \\r\\n 应变 \\n')
    // 没有 \r 残留
    assert.equal(r.json.items[0].prompt.includes('\r'), false)
  })

  test('空 body 等价于 {} 都能成功', async () => {
    const r1 = await srv.request({ path: '/ct/prompts' })
    const r2 = await srv.request({ path: '/ct/prompts', body: {} })
    assert.equal(r1.json.ok, true)
    assert.equal(r2.json.ok, true)
    assert.equal(r1.json.items.length, r2.json.items.length)
  })

  test('body 非对象（裸数组）→ 400 body must be an object', async () => {
    const r = await srv.request({ path: '/ct/prompts', body: '[]' })
    assert.equal(r.status, 400)
    assert.deepEqual(r.json, { ok: false, code: 'bad-request', message: 'body must be an object' })
  })

  test('数据文件不可读 → 200 system-error（message 以 "prompt library unavailable: " 开头）', async () => {
    // 用注入错误模拟宿主读数据失败
    const srv2 = await createHttpHarness((req, res) => ROUTER(req, res, { promptsError: 'ENOENT' }))
    try {
      const r = await srv2.request({ path: '/ct/prompts', body: {} })
      assert.equal(r.status, 200)
      assert.equal(r.json.ok, false)
      assert.equal(r.json.code, 'system-error')
      assert.ok(r.json.message.startsWith('prompt library unavailable: '), r.json.message)
    } finally {
      await srv2.stop()
    }
  })

  test('重复请求幂等：两次返回同样的 items', async () => {
    const a = await srv.request({ path: '/ct/prompts', body: {} })
    const b = await srv.request({ path: '/ct/prompts', body: {} })
    assert.deepEqual(a.json.items, b.json.items)
    assert.deepEqual(a.json.source, b.json.source)
  })
})
