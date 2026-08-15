// client 门槛判定（gate.ts / INTERFACE §2.1）契约测试
// 覆盖：单行恒放行 / 多行首行↑/末行↓ / 中间行 null / ←→ null /
// 修饰键 / IME / 有选区 / menuOpen / 非 composert 目标 —— 每种组合精确断言。
//
// 接入说明：arrowGateAction 从 helpers/contractClient 导入（契约参考实现）。
// 真实客户端导出同名函数后，仅需改这一行 import 源。

import test from 'node:test'
import assert from 'node:assert/strict'
import { arrowGateAction } from './helpers/contractClient.mjs'

// 构造输入的默认骨架；覆盖需要的字段即可
// 注意：默认 selectionEnd 跟随 selectionStart，保证"无选区"；要造选区再显式覆盖 end。
function base(over = {}) {
  const o = {
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
  if (o.selectionEnd === undefined) o.selectionEnd = o.selectionStart
  return o
}

test.describe('arrowGateAction 方向键门槛', () => {
  // —— 单行恒放行（无论光标列位置）——
  test('单行：光标在开头按 ↑ → older', () => {
    assert.equal(arrowGateAction(base({ text: 'hello', selectionStart: 0 })), 'older')
  })
  test('单行：光标在末尾按 ↑ → older', () => {
    assert.equal(arrowGateAction(base({ text: 'hello', selectionStart: 5, selectionEnd: 5 })), 'older')
  })
  test('单行：光标在中间任意列按 ↑ → older', () => {
    assert.equal(arrowGateAction(base({ text: 'hello world', selectionStart: 5 })), 'older')
  })
  test('单行：按 ↓ → newer', () => {
    assert.equal(arrowGateAction(base({ key: 'ArrowDown', text: 'hi', selectionStart: 1 })), 'newer')
  })

  // —— 多行首行 / 末行 ——
  test('多行：光标在第一行任意列按 ↑ → older', () => {
    // 第一行任意列：col 0 或 col 中间
    assert.equal(arrowGateAction(base({ text: 'line1\nline2\nline3', selectionStart: 0 })), 'older')
    assert.equal(arrowGateAction(base({ text: 'line1\nline2\nline3', selectionStart: 4 })), 'older')
    assert.equal(arrowGateAction(base({ text: 'line1\nline2', selectionStart: 5 })), 'older')
  })
  test('多行：光标在末行任意列按 ↓ → newer', () => {
    assert.equal(arrowGateAction(base({ key: 'ArrowDown', text: 'a\nb\nc', selectionStart: 4 })), 'newer')
    // 末行末尾
    assert.equal(arrowGateAction(base({ key: 'ArrowDown', text: 'a\nb\ncc', selectionStart: 6, selectionEnd: 6 })), 'newer')
  })
  test('多行：末行按 ↑ → null（光标不在第一行）', () => {
    assert.equal(arrowGateAction(base({ text: 'a\nb\nc', selectionStart: 4 })), null)
  })
  test('多行：第一行按 ↓ → null（光标不在末行）', () => {
    assert.equal(arrowGateAction(base({ key: 'ArrowDown', text: 'a\nb\nc', selectionStart: 0 })), null)
  })

  // —— 中间行 ——
  test('多行：中间行按 ↑ → null', () => {
    assert.equal(arrowGateAction(base({ text: 'a\nb\nc\nd', selectionStart: 3 })), null)
    assert.equal(arrowGateAction(base({ text: 'a\nb\nc\nd', selectionStart: 4 })), null)
  })
  test('多行：中间行按 ↓ → null', () => {
    assert.equal(arrowGateAction(base({ key: 'ArrowDown', text: 'a\nb\nc\nd', selectionStart: 3 })), null)
  })

  // —— ←/→ 永不触发 ——
  test('按 ArrowLeft / ArrowRight → 永远 null', () => {
    assert.equal(arrowGateAction(base({ key: 'ArrowLeft', text: 'hello', selectionStart: 0 })), null)
    assert.equal(arrowGateAction(base({ key: 'ArrowRight', text: 'hello', selectionStart: 0 })), null)
    assert.equal(arrowGateAction(base({ key: 'ArrowLeft', text: 'a\nb', selectionStart: 0 })), null)
    assert.equal(arrowGateAction(base({ key: 'ArrowRight', text: 'a\nb', selectionStart: 0 })), null)
  })

  // —— 修饰键 ——
  test('shift/cmd/ctrl/alt 任一按住 → null', () => {
    const t = { text: 'hello', selectionStart: 0 }
    assert.equal(arrowGateAction(base({ ...t, shiftKey: true })), null)
    assert.equal(arrowGateAction(base({ ...t, metaKey: true })), null)
    assert.equal(arrowGateAction(base({ ...t, ctrlKey: true })), null)
    assert.equal(arrowGateAction(base({ ...t, altKey: true })), null)
    assert.equal(arrowGateAction(base({ ...t, shiftKey: true, metaKey: true })), null)
  })

  // —— IME 合成 ——
  test('IME 合成期（isComposing=true）→ null', () => {
    assert.equal(arrowGateAction(base({ text: 'hello', selectionStart: 0, isComposing: true })), null)
    // 即便单行、末行也放行场景，合成期一律不放行
    assert.equal(arrowGateAction(base({ key: 'ArrowDown', text: 'a\nb\nc', selectionStart: 4, isComposing: true })), null)
  })

  // —— 有选区 ——
  test('有选区（selectionStart !== selectionEnd）→ null', () => {
    assert.equal(arrowGateAction(base({ text: 'hello', selectionStart: 1, selectionEnd: 3 })), null)
    assert.equal(arrowGateAction(base({ text: 'a\nb', selectionStart: 0, selectionEnd: 2 })), null)
  })

  // —— menuOpen ——
  test('命令菜单打开（menuOpen=true）→ null（方向键归菜单）', () => {
    assert.equal(arrowGateAction(base({ text: 'hello', selectionStart: 0, menuOpen: true })), null)
    assert.equal(arrowGateAction(base({ key: 'ArrowDown', text: 'a\nb\nc', selectionStart: 4, menuOpen: true })), null)
  })

  // —— 焦点前置 ——
  test('非 composer 目标（isComposerTarget=false）→ 一律放行 null（面板编辑不被劫持）', () => {
    assert.equal(arrowGateAction(base({ isComposerTarget: false, text: 'hello', selectionStart: 0 })), null)
    assert.equal(arrowGateAction(base({ isComposerTarget: false, key: 'ArrowDown', text: 'a\nb\nc', selectionStart: 4 })), null)
    assert.equal(arrowGateAction(base({ isComposerTarget: false, key: 'ArrowLeft' })), null)
  })

  // —— 优先级：前面条件先于单行/多行 ——
  test('多键同时满足时，靠前的判定优先（修饰键>IME>menu>选区>多行）', () => {
    // 有选区 + 单行 → 选区(null) 优先，不会被单行放行
    assert.equal(arrowGateAction(base({ text: 'hello', selectionStart: 1, selectionEnd: 2 })), null)
    // menuOpen + 末行↓ → menuOpen 优先
    assert.equal(arrowGateAction(base({ key: 'ArrowDown', text: 'a\nb', selectionStart: 3, menuOpen: true })), null)
    // IME + 单行 → IME 优先
    assert.equal(arrowGateAction(base({ text: 'hello', isComposing: true })), null)
  })
})
