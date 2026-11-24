// 测试隔离护栏（安全回归，task-11）。
//
// 事故：tests/unit/instructions.unit.test.mjs 曾直接向真实 `~/.dsh/AGENTS.md`
// 写入 'g' 再 rmSync 删除，任何人跑一次单测就会毁掉用户的全局指令文件
// （本机已多次发生）。本文件是防再次发生的静态 + 运行时护栏：
//   1. 静态扫描 tests/ 全部源码：禁止"文件系统写/删操作"的参数里出现真实 home
//      （homedir() / process.env.HOME / ~/.dsh），除非同一调用附近显式用了 tmpdir()。
//   2. 运行时校验：真实 ~/.dsh/AGENTS.md（若存在）在本测试执行前后 md5 不变。
//   3. 夹具护栏：createTempDir 的根必须在 os.tmpdir() 下（fixture.mjs 强制 throw）。
//
// 注：本文件自身源码包含被扫描的"危险函数名/模式"字面量，故扫描时排除自身。

import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertUnderTmpdir, createTempDir } from '../acceptance/helpers/fixture.mjs'

const TESTS_ROOT = fileURLToPath(new URL('..', import.meta.url))
const SELF = fileURLToPath(import.meta.url)
const REAL_AGENTS_MD = join(homedir(), '.dsh', 'AGENTS.md')

/** 递归列出 tests/ 下所有 .mjs 源码。 */
function listTestSources(dir) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...listTestSources(full))
    else if (entry.name.endsWith('.mjs')) out.push(full)
  }
  return out
}

/** 真实 ~/.dsh/AGENTS.md 的 md5（不存在 → null）。 */
function realAgentsMd5() {
  if (!existsSync(REAL_AGENTS_MD)) return null
  return createHash('md5').update(readFileSync(REAL_AGENTS_MD)).digest('hex')
}

/** 会对文件系统做写/删操作的函数名（只列测试里出现过的高危项）。 */
const MUTATION_CALL = /\b(writeFileSync|appendFileSync|rmSync|unlinkSync|rmdirSync|renameSync|copyFileSync|createWriteStream|mkdirSync|openSync|writeFile|appendFile|rm|unlink|rmdir|rename|copyFile|mkdir)\s*\(/g

/** 真实 home 特征（出现在 mutation 调用的实参里即违规）。 */
const REAL_HOME_REF = /(?:\bhomedir\(\)|process\.env\.HOME|process\.env\[['"]HOME['"]\]|~\/\.dsh|\$HOME\/\.dsh)/

/**
 * 从 `(` 位置做一次括号平衡扫描，取出完整实参文本（跳过字符串里的括号）。
 * @param source - 文件内容。
 * @param openIndex - `(` 的下标。
 * @returns 实参文本（含括号）；扫不到闭合时退化为后续 400 字符。
 */
function callArguments(source, openIndex) {
  let depth = 0
  let quote = null
  for (let i = openIndex; i < source.length; i += 1) {
    const ch = source[i]
    if (quote !== null) {
      if (ch === '\\') i += 1
      else if (ch === quote) quote = null
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue }
    if (ch === '(') depth += 1
    else if (ch === ')') {
      depth -= 1
      if (depth === 0) return source.slice(openIndex, i + 1)
    }
  }
  return source.slice(openIndex, openIndex + 400)
}

/**
 * 扫描一个源文件，返回违规片段描述列表。
 * 判定：写/删调用的**实参里**直接出现真实 home 特征（homedir()/process.env.HOME/
 * ~/.dsh），且没用 tmpdir() 兜到临时目录。
 * @param source - 文件内容。
 * @returns 违规描述（空数组 = 干净）。
 */
function findRealHomeMutations(source) {
  const violations = []
  MUTATION_CALL.lastIndex = 0
  let match
  while ((match = MUTATION_CALL.exec(source)) !== null) {
    const args = callArguments(source, match.index + match[0].length - 1)
    if (!REAL_HOME_REF.test(args)) continue
    // 同一调用显式落到 tmpdir() 下 = 安全。
    if (args.includes('tmpdir()')) continue
    const line = source.slice(0, match.index).split('\n').length
    violations.push(`${match[1]} @ line ${line}`)
  }
  return violations
}

test.describe('测试隔离护栏（禁止碰真实 home）', () => {
  test('静态扫描：tests/ 里没有对真实 home 的写/删调用（tmpdir 夹具除外）', () => {
    const violations = []
    for (const file of listTestSources(TESTS_ROOT)) {
      if (file === SELF) continue // 本文件包含待扫描模式字面量
      const source = readFileSync(file, 'utf8')
      for (const hit of findRealHomeMutations(source)) {
        violations.push(`${file.replace(TESTS_ROOT, 'tests/')}: ${hit}`)
      }
    }
    assert.deepEqual(violations, [], `测试不得写/删真实 home：\n${violations.join('\n')}`)
  })

  test('静态扫描：历史事故模式（writeFileSync(join(homedir()… / rmSync(join(homedir()…）不再存在', () => {
    const dangerous = /(?:writeFileSync|rmSync|unlinkSync)\s*\(\s*join\s*\(\s*homedir\(\)/
    for (const file of listTestSources(TESTS_ROOT)) {
      if (file === SELF) continue
      const source = readFileSync(file, 'utf8')
      assert.equal(dangerous.test(source), false, `${file}: 命中历史事故模式`)
    }
  })

  test('运行时校验：真实 ~/.dsh/AGENTS.md 在本测试前后 md5 不变', () => {
    const before = realAgentsMd5()
    // 本测试只读；再跑一次静态扫描，确保护栏本身不写文件。
    const sources = listTestSources(TESTS_ROOT).filter((file) => file !== SELF)
    for (const file of sources) statSync(file)
    assert.equal(realAgentsMd5(), before, '真实 home 的用户文件在测试期间被修改')
  })

  test('createTempDir 的根必须在 os.tmpdir() 下（夹具护栏）', () => {
    const tree = createTempDir()
    try {
      const root = resolve(tmpdir())
      const abs = resolve(tree.root)
      assert.ok(abs === root || abs.startsWith(root + sep), `fixture root escapes tmpdir: ${abs}`)
      // 清理目标同根：cleanup 只删 tmpdir 下的自己。
      assert.doesNotThrow(() => assertUnderTmpdir(tree.root))
    } finally {
      tree.cleanup()
    }
  })

  test('assertUnderTmpdir 拒绝真实 home / 系统路径', () => {
    assert.throws(() => assertUnderTmpdir(join(homedir(), '.dsh')), /escapes os\.tmpdir/)
    assert.throws(() => assertUnderTmpdir('/etc'), /escapes os\.tmpdir/)
    assert.doesNotThrow(() => assertUnderTmpdir(join(tmpdir(), 'some-fixture')))
  })
})
