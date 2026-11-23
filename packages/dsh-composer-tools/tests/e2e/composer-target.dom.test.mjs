// composer 适配层（src/client/composer-target.ts）真实浏览器 DOM 测试。
//
// 为什么需要独立一层：适配层是纯 DOM 工具，node 没有 DOM；它的正确性依赖
// Lexical 真实渲染结构（块 = 直接子元素、Shift+Enter = 块内 <br>、空段落 =
// data-lexical-managed-linebreak 占位 <br>、选区偏移与文本同口径）。
// 这里用 Chromium 构造与 0.2.2 真机一致的 DOM 夹具，把 lib/composer-target.js
// 作为 ESM 模块注入页面后直接驱动，不依赖 dsh 实例。
//
// 运行：node tests/e2e/composer-target.dom.test.mjs（需要 playwright chromium）

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const MODULE_PATH = fileURLToPath(new URL('../../lib/composer-target.js', import.meta.url))

// 注意：真实 Lexical 不会在块之间留空白文本节点（DOM 由 reconciler 精确构建），
// 夹具必须同样紧凑——否则缩进会变成"额外文本块"，与真机 DOM 不符。
const FIXTURE = '<!doctype html><html><body>'
  + '<div id="panel"><input id="panel-input" value="panel"></div>'
  + '<div id="root" contenteditable="true" data-phase="plain" data-composer-input>'
  + '<p dir="auto"><span data-lexical-text="true">line1</span><br><span data-lexical-text="true">line2</span></p>'
  + '<p dir="auto"><br data-lexical-managed-linebreak="true"></p>'
  + '<p dir="auto"><span data-lexical-text="true">line3</span></p>'
  + '</div>'
  + '<div id="quote-root" contenteditable="true" data-phase="plain">'
  + '<p><span contenteditable="false" data-composer-quote=""><span>quoted text</span><button type="button">Removed</button></span></p>'
  + '</div>'
  + '<textarea id="ta" data-phase="plain"></textarea>'
  + '</body></html>'

const browser = await chromium.launch()
const page = await browser.newPage()
await page.setContent(FIXTURE)

// 以 Blob URL 注入构建产物（ESM），不改文件、不用再写一份实现。
const source = await readFile(MODULE_PATH, 'utf8')
await page.evaluate(async (code) => {
  const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }))
  window.__ct = await import(url)
}, source)

