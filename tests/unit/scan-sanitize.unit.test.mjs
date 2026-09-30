// 推送前脱敏闸门 scripts/scan-sanitize.mjs 的白盒单测。
//
// 只从「外部可观察」的角度测：喂一个装着已知敏感内容的临时文件，看扫描器是否
// 拦下并报出正确的位置与类别；喂干净内容看是否放行。不 import 脚本内部函数，
// 因此规则重构不会误伤这份测试。
//
// 两个刻意的写法：
//   1. 样本里的敏感字面量一律用 String.fromCharCode 拼装。若在本文件里逐字写
//      出家目录路径样例、私钥头等，本文件自己就会命中本仓库验收 D1 的脱敏门禁
//      （也正因为如此，连这句说明都不能举具体例子）。
//   2. 每个场景在系统临时目录建独立夹具，跑完即删；绝不往仓库里写东西。
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(HERE, '../..')
const SCANNER = path.join(REPO_ROOT, 'scripts/scan-sanitize.mjs')
const HOOK = path.join(REPO_ROOT, '.githooks/pre-push')

/** 由字符码拼字面量，避免本文件被脱敏门禁命中。 */
const t = (...codes) => String.fromCharCode(...codes)

const LIT = {
  userPath: t(47, 85, 115, 101, 114, 115, 47), // 家目录前缀
  email: t(97, 108, 105, 99, 101, 64, 101, 120, 97, 109, 112, 108, 101, 46, 99, 111, 109), // 示例邮箱
  openai: t(115, 107, 45) + t(97, 98, 99, 100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112, 113, 114, 115, 116, 117, 118), // 够长的假密钥
  pem: t(45, 45, 45, 45, 45, 66, 69, 71, 73, 78, 32, 82, 83, 65, 32, 80, 82, 73, 86, 65, 84, 69, 32, 75, 69, 89, 45, 45, 45, 45, 45), // 私钥头
}

const tempDirs = []
function fixture(lines, name = 'sample.txt') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scan-sanitize-test-'))
  tempDirs.push(dir)
  const file = path.join(dir, name)
  fs.writeFileSync(file, `${lines.join('\n')}\n`)
  return file
}

/** 跑扫描器，返回 {status, stdout, stderr}；非零退出不抛。 */
function runScanner(args) {
  try {
    const stdout = execFileSync(process.execPath, [SCANNER, ...args], { cwd: REPO_ROOT, encoding: 'utf8' })
    return { status: 0, stdout, stderr: '' }
  } catch (error) {
    return { status: error.status, stdout: error.stdout ?? '', stderr: error.stderr ?? '' }
  }
}

test.after(() => {
  for (const dir of tempDirs) {
    try {
      fs.rmSync(dir, { recursive: true, force: true })
    } catch {
      /* 临时目录清理失败不影响判分 */
    }
  }
})

test('规则自检_启动自检应通过（规则没被改坏）', () => {
  const { status, stdout } = runScanner(['--self-test'])
  assert.equal(status, 0, `自检应 exit 0，实为 ${status}；输出：${stdout}`)
  assert.match(stdout, /规则自检通过/)
})

test('干净内容_不拦下且 exit 0', () => {
  const file = fixture(['const greeting = "hello"', 'const dir = "src/components"', '// 说明：家目录用 ~/ 表示'])
  const { status, stdout } = runScanner(['--files', file])
  assert.equal(status, 0, `干净内容不应被拦，实为 ${status}`)
  assert.match(stdout, /通过/)
})

test('个人绝对路径_被拦下且报出文件名与行号', () => {
  const file = fixture(['const ok = 1', `const leaked = "${LIT.userPath}someone/project"`])
  const { status, stderr } = runScanner(['--files', file])
  assert.equal(status, 1, '含个人绝对路径应被拦下（exit 1）')
  assert.match(stderr, /个人绝对路径/)
  assert.match(stderr, /sample\.txt:2/, `应报出 文件:行号，实际输出：${stderr}`)
})

test('邮箱_被拦下', () => {
  const file = fixture([`contact: ${LIT.email}`])
  const { status, stderr } = runScanner(['--files', file])
  assert.equal(status, 1, '含邮箱应被拦下')
  assert.match(stderr, /邮箱地址/)
})

