/**
 * shell.test.mjs — 产物壳的独立门禁（硬约束 1）。
 *
 * 刻意**直接读磁盘上的 lib/client.js**，不先跑 build：上一次线上事故的盲区正是
 * 「没有任何测试覆盖壳」，而 `pnpm -r build` 又会静默重写产物。这条测试要能在
 * 「产物已被别的脚本弄坏」时立刻红，所以不许在测试里重新生成。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, statSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const LIB = path.join(PKG, 'lib')
const client = readFileSync(path.join(LIB, 'client.js'), 'utf8')
const lines = client.split('\n')

const SHELL = [
  'window.__ModuleLoader__.load({ id: "dsh-appearance-gallery", factory: (require) => {',
  'var module = { exports: {} }; var exports = module.exports;',
  "const React = require('react');",
]

test('壳前三行逐字符匹配', () => {
  SHELL.forEach((expected, i) => assert.equal(lines[i], expected, `第 ${i + 1} 行`))
})

test('壳尾串存在', () => {
  assert.ok(client.includes('return module.exports; } });'))
})

test('导出 apply 与 inject', () => {
  assert.ok(client.includes('exports.apply = apply'))
  assert.ok(client.includes("exports.inject = ['slots']"))
})

test('槽位只注册一处且不带 priority', () => {
  assert.equal((client.match(/slots\.register\s*\(/g) || []).length, 1)
  assert.equal(client.includes('priority'), false)
})

test('皮肤三张表与 9 个 id 都已内联', () => {
  for (const table of ['__SKIN_MANIFEST__', '__SKIN_BUNDLES__', '__SKIN_A11Y__']) {
    assert.ok(client.includes(table), `缺 ${table}`)
  }
  for (const id of ['qq98', 'ths', 'xp', 'blue-fantasy', 'dragon-heir', 'minecraft', 'whale-song', 'trading', 'miku']) {
    assert.ok(client.includes(`"${id}"`), `缺皮肤 ${id}`)
  }
})

test('lib 下只有 client.js 与 index.js', () => {
  assert.deepEqual(readdirSync(LIB).sort(), ['client.js', 'index.js'])
})

test('产物体积不超过兜底上限 900KB', () => {
  const size = statSync(path.join(LIB, 'client.js')).size
  assert.ok(size <= 921600, `${size} B > 921600 B`)
})
