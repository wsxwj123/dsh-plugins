// 白盒单测：append.ts（lib/append.js 真实实现）
//
// 分工：验收测（test-09）用契约替身覆盖 4 条规则主路径；本文件用真实实现补
// 边界：多空行结尾、单 '\n' 结尾、current='\n'/'\n\n' 特殊串、prompt 为空串、
// prompt 带尾随换行、永不覆盖属性的更强断言（前缀精确匹配）。

import test from 'node:test'
import assert from 'node:assert/strict'
import { appendPromptToDraft } from '../../lib/append.js'

test.describe('append.unit', () => {
  test('空输入直接放 prompt（即使 prompt 为空串）', () => {
    assert.equal(appendPromptToDraft('', 'P'), 'P')
    assert.equal(appendPromptToDraft('', ''), '')
  })

  test('current 以 \\n\\n 结尾：不重复补，直接追加（含多空行）', () => {
    assert.equal(appendPromptToDraft('a\n\n', 'P'), 'a\n\nP')
    assert.equal(appendPromptToDraft('a\n\n\n', 'P'), 'a\n\n\nP') // 多余空行保留
  })

  test('current 恰好就是 \\n\\n → 直接追加（命中规则 2）', () => {
    assert.equal(appendPromptToDraft('\n\n', 'P'), '\n\nP')
  })

  test('current 以单个 \\n 结尾：补一个 \\n', () => {
    assert.equal(appendPromptToDraft('a\n', 'P'), 'a\n\nP')
    assert.equal(appendPromptToDraft('x\n', 'P'), 'x\n\nP')
  })

  test('current 恰好就是单个 \\n → 补一个 \\n 成空行', () => {
    assert.equal(appendPromptToDraft('\n', 'P'), '\n\nP')
  })

  test('不以 \\n 结尾：补空行 \\n\\n 再追加', () => {
    assert.equal(appendPromptToDraft('a', 'P'), 'a\n\nP')
    assert.equal(appendPromptToDraft('a ', 'P'), 'a \n\nP') // 尾随空格不算换行
    assert.equal(appendPromptToDraft('中文字', 'P'), '中文字\n\nP')
  })

  test('prompt 本身含 \\n 与尾随换行都原样保留', () => {
    assert.equal(appendPromptToDraft('a', 'L1\nL2\n'), 'a\n\nL1\nL2\n')
  })

  test('prompt 为空串：各分支下只产生连接符', () => {
    assert.equal(appendPromptToDraft('a', ''), 'a\n\n')
    assert.equal(appendPromptToDraft('a\n', ''), 'a\n\n')
    assert.equal(appendPromptToDraft('a\n\n', ''), 'a\n\n')
  })

  test('永不覆盖强断言：原 draft 必须在结果最前且原样保留', () => {
    const draft = '\n# keep me\n'
    const out = appendPromptToDraft(draft, 'P')
    assert.ok(out.startsWith(draft), `结果必须以原 draft 开头: ${JSON.stringify(out)}`)
  })
})
