// 白盒单测：gate.ts（lib/gate.js 真实实现）
//
// 分工：验收测（test-06）用契约替身覆盖规则骨架；本文件直接用真实实现补
// 白盒边界：空/单行文本、多行首行行首/行中、末行末尾/行中、光标落点恰在
// '\n'、空文本 + menuOpen 组合、纯空白文本（多行=单行的判定）、
// 以及 selectionStart 越界文本长度时的行号计算。

import test from 'node:test'
import assert from 'node:assert/strict'
import { arrowGateAction } from '../../lib/gate.js'

/** 输入骨架；默认"成对光标、无选区、非合成、无修饰、菜单关、composer 目标"。 */
function input(over = {}) {
  const base = {
    isComposerTarget: true,
    key: 'ArrowUp',
    text: '',
    selectionStart: 0,
    selectionEnd: undefined,
    isComposing: false,
    shiftKey: false,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    menuOpen: false,
    ...over,
  }
  if (base.selectionEnd === undefined) base.selectionEnd = base.selectionStart
  return base
}

test.describe('gate.unit', () => {
  test.describe('空/单行文本', () => {
    test('空文本：↑ → older（空文本也算单行）', () => {
      assert.equal(arrowGateAction(input({ key: 'ArrowUp', text: '' })), 'older')
      assert.equal(arrowGateAction(input({ key: 'ArrowUp', text: '', selectionStart: 0, selectionEnd: 0 })), 'older')
    })
    test('空文本：↓ → newer', () => {
      assert.equal(arrowGateAction(input({ key: 'ArrowDown', text: '' })), 'newer')
    })
    test('单行文本按 ↑ 无论光标列 → older', () => {
      assert.equal(arrowGateAction(input({ text: 'hello', selectionStart: 0 })), 'older')
      assert.equal(arrowGateAction(input({ text: 'hello world', selectionStart: 11 })), 'older')
    })
  })

  test.describe('多行：首行/中间/末行边界', () => {
    const T = 'line1\nline2\nline3\nline4'
    test('首行行首（cursor=0）↑ → older', () => {
      assert.equal(arrowGateAction(input({ text: T, selectionStart: 0 })), 'older')
    })
    test('首行末尾（光标在第一个 \\n 前）↑ → older', () => {
      assert.equal(arrowGateAction(input({ text: T, selectionStart: 5 })), 'older')
    })
    test('中间行任意位置 ↑/↓ → null', () => {
      // cursor 落第二行（索引 6..11 之间）
      assert.equal(arrowGateAction(input({ text: T, selectionStart: 7 })), null)
      assert.equal(arrowGateAction(input({ key: 'ArrowDown', text: T, selectionStart: 11 })), null)
    })
    test('末行行首（光标恰在倒数第二个 \\n 之后）/行中/末尾 ↑ → null', () => {
      // 末行 = 'line4'，起点在 'line4' 的 'l' 前 = 18
      assert.equal(arrowGateAction(input({ text: T, selectionStart: 18 })), null)
      assert.equal(arrowGateAction(input({ text: T, selectionStart: 21 })), null)
    })
    test('末行行中/末尾 ↓ → newer', () => {
      assert.equal(arrowGateAction(input({ key: 'ArrowDown', text: T, selectionStart: 21 })), 'newer')
      assert.equal(arrowGateAction(input({ key: 'ArrowDown', text: T, selectionStart: 23 })), 'newer')
    })
    test('光标恰在末行末尾（=text.length）按 ↓ → newer', () => {
      assert.equal(arrowGateAction(input({ key: 'ArrowDown', text: T, selectionStart: T.length })), 'newer')
    })
  })

  test.describe('光标落点恰在 \\n', () => {
    const TX = 'a\nb'
    test('cursor 恰在首行结尾的 \\n 位置（index 1）→ 属第一行，↑ → older', () => {
      // slice(0,1)='a' → 0 个换行 → 行号 0
      assert.equal(arrowGateAction(input({ text: TX, selectionStart: 1 })), 'older')
    })
    test('cursor 恰在第二行行首（index 2，紧跟 \\n）→ 属第二行，↑ → null', () => {
      assert.equal(arrowGateAction(input({ text: TX, selectionStart: 2 })), null)
    })
    test('cursor 恰在第二行行首按 ↓ → newer', () => {
      assert.equal(arrowGateAction(input({ key: 'ArrowDown', text: TX, selectionStart: 2 })), 'newer')
    })
  })

  test.describe('纯空白文本（多字符但无换行 → 仍单行）', () => {
    test('空白文本 ↑ → older（无 \\n → 单行判定）', () => {
      assert.equal(arrowGateAction(input({ text: '   ', selectionStart: 1 })), 'older')
    })
  })

  test.describe('menuOpen + 单行组合', () => {
    test('menuOpen=true 时即使单行也放行 null（方向键归菜单）', () => {
      assert.equal(arrowGateAction(input({ text: 'hello', selectionStart: 0, menuOpen: true })), null)
    })
    test('menuOpen 优先级高于多行末行判定', () => {
      assert.equal(arrowGateAction(input({ key: 'ArrowDown', text: 'a\nb', selectionStart: 3, menuOpen: true })), null)
    })
  })
})
