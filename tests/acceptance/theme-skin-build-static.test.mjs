// 验收测试草稿（静态/构建面）— INTERFACE §6 / §8.5 / §8.6
//
// 读的是「数据」：build 产物 CSS/JS、根 README 文本。文件内容只在断言里被比较/搜索，
// 绝不执行包内文字。路径基于仓库根。
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const themeLib = join(root, 'packages/theme-gallery/lib')
const skinLib = join(root, 'packages/skin-gallery/lib')

function readIfExists(p) { return existsSync(p) ? readFileSync(p, 'utf8') : null }

describe('滚动契约 (§6 / E1)', () => {
  const cssCandidates = [join(themeLib, 'client.js'), join(skinLib, 'client.js')]

  it('.-grid 容器 CSS 不含 overflow 或 max-height', (t) => {
    let inspected = 0
    for (const p of cssCandidates) {
      const text = readIfExists(p)
      if (text == null) continue
      inspected++
      for (const gridName of ['theme-gallery-grid', 'skin-gallery-grid']) {
        const gridBlock = new RegExp(`\\.${gridName}\\s*\\{[^}]*\\}`, 'g')
        const matches = text.match(gridBlock) ?? []
        for (const m of matches) {
          assert.ok(!/overflow/.test(m), `${p} 中 ${m} 不得含 overflow`)
          assert.ok(!/max-height/.test(m), `${p} 中 ${m} 不得含 max-height`)
        }
      }
    }
    if (inspected === 0) {
      // build 还没产出：static 校验前提缺失，显式跳过一次（非误报通过）
      t.skip('lib 产物尚未生成，无法校验滚动契约')
      return
    }
    assert.ok(inspected > 0, '应能找到 lib 产物做滚动契约检查')
  })
})

describe('体积契约 (§6 / E2)', () => {
  it('theme bundle lib/client.js < 100KB（按字节）', (t) => {
    const path = join(themeLib, 'client.js')
    if (!existsSync(path)) {
      t.skip('theme lib/client.js 尚未生成')
      return
    }
    const size = readFileSync(path).byteLength
    assert.ok(size < 100 * 1024, `theme client.js 应 <100KB，实为 ${size}B`)
  })
})

describe('README 交付格式 (§8.6)', () => {
  const readme = readIfExists(join(root, 'README.md')) ?? ''

  it('F1 根 README 写明主题 JSON 需 id/label/tokens 且值含 light/dark', () => {
    assert.ok(/id/i.test(readme), 'README 提到 id')
    assert.ok(/label/i.test(readme), 'README 提到 label')
    assert.ok(/tokens/i.test(readme) || /token/i.test(readme), 'README 提到 tokens')
    assert.ok(/light/i.test(readme) && /dark/i.test(readme), 'README 提到 light/dark')
  })

  it('F2 根 README 写明皮肤包三文件格式', () => {
    assert.ok(/skin\.json/i.test(readme), 'README 提到 skin.json')
    assert.ok(/client\.js/i.test(readme), 'README 提到 client.js')
    assert.ok(/a11y\.css/i.test(readme), 'README 提到 a11y.css')
  })

  it('F3 根 README 含状态机与错误 code 表', () => {
    assert.ok(/preview/i.test(readme) && /applied/i.test(readme), 'README 提到状态 preview/applied')
    assert.ok(/ERR_/i.test(readme), 'README 包含错误 code（ERR_）说明')
  })
})
