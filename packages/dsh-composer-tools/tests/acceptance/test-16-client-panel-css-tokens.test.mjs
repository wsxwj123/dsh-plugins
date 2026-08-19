// panel.css 主题令牌化静态断言（Bug 1+2 回归）。
//
// 用户实测：浅色主题 + 皮肤下面板的级别标签/主按钮/错误条「看不清」。根因是这些
// 颜色按深色主题写死（#9db4ff / #2f6fdb / #ff8f8f / rgba(0,0,0,.45) …），不跟随
// dsh 的 --dsw-alias-* 令牌，所以浅色底上就是浅色字。
//
// 本文件只做静态断言（颜色对比度靠令牌体系保证，不在 node 里重算渲染值）：
//   1. panel.css 里不得出现任何硬编码颜色字面量（#rgb / rgb() / rgba() / hsl()
//      / 颜色关键字）——阴影等确需的例外也必须走令牌或 color-mix。
//   2. 引用的 --dsw-* 令牌必须在 dsh web 真实定义的令牌集合内（打错名字的令牌不会
//      报错，只会静默失效，回到"看不清"）。
//   3. 三个级别标签（全局/项目/本地）用彼此不同的色相令牌，保持可区分。

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const CSS_PATH = fileURLToPath(new URL('../../src/client/panel.css', import.meta.url))
const css = readFileSync(CSS_PATH, 'utf8')

/**
 * dsh web 基础样式表 body{} / body[data-ds-dark-theme]{} 里实际定义、且被
 * dsh-appearance-gallery 的 15 套主题 × 皮肤覆盖的令牌（真机 /assets/index-*.css
 * 与 gallery themes.curated.js 双向核对过）。新增令牌需先确认宿主真的定义了它。
 */
const KNOWN_TOKENS = new Set([
  '--dsw-alias-bg-module-platform',
  '--dsw-alias-bg-base',
  '--dsw-alias-bg-layer-1',
  '--dsw-alias-bg-layer-2',
  '--dsw-alias-bg-overlay',
  '--dsw-alias-border-l1',
  '--dsw-alias-border-l2',
  '--dsw-alias-brand-primary',
  '--dsw-alias-button-primary-fill',
  '--dsw-alias-button-primary-hover',
  '--dsw-alias-button-tool-bar-fill',
  '--dsw-alias-button-tool-bar-hover',
  '--dsw-alias-label-primary',
  '--dsw-alias-label-primary-foreground',
  '--dsw-alias-label-secondary',
  '--dsw-alias-label-tertiary',
  '--dsw-alias-state-error-primary',
  '--dsw-alias-state-success-primary',
  '--dsw-alias-state-warn-primary',
  '--dsw-shadow-lv1',
  '--dsw-shadow-lv2',
  '--dsw-shadow-lv3',
])

test.describe('panel.css 主题令牌化', () => {
  test('无 #rrggbb / rgb() / rgba() / hsl() 硬编码颜色', () => {
    const hits = css.match(/#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\s*\(/g) ?? []
    assert.deepEqual(hits, [], `硬编码颜色字面量必须改用 --dsw-* 令牌或 color-mix：${hits.join(', ')}`)
  })

  test('无颜色关键字（white/black/red…），含 -space 之类的属性名不误判', () => {
    const hits = css.match(/(?<![-\w])(?:white|black|red|blue|green|gray|grey|orange|yellow)(?![-\w])/g) ?? []
    assert.deepEqual(hits, [], `颜色关键字必须改用令牌：${hits.join(', ')}`)
  })

  test('引用的 --dsw-* 令牌都在宿主真实定义的集合内（防打错名字静默失效）', () => {
    const used = new Set(css.match(/--dsw-[a-z0-9-]+/g) ?? [])
    const unknown = [...used].filter((t) => !KNOWN_TOKENS.has(t))
    assert.deepEqual(unknown, [], `未知令牌（宿主未定义 → 静默失效）：${unknown.join(', ')}`)
    assert.ok(used.size >= 10, '面板应大量依赖令牌而不是自定义配色')
  })

  test('三个级别标签用不同色相令牌，彼此可区分', () => {
    const hueOf = (level) => {
      const rule = new RegExp(`\\.dsh-ct-lvl\\.${level}\\s*\\{[^}]*\\}`).exec(css)
      assert.ok(rule !== null, `.dsh-ct-lvl.${level} 规则缺失`)
      const token = /color-mix\([^)]*?(--dsw-alias-[a-z0-9-]+)/.exec(rule[0])
      assert.ok(token !== null, `.dsh-ct-lvl.${level} 的文字色应由令牌 color-mix 得出`)
      return token[1]
    }
    const hues = ['global', 'project', 'local'].map(hueOf)
    assert.equal(new Set(hues).size, 3, `三个级别必须用三个不同色相令牌，实际：${hues.join(' / ')}`)
  })

  test('级别标签文字色与 label-primary 混合：浅色主题往深走、深色主题往浅走', () => {
    for (const level of ['global', 'project', 'local']) {
      const rule = new RegExp(`\\.dsh-ct-lvl\\.${level}\\s*\\{[^}]*\\}`).exec(css)[0]
      assert.match(
        rule,
        /color-mix\(in srgb, var\(--dsw-alias-[a-z0-9-]+\) \d+%, var\(--dsw-alias-label-primary\)\)/,
        `${level} 必须与 --dsw-alias-label-primary 混合，否则浅色主题下对比度不足`,
      )
    }
  })
})
