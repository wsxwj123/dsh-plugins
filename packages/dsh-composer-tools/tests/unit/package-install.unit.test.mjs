/**
 * 打包/安装静态门禁：pnpm 安装 Git 依赖时只自动执行 prepare。
 * lib/ 不入库时如果只有 build，没有 prepare，dsh-market 会判定
 * "nothing installable"（dsh-session-manager issue #3 同类问题）。
 */
import { test } from 'node:test'
import assert from 'node:assert'
import { readFileSync } from 'node:fs'

const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))
const ignoreLines = readFileSync(new URL('../../.gitignore', import.meta.url), 'utf8')
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => line.length > 0 && !line.startsWith('#'))

test('lib/ 不入库时必须声明 prepare 构建脚本', () => {
  const ignoresLib = ignoreLines.some((line) => ['lib', 'lib/', '/lib', '/lib/'].includes(line))
  assert.ok(ignoresLib, '测试前提变化：.gitignore 已不再忽略 lib/，请同步这个门禁')
  assert.equal(
    pkg.scripts?.prepare,
    pkg.scripts?.build,
    'pnpm 安装 Git 依赖只会跑 prepare；没有与 build 一致的 prepare，dsh-market 无法构建 lib/',
  )
  assert.match(pkg.scripts.prepare, /\bbuild\.mjs\b/, 'prepare 必须调用本包的构建脚本')
})

test('npm 包 files 必须包含 lib/', () => {
  assert.ok(Array.isArray(pkg.files), 'package.json 必须有 files 白名单')
  assert.ok(pkg.files.includes('lib'), 'files 白名单必须包含 lib/')
})
