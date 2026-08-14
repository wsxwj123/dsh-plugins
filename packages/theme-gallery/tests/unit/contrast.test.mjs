/**
 * contrast.test.mjs — 可访问性修正层达标测试（INTERFACE §3.2 / §3.3）。
 *
 * 对 9 款皮肤分别在亮、暗两态断言运算后的关键三元对比度（WCAG AA）：
 *   - 代码块正文：前景 label-primary，背景 markdown-code-block（含 alpha 合成到页面基底）
 *   - 行内代码：前景 label-primary，背景 markdown-inline-code
 *   - 主按钮文字：前景 label-primary-foreground，背景 button-primary-fill / -hover
 *   （普通正文与气泡 token 层已达标，且与 a11y 无关，不在本测试重复断言。）
 *
 * a11y override 以「同名 token 在 body[data-dsh-<id>] 作用域内后定义者胜」合并，
 * 与真实注入顺序一致（skin CSS → a11y CSS 后注入）。alpha 背景按 alpha 合成到
 * --dsw-alias-bg-base（页面基底）后再算有效对比。
 *
 * 另断言降级语义：a11y.css 缺失时仅影响修正，不影响皮肤本体可加载（由引擎测试覆盖）。
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'

const SKINS_DIR = new URL('../../skins/', import.meta.url)
const SKIN_LIST = ['qq98', 'ths', 'xp', 'blue-fantasy', 'dragon-heir', 'minecraft', 'whale-song', 'trading', 'miku']

// ---- 颜色解析 / 亮度 / 对比度 ----
function parse(color) {
  let c = String(color).trim()
  if (c.startsWith('#')) {
    let h = c.slice(1)
    if (h.length === 3) h = h.split('').map((x) => x + x).join('')
    if (h.length === 6) h += 'ff'
    const hex = (i) => parseInt(h.slice(i, i + 2), 16)
    return [hex(0) / 255, hex(2) / 255, hex(4) / 255, h.length === 8 ? hex(6) / 255 : 1]
  }
  if (/^rgba?\(/.test(c)) {
    const m = c.match(/[\d.]+/g)
    return [Number(m[0]) / 255, Number(m[1]) / 255, Number(m[2]) / 255, m.length > 3 ? Number(m[3]) : 1]
  }
  return null
}
const lin = (v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4))
const luminance = (c) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2])
function contrast(fg, bg) {
  const a = luminance(fg)
  const b = luminance(bg)
  const hi = Math.max(a, b)
  const lo = Math.min(a, b)
  return (hi + 0.05) / (lo + 0.05)
}
function composite(fg, bg) {
  const a = fg[3]
  return [fg[0] * a + bg[0] * (1 - a), fg[1] * a + bg[1] * (1 - a), fg[2] * a + bg[2] * (1 - a), 1]
}
/** 有效对比：背景若有 alpha 先合成到基底，再与前景比。 */
function effectiveContrast(fgStr, bgStr, base) {
  const fp = parse(fgStr)
  const bp = parse(bgStr)
  if (!fp || !bp) return NaN
  const effBg = bp.length === 4 && bp[3] < 1 ? composite(bp, base) : bp
  return contrast(fp, effBg)
}

/** 从皮肤 CSS / a11y 文本提取 token 表（亮/暗）。去掉 CSS 注释避免干扰选择器匹配。 */
function parseTokens(css, into) {
  css = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const re = /body\[data-dsh-[a-z0-9-]+\](?:\[data-ds-dark-theme\])?\s*\{([^{}]*)\}/g
  let m
  while ((m = re.exec(css))) {
    const isDark = m[0].includes('data-ds-dark-theme')
    const t = isDark ? into.dark : into.light
    const tok = /--(dsw-alias-[a-z0-9-]+):\s*([^;]+);/g
    let tm
    while ((tm = tok.exec(m[1]))) t['--' + tm[1]] = tm[2].trim()
  }
  return into
}
async function readSkinCss(id) {
  const text = await readFile(new URL(`${id}/client.js`, SKINS_DIR), 'utf8')
  const m = text.match(/const css = "([\s\S]*?)";\s*\n\s*const tagId/)
  assert.ok(m, `无法解析 ${id} 的 css 字符串`)
  return m[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\')
}
async function readA11y(id) {
  try { return await readFile(new URL(`${id}/a11y.css`, SKINS_DIR), 'utf8') } catch { return '' }
}

describe('皮肤可访问性修正达标（9 款 × 亮暗）', () => {
  test(`9 款皮肤清单与目录一致`, async () => {
    const dirs = await readdir(SKINS_DIR, { withFileTypes: true })
    const names = dirs.filter((d) => d.isDirectory()).map((d) => d.name)
    assert.deepEqual([...names].sort(), [...SKIN_LIST].sort(), '皮肤目录与清单一致')
  })

  for (const id of SKIN_LIST) {
    test(`${id}：代码块 / 行内码 / 主按钮在亮暗两态对比 ≥ 4.5`, async () => {
      const css = await readSkinCss(id)
      const a11y = await readA11y(id)
      const skin = parseTokens(css, { light: {}, dark: {} })
      const over = parseTokens(a11y, { light: {}, dark: {} })
      const merged = { light: { ...skin.light, ...over.light }, dark: { ...skin.dark, ...over.dark } }
      const baseC = parse(merged.light['--dsw-alias-bg-base'] || '#fff')

      for (const mode of ['light', 'dark']) {
        const t = merged[mode]
        if (!t['--dsw-alias-label-primary']) continue // minecraft 无独立暗色
        const label = (name, fg, bg) => {
          const fgs = fg ? String(fg) : null
          const bgs = bg ? String(bg) : null
          if (!fgs || !bgs) return
          const r = effectiveContrast(fgs, bgs, baseC)
          assert.ok(!Number.isNaN(r) && r >= 4.5,
            `${id}/${mode}/${name} 对比 ${r?.toFixed?.(2) ?? r} < 4.5 (fg=${fgs}, bg=${bgs})`)
        }
        const primary = (key) => t[key]
        label('code', primary('--dsw-alias-label-primary'), primary('--dsw-alias-markdown-code-block'))
        label('inline', primary('--dsw-alias-label-primary'), primary('--dsw-alias-markdown-inline-code'))
        if (t['--dsw-alias-button-primary-fill']) {
          label('btnFill', t['--dsw-alias-label-primary-foreground'] || '#fff', t['--dsw-alias-button-primary-fill'])
        }
        if (t['--dsw-alias-button-primary-hover']) {
          label('btnHover', t['--dsw-alias-label-primary-foreground'] || '#fff', t['--dsw-alias-button-primary-hover'])
        }
      }
    })
  }
})
