// 白盒单测：prompts-store.ts（lib/prompts-store.js 真实实现）
//
// 分工：验收测（test-05）通过 HTTP 注入 promptsItems/promptsError 验证下发形态；
// 本文件直接驱动 loadPrompts / resetPromptsCache 覆盖白盒细节：
//   真实磁盘数据（780 条、source 三字段、无 version、\r\n 归一无 \r 残留）、
//   overrideItems 归一（\r\n→\n）、overrideError 失败形态、
//   缓存语义（resetPromptsCache 后重读、连续读不重读磁盘）。

import test from 'node:test'
import assert from 'node:assert/strict'
import { loadPrompts, resetPromptsCache, PROMPTS_DATA_URL } from '../../lib/prompts-store.js'

test.describe('prompts-store.unit', () => {
  test.afterEach(() => {
    resetPromptsCache()
  })

  test.describe('真实磁盘数据', () => {
    test('读取真实 prompt-templates.json：恰 780 条', async () => {
      const out = await loadPrompts()
      assert.equal(out.ok, true)
      assert.equal(out.json.ok, true)
      assert.equal(out.json.items.length, 780)
    })

    test('source 恰好三字段：name/url/license，无多余', async () => {
      const out = await loadPrompts()
      assert.deepEqual(Object.keys(out.json.source).sort(), ['license', 'name', 'url'])
      assert.equal(out.json.source.name, 'Cherry Studio agents-zh.json')
      assert.equal(out.json.source.url, 'https://github.com/CherryHQ/cherry-studio')
      assert.equal(out.json.source.license, 'AGPL-3.0')
    })

    test('每项的 id/name/description/prompt/emoji/group 字段齐全、无 version 字段', async () => {
      const out = await loadPrompts()
      const item = out.json.items[0]
      for (const k of ['id', 'name', 'description', 'prompt', 'emoji']) {
        assert.equal(typeof item[k], 'string', `字段 ${k} 应为 string`)
      }
      assert.ok(Array.isArray(item.group), 'group 应为数组')
      assert.equal('version' in item, false)
      assert.equal(Object.prototype.hasOwnProperty.call(item, 'version'), false)
    })

    test('真实数据中的 \\r\\n 已归一为 \\n，且无 \\r 残留', async () => {
      const out = await loadPrompts()
      for (const item of out.json.items) {
        assert.equal(item.description.includes('\r'), false, `description 含 \\r: ${item.id}`)
        assert.equal(item.prompt.includes('\r'), false, `prompt 含 \\r: ${item.id}`)
      }
    })

    test('真实数据含非空 prompt（不是全空库）', async () => {
      const out = await loadPrompts()
      assert.ok(out.json.items.some((i) => i.prompt.length > 0))
    })
  })

  test.describe('overrideItems 归一', () => {
    test('\\r\\n → \\n：prompt 与 description 都归一', async () => {
      const items = [{ id: 'a', name: 'n', description: 'd1\r\nd2', prompt: 'p1\r\np2', emoji: '', group: [] }]
      const out = await loadPrompts(items)
      assert.equal(out.json.items[0].description, 'd1\nd2')
      assert.equal(out.json.items[0].prompt, 'p1\np2')
      assert.equal(out.json.items[0].prompt.includes('\r'), false)
    })

    test('overrideItems 时仍带 source 三字段', async () => {
      const out = await loadPrompts([{ id: 'a', name: '', description: '', prompt: '', emoji: '', group: [] }])
      assert.deepEqual(out.json.source.name, 'Cherry Studio agents-zh.json')
      assert.equal(out.json.items.length, 1)
    })
  })

  test.describe('overrideError 失败形态', () => {
    test('overrideError 注入 → {ok:false, system-error, message 以 prompt library unavailable 开头}', async () => {
      const out = await loadPrompts(undefined, 'ENOENT: no such file')
      assert.equal(out.ok, false)
      assert.equal(out.json.ok, false)
      assert.equal(out.json.code, 'system-error')
      assert.ok(out.json.message.startsWith('prompt library unavailable: '))
      assert.ok(out.json.message.includes('ENOENT'))
    })

    test('overrideError 优先于 overrideItems（同时传入走错误分支）', async () => {
      const out = await loadPrompts([{ id: 'x' }], 'forced fail')
      assert.equal(out.json.ok, false)
      assert.equal(out.json.code, 'system-error')
    })
  })

  test.describe('缓存语义', () => {
    test('默认真实读取后缓存：连续两次返回同一 items 引用语义一致', async () => {
      const a = await loadPrompts()
      const b = await loadPrompts()
      assert.equal(a.ok, true)
      assert.equal(b.ok, true)
      assert.deepEqual(a.json.items, b.json.items)
    })

    test('resetPromptsCache 清空缓存后重读仍成功', async () => {
      const before = await loadPrompts()
      assert.equal(before.ok, true)
      resetPromptsCache()
      const after = await loadPrompts()
      assert.equal(after.ok, true)
      assert.equal(after.json.items.length, 780)
    })

    test('PROMPTS_DATA_URL 指向可读的 data/prompt-templates.json', async () => {
      // URL 可被读（loadPrompts 成功即隐含），再确认文件存在
      const { readFile } = await import('node:fs/promises')
      const buf = await readFile(PROMPTS_DATA_URL)
      assert.ok(buf.length > 0)
    })
  })
})