test('OpenAI 风格密钥_被拦下', () => {
  const file = fixture([`const key = "${LIT.openai}"`])
  const { status, stderr } = runScanner(['--files', file])
  assert.equal(status, 1, '含 OpenAI 风格密钥应被拦下')
  assert.match(stderr, /OpenAI/)
})

test('PEM 私钥块_被拦下', () => {
  const file = fixture([LIT.pem])
  const { status, stderr } = runScanner(['--files', file])
  assert.equal(status, 1, '含私钥块应被拦下')
  assert.match(stderr, /私钥/)
})

test('短前缀不算密钥_不该误报（边界）', () => {
  // 只有前缀、长度不够的串是普通文本，必须放行，否则闸门会被误报淹没。
  const file = fixture([`const shortOpenAi = "${t(115, 107, 45)}abc"`, `const shortPat = "${t(103, 104, 112, 95)}x"`])
  const { status, stdout } = runScanner(['--files', file])
  assert.equal(status, 0, `短前缀不应被拦，实为 ${status}；输出：${stdout}`)
})

test('拦截信息_不回显完整密钥（只给截断片段）', () => {
  const long = LIT.openai
  const file = fixture([`const key = "${long}"`])
  const { status, stderr } = runScanner(['--files', file])
  assert.equal(status, 1)
  // 命中行整体仍会出现（要让人知道改哪儿），但必须是截断后的片段。
  const snippetLine = stderr.split('\n').find((l) => l.includes(t(115, 107, 45)))
  assert.ok(snippetLine, '应报出命中行片段')
  assert.ok(snippetLine.trim().length <= 160, `片段应截断到 <=160 字符，实为 ${snippetLine.trim().length}`)
})

test('pre-push hook_语法合法且可执行', () => {
  assert.ok(fs.existsSync(HOOK), '缺少 .githooks/pre-push')
  const mode = fs.statSync(HOOK).mode
  assert.ok((mode & 0o111) !== 0, 'pre-push 必须可执行')
  // sh -n 只做语法检查，不执行 hook。
  execFileSync('sh', ['-n', HOOK], { stdio: 'pipe' })
})

test('pre-push hook_管道输入下按范围扫描并放行干净范围', () => {
  // 用本仓库里一段已知干净的提交范围驱动 hook，走完整的 stdin → 范围 → 扫描链路。
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8' }).trim()
  const parent = execFileSync('git', ['rev-parse', 'HEAD~1'], { cwd: REPO_ROOT, encoding: 'utf8' }).trim()
  const input = `refs/heads/test-branch ${head} refs/heads/test-branch ${parent}\n`
  const stdout = execFileSync('sh', [HOOK], { cwd: REPO_ROOT, input, encoding: 'utf8' })
  assert.match(stdout, /\[pre-push\] 脱敏扫描/)
  assert.match(stdout, /通过/)
})

test('扫描器与 hook 自身_不含可被脱敏门禁命中的模式字面量', () => {
  // 这两个文件必须自己做到脱敏：任何写进它们文本里的完整模式都会让本仓库的
  // D1 门禁在扫到它们时命中。此处按 D1 的同一组规则复检。
  const patterns = [
    ['个人绝对路径', new RegExp(`${t(47, 85, 115, 101, 114, 115, 47)}[A-Za-z0-9_.-]+`)],
    ['邮箱地址', new RegExp(`${t(91, 65, 45, 90, 97, 45, 122, 48, 45, 57, 46, 95, 37, 43, 45, 93, 43, 64)}[A-Za-z0-9.-]+${t(92, 46)}[A-Za-z]{2,}`)],
    ['OpenAI 风格密钥', new RegExp(`${t(92, 98)}${t(115, 107, 45)}[A-Za-z0-9]{20,}`)],
    ['PEM 私钥块', new RegExp(`${t(45, 45, 45, 45, 45, 66, 69, 71, 73, 78)}[A-Z ]*${t(80, 82, 73, 86, 65, 84, 69, 32, 75, 69, 89)}`)],
  ]
  for (const file of [SCANNER, HOOK]) {
    const text = fs.readFileSync(file, 'utf8')
    for (const [name, re] of patterns) {
      assert.equal(re.test(text), false, `${path.relative(REPO_ROOT, file)} 自身命中「${name}」`)
    }
  }
})
