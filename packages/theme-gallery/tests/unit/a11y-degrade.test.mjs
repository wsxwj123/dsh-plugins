/**
 * a11y-degrade.test.mjs — a11y 缺失降级语义（评审 F3，INTERFACE §3.3/§8 项4）。
 *
 * 契约：a11y.css 缺失或解析失败 → 记录 `[theme-gallery-a11y] <id>: <reason>`，
 * 且不影响皮肤本体加载（皮肤仍可激活）。本测试构造 a11y 缺失场景，断言：
 *   - 皮肤本体仍可激活（body 属性出现、皮肤内置 style 注入）；
 *   - 注入器返回 null / 不抛错；
 *   - 日志含 [theme-gallery-a11y] <id>。
 */
import { test, describe, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { loadClient } from './client-harness.mjs'

const FLUSH = () => new Promise((r) => setTimeout(r, 0))
const settle = async (n = 6) => { for (let i = 0; i < n; i++) await FLUSH() }
const active = []
afterEach(() => { while (active.length) active.pop().cleanup?.() })

describe('F3 — a11y 缺失降级', () => {
  test('a11y.css 缺失的皮肤仍可加载激活，且日志含 [theme-gallery-a11y]', async () => {
    const warns = []
    const origWarn = console.warn
    console.warn = (...args) => { warns.push(args.join(' ')) }
    try {
      // bundles 用真实 client.js，但 a11yOverride 完全不含 qq98（模拟其 a11y.css 缺失）。
      const h = await loadClient({ a11yOverride: { qq98: '' } })
      // 预先注册日志（client-harness 用 console.warn 走 a11y injector 的 log）。
      await h.api.activateSkin('qq98')
      await settle()
      // 皮肤本体仍加载：body 属性出现。
      assert.equal(h.document.body.hasAttribute('data-dsh-retro'), true, '皮肤本体仍加载')
      assert.equal(h.api.currentSkinState().active, true, '皮肤仍可激活')
      // 降级日志
      const recorded = warns.join('\n')
      assert.match(recorded, /\[theme-gallery-a11y\] qq98/, '应记录 a11y 降级日志')
      // 无 a11y style 注入（因为缺失）
      assert.equal(h.document.querySelectorAll('style[data-theme-gallery-a11y="qq98"]').length, 0, '缺失时不注入 a11y style')
    } finally {
      console.warn = origWarn
    }
  })

  test('正常皮肤的 a11y 仍注入（对照：不误伤已有修正）', async () => {
    const h = await loadClient() // 真实 a11y
    await h.api.activateSkin('qq98')
    await settle()
    assert.equal(h.document.body.hasAttribute('data-dsh-retro'), true)
    assert.equal(h.document.querySelectorAll('style[data-theme-gallery-a11y="qq98"]').length, 1, '正常皮肤应有 a11y style')
  })
})
