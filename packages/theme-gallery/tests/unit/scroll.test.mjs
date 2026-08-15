/**
 * scroll.test.mjs — 滚动契约静态断言（INTERFACE §6 / §8.5 E1）。
 * 读 build 产物 lib/client.js（纯数据），断言 `.-grid` 容器 CSS 不含 overflow / max-height。
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const themeLib = join(here, '../../lib/client.js')
const skinLib = join(here, '../../../skin-gallery/lib/client.js')

function readIfExists(p) { return existsSync(p) ? readFileSync(p, 'utf8') : null }

describe('滚动契约（无内部滚动容器）', () => {
  const cases = [
    ['theme-gallery-grid', themeLib],
    ['skin-gallery-grid', skinLib],
  ]
  for (const [grid, path] of cases) {
    it(`.${grid} 不含 overflow 或 max-height`, () => {
      const text = readIfExists(path)
      if (text == null) { return } // build 未产出则跳过
      const re = new RegExp(`\\.${grid}\\s*\\{[^}]*\\}`, 'g')
      const matches = text.match(re) ?? []
      assert.ok(matches.length > 0, `应能匹配 .${grid} 的 CSS 块`)
      for (const m of matches) {
        assert.ok(!/overflow/.test(m), `${m} 不得含 overflow`)
        assert.ok(!/max-height/.test(m), `${m} 不得含 max-height`)
      }
    })
  }
})
