// client 提示词追加（append.ts / INTERFACE §2.5）契约测试
// 规则：空 → 直接放；\n\n 结尾 → 不重复补空行；\n 结尾 → 补一个 \n；
// 其余 → 补 \n\n。永不覆盖、永不自动发送。
//
// 接入：appendPromptToDraft 从 helpers/contractClient 导入；换真实实现改 import 源。

import test from 'node:test'
import assert from 'node:assert/strict'
import { appendPromptToDraft } from './helpers/contractClient.mjs'

test.describe('appendPromptToDraft 提示词追加', () => {
  test('空输入直接放 prompt（不补空行）', () => {
    assert.equal(appendPromptToDraft('', 'P'), 'P')
  })
  test('以 \\n\\n 结尾：不重复补空行', () => {
    assert.equal(appendPromptToDraft('a\n\n', 'P'), 'a\n\nP')
    assert.equal(appendPromptToDraft('a\nb\n\n', 'P'), 'a\nb\n\nP')
  })
  test('以 \\n 结尾：补一个 \\n（凑成空行）', () => {
    assert.equal(appendPromptToDraft('a\n', 'P'), 'a\n\nP')
    assert.equal(appendPromptToDraft('x\n', 'P'), 'x\n\nP')
  })
  test('其余情况：先补 \\n\\n 再追加', () => {
    assert.equal(appendPromptToDraft('a', 'P'), 'a\n\nP')
    assert.equal(appendPromptToDraft('a b', 'P'), 'a b\n\nP')
    assert.equal(appendPromptToDraft('中文字符', 'P'), '中文字符\n\nP')
  })
  test('prompt 本身含 \\n 原样保留（不覆盖、不丢字）', () => {
    assert.equal(appendPromptToDraft('a', 'L1\nL2'), 'a\n\nL1\nL2')
  })
  test('永不覆盖：原 draft 永远保留在前', () => {
    const draft = '原始内容'
    const out = appendPromptToDraft(draft, 'P')
    assert.ok(out.startsWith(draft), '原 draft 必须原样保留在开头')
  })
  // 边界：空 prompt
  test('prompt 为空字符串', () => {
    assert.equal(appendPromptToDraft('a', ''), 'a\n\n')
  })
})
