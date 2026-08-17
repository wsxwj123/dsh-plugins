/**
 * L5 + L6 — 非运行时问题，用静态断言复现（修复直接消除，无需人工核验）。
 *
 * L5: tsdown.config.mjs 的 makeCssPlugin 在 ESM 模块里用 `require.resolve`
 *     （裸 CSS 规格分支）——ESM 没有 require，一旦有人 `import 'some-pkg/x.css'`
 *     构建就炸。休眠 bug，只是当前没走到那条分支。
 * L6: .gitignore 忽略 lib/，而 tests/unit/*.test.js 全部 import lib/*.js；
 *     LEARNINGS.md 又写着“lib/ 被 git 跟踪，改完必须一起 commit”。三方矛盾。
 */
import { test } from 'node:test'
import assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
import { PKG_ROOT, readPkgFile } from './_harness.mjs'

test('L5: tsdown 配置在 ESM 里不得使用未定义的 require.resolve', () => {
  const src = readPkgFile('tsdown.config.mjs')
  const usesRequire = /(^|[^.\w])require\.resolve\s*\(/m.test(src)
  const definesRequire = /createRequire\s*\(/.test(src)
  assert.ok(
    !usesRequire || definesRequire,
    'ESM 模块里 require 不存在：用 createRequire(import.meta.url) 或 import.meta.resolve 重写裸 CSS 分支',
  )
})

test('L5-相邻: CSS 插件仍然处理相对/绝对路径与 CSS Module 两条分支', () => {
  const src = readPkgFile('tsdown.config.mjs')
  assert.ok(/\.module\.css/.test(src), 'CSS Module 分支必须保留')
  assert.ok(/cssModules/.test(src), 'lightningcss 的 cssModules 转换必须保留')
  assert.ok(/data-plugin/.test(src), '<style data-plugin> 注入必须保留')
})

test('L6: .gitignore 忽略 lib/ 与单测直接 import lib/*.js 不能同时成立', () => {
  const ignoreLines = readPkgFile('.gitignore')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#'))
  const ignoresLib = ignoreLines.some((l) => ['lib', 'lib/', '/lib', '/lib/'].includes(l))

  const unitDir = path.join(PKG_ROOT, 'tests', 'unit')
  const importers = fs
    .readdirSync(unitDir)
    .filter((f) => f.endsWith('.test.js'))
    .filter((f) => /['"]lib['"]|lib\/[a-z-]+\.js/.test(fs.readFileSync(path.join(unitDir, f), 'utf8')))

  const pkg = readPkgFile('package.json')
  // 第三条出路：测试脚本自己先构建（pretest / test:unit 里带 build）。
  const testScriptBuilds = /"(pretest|pretest:unit|test:unit)"\s*:\s*"[^"]*build/.test(pkg)

  assert.ok(
    !ignoresLib || importers.length === 0 || testScriptBuilds,
    `lib/ 被 gitignore，但 ${importers.length} 个单测直接 import lib/*.js，且 test 脚本不带构建：` +
      '三者必须对齐（跟踪 lib/ ∥ 测试改指 src ∥ 测试脚本先 build）',
  )
})

test('L6: LEARNINGS.md 关于 lib/ 的说明必须与 .gitignore 一致', () => {
  const learnings = readPkgFile('LEARNINGS.md')
  const claimsTracked = /`?lib\/`?\s*被\s*git\s*跟踪/.test(learnings)
  const ignoreLines = readPkgFile('.gitignore')
    .split('\n')
    .map((l) => l.trim())
  const ignoresLib = ignoreLines.some((l) => ['lib', 'lib/', '/lib', '/lib/'].includes(l))
  assert.ok(
    !(claimsTracked && ignoresLib),
    'LEARNINGS 写着“lib/ 被 git 跟踪、commit 时必须 git add lib/”，.gitignore 却忽略 lib/——改一处必须同步另一处',
  )
})