const results = await page.evaluate(() => {
  const ct = window.__ct
  const checks = []
  const check = (name, fn) => {
    try {
      checks.push({ name, ok: true, detail: String(fn()) })
    } catch (error) {
      checks.push({ name, ok: false, detail: String(error && error.stack ? error.stack : error) })
    }
  }
  const root = document.getElementById('root')
  const quoteRoot = document.getElementById('quote-root')
  const ta = document.getElementById('ta')
  const panelInput = document.getElementById('panel-input')
  const expected = 'line1\nline2\n\nline3'
  const p1 = root.children[0]
  const p2 = root.children[1]
  const p3 = root.children[2]
  const line2Text = p1.querySelectorAll('[data-lexical-text]')[1].firstChild
  const line3Text = p3.firstChild.firstChild
  const setCaret = (node, offset) => {
    const range = document.createRange()
    range.setStart(node, offset)
    range.collapse(true)
    const selection = window.getSelection()
    selection.removeAllRanges()
    selection.addRange(range)
  }
  const setRange = (node, start, endNode, end) => {
    const range = document.createRange()
    range.setStart(node, start)
    range.setEnd(endNode, end)
    const selection = window.getSelection()
    selection.removeAllRanges()
    selection.addRange(range)
  }
  const assertEq = (actual, want, label) => {
    if (JSON.stringify(actual) !== JSON.stringify(want)) {
      throw new Error(`${label}: got ${JSON.stringify(actual)} want ${JSON.stringify(want)}`)
    }
    return JSON.stringify(actual)
  }

  check('readComposerText：块间 \\n + 块内 <br> 换行 + 空段落占位不计', () =>
    assertEq(ct.readComposerText(root), expected, 'text'))
  check('resolveComposerElement：从内部 span 解析到可编辑根', () =>
    assertEq(ct.resolveComposerElement(line3Text)?.id, 'root', 'span'))
  check('resolveComposerElement：根自身可解析', () =>
    assertEq(ct.resolveComposerElement(root)?.id, 'root', 'root'))
  check('resolveComposerElement：面板输入框不是 composer → null', () =>
    assertEq(ct.resolveComposerElement(panelInput), null, 'panel'))
  check('resolveComposerElement：textarea[data-phase] 走 0.2.1 路径', () =>
    assertEq(ct.resolveComposerElement(ta)?.id, 'ta', 'ta'))
  check('adapter kind：contenteditable / textarea 区分', () =>
    assertEq([ct.createComposerAdapter(root).kind, ct.createComposerAdapter(ta).kind], ['contenteditable', 'textarea'], 'kind'))

  check('selection：光标在第二行行首（line1\\n 之后）', () => {
    setCaret(line2Text, 0)
    return assertEq(ct.readComposerSelection(root), { start: 6, end: 6 }, 'sel')
  })
  check('selection：光标在第三行行首（越过空段落）', () => {
    setCaret(line3Text, 0)
    return assertEq(ct.readComposerSelection(root), { start: 13, end: 13 }, 'sel')
  })
  check('selection：光标在空段落内', () => {
    setCaret(p2, 0)
    return assertEq(ct.readComposerSelection(root), { start: 12, end: 12 }, 'sel')
  })
  check('selection：跨行选区（line1 行首 → line2 第 2 字）', () => {
    const line1Text = p1.querySelectorAll('[data-lexical-text]')[0].firstChild
    setRange(line1Text, 0, line2Text, 2)
    return assertEq(ct.readComposerSelection(root), { start: 0, end: 8 }, 'sel')
  })
  check('selection：文档末尾（selectNodeContents + collapse(false)）', () => {
    const range = document.createRange()
    range.selectNodeContents(root)
    range.collapse(false)
    const selection = window.getSelection()
    selection.removeAllRanges()
    selection.addRange(range)
    return assertEq(ct.readComposerSelection(root), { start: expected.length, end: expected.length }, 'sel')
  })
  check('selection：选区不在本 composer 内 → null', () => {
    panelInput.focus()
    panelInput.setSelectionRange(1, 3)
    return assertEq(ct.readComposerSelection(root), null, 'sel')
  })

  check('setCaretToEnd：contenteditable 焦点在根内 → 光标落到文本末尾', () => {
    root.focus()
    const ok = ct.setComposerCaretToEnd(root)
    const sel = ct.readComposerSelection(root)
    assertEq(ok, true, 'ok')
    return assertEq(sel, { start: expected.length, end: expected.length }, 'sel')
  })
  check('setCaretToEnd：焦点在面板里 → 不动、返回 false', () => {
    panelInput.focus()
    return assertEq(ct.setComposerCaretToEnd(root), false, 'ok')
  })

  check('isComposerMenuOpen：plain + 无菜单 DOM → false', () => {
    root.setAttribute('data-phase', 'plain')
    return assertEq(ct.isComposerMenuOpen(root), false, 'menu')
  })
  check('isComposerMenuOpen：0.2.2 菜单打开（[data-trigger-menu]）即使 phase=plain → true', () => {
    const menu = document.createElement('div')
    menu.setAttribute('data-trigger-menu', '')
    document.body.append(menu)
    const open = ct.isComposerMenuOpen(root)
    menu.remove()
    return assertEq(open, true, 'menu')
  })
  check('isComposerMenuOpen：phase 非 plain（submitting/claimed/inert）→ true', () => {
    const out = ['submitting', 'adjudicating', 'claimed', 'inert'].map((phase) => {
      root.setAttribute('data-phase', phase)
      return ct.isComposerMenuOpen(root)
    })
    root.setAttribute('data-phase', 'plain')
    return assertEq(out, [true, true, true, true], 'menu')
  })
  check('isComposerMenuOpen：phase 属性缺失 → fail-safe true', () => {
    const probe = document.createElement('div')
    probe.setAttribute('contenteditable', 'true')
    document.body.append(probe)
    const open = ct.isComposerMenuOpen(probe)
    probe.remove()
    return assertEq(open, true, 'menu')
  })

  check('原子节点（quote）只取正文，跳过内部按钮文案', () =>
    assertEq(ct.readComposerText(quoteRoot), 'quoted text', 'quote'))
  check('空 contenteditable（提交后无子元素）→ 空串', () => {
    const empty = document.createElement('div')
    empty.setAttribute('contenteditable', 'true')
    empty.setAttribute('data-phase', 'plain')
    document.body.append(empty)
    const text = ct.readComposerText(empty)
    empty.remove()
    return assertEq(text, '', 'empty')
  })

  check('textarea adapter：getText / getSelection / setCaretToEnd', () => {
    ta.value = 'a\nb'
    ta.focus()
    ta.setSelectionRange(2, 3)
    const adapter = ct.createComposerAdapter(ta)
    assertEq(adapter.getText(), 'a\nb', 'text')
    assertEq(adapter.getSelection(), { start: 2, end: 3 }, 'sel')
    assertEq(adapter.setCaretToEnd(), true, 'ok')
    assertEq(adapter.getSelection(), { start: 3, end: 3 }, 'caret')
    return 'ok'
  })

  return checks
})

let failed = 0
for (const check of results) {
  const mark = check.ok ? '✔' : '✖'
  console.log(`${mark} ${check.name}`)
  if (!check.ok) {
    failed += 1
    console.log(`   ${check.detail.split('\n').slice(0, 6).join('\n   ')}`)
  }
}
console.log(`\n${results.length - failed}/${results.length} passed`)
await browser.close()
assert.equal(failed, 0, `${failed} composer-target DOM check(s) failed`)
