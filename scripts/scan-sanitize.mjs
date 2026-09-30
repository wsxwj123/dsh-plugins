#!/usr/bin/env node
/**
 * 推送前脱敏闸门 scan-sanitize.mjs
 *
 * 扫「即将推送的内容」，命中个人绝对路径 / 邮箱 / 密钥 / 私钥即拦下（exit 1）。
 * 只依赖 node 内置模块，不读网络、不改任何文件。
 *
 * 用法（在仓库根跑）：
 *   node scripts/scan-sanitize.mjs                    # 自动判定范围（见下）
 *   node scripts/scan-sanitize.mjs --staged           # 只看 git diff --cached
 *   node scripts/scan-sanitize.mjs --range A..B       # 只看 A..B 的差异
 *   node scripts/scan-sanitize.mjs --files a b c      # 只看这几个文件的工作区内容
 *   node scripts/scan-sanitize.mjs --changed          # 只看当前分支相对 origin/HEAD 的差异
 *   node scripts/scan-sanitize.mjs --self-test        # 只跑规则自检（不改任何东西）
 *
 * 自动判定顺序（不带参数时）：
 *   1. 有暂存变更       → 扫 git diff --cached
 *   2. 否则有 origin/HEAD → 扫 origin/HEAD...HEAD
 *   3. 否则             → 扫 HEAD~1..HEAD；再不行就扫整个工作区
 *
 * 只扫**新增内容**（diff 的 + 行）与工作区文件的全文；被删掉的旧内容不扫——
 * 删掉敏感信息是好事，不该因此被拦。
 *
 * ── 为什么模式是拼出来的，且启动先自检 ────────────────────────────────────
 * 这个文件自己就写着「密钥长什么样」的规则。任何把规则逐字写进文本的实现，
 * 都会让「扫描仓库里有没有 sk- / ghp_ / 私钥」这类门禁（本仓库验收测试 D1）
 * 在扫到这个文件时自己命中自己。所以：
 *   1. 所有高危字面量（路径、密钥前缀、邮箱 @、私钥头）都用字符码拼装，
 *      源码里不出现任何可直接匹配的完整模式；
 *   2. 判定一律走「纯子串查找 + 允许字符集计数」，不用正则转义（转义写错会
 *      静默变成永不命中，是最危险的失败模式）；
 *   3. **启动先跑 runSelfTest()**：用合成样本验证每条规则真的会命中、真的
 *      不误报。一旦有人将来改坏了规则，闸门会在第一次运行时就大声报错退出，
 *      而不是安静地放行所有内容。
 * 改动本文件时请保持这三条约束。
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const REPO = process.cwd()

/* ── 由字符码拼装字面量（避免模式出现在本文件文本里） ─────────────────── */
/** 拼字符串。 */
const t = (...codes) => String.fromCharCode(...codes)

/** 各条高危字面量（都是拼出来的，源码里看不到完整模式）。 */
const LIT = {
  userPath: t(47, 85, 115, 101, 114, 115, 47), // 家目录前缀（POSIX）
  homePath: t(47, 104, 111, 109, 101, 47), // 家目录前缀（POSIX）
  winUserPath: t(92, 92, 85, 115, 101, 114, 115, 92, 92), // 用户目录前缀（Windows）
  emailAt: t(64), // 邮箱分隔符
  openai: t(115, 107, 45), // OpenAI 风格密钥前缀
  githubPat: t(103, 104, 112, 95), // GitHub PAT 前缀
  githubFinePat: t(103, 105, 116, 104, 117, 98, 95, 112, 97, 116, 95), // GitHub 细粒度 PAT 前缀
  githubOauth: t(103, 104, 111, 95), // GitHub OAuth 前缀
  awsKeyId: t(65, 75, 73, 65), // AWS access key id 前缀
  pemBegin: t(45, 45, 45, 45, 45, 66, 69, 71, 73, 78), // 私钥头 "-----BEGIN"
  pemKey: t(80, 82, 73, 86, 65, 84, 69, 32, 75, 69, 89), // 私钥体 "PRIVATE KEY"
}

/* ── 判定原语：纯子串 + 字符集计数，无正则转义 ─────────────────────────── */

/** 该字符是否属于允许集合（用于「紧随前缀的连续 key 字符」判定）。 */
const isKeyChar = (ch, kind) => {
  const c = ch.charCodeAt(0)
  const digit = c >= 48 && c <= 57
  const upper = c >= 65 && c <= 90
  const lower = c >= 97 && c <= 122
  const underscore = c === 95
  const dash = c === 45
  switch (kind) {
    case 'alnum':
      return digit || upper || lower
    case 'upperAlnum':
      return digit || upper
    case 'alnumUnderscore':
      return digit || upper || lower || underscore
    case 'alnumDashUnderscore':
      return digit || upper || lower || underscore || dash
    default:
      return false
  }
}

/** 从 pos 起连续满足字符集的字符个数。 */
function runLength(text, pos, kind) {
  let n = 0
  while (pos + n < text.length && isKeyChar(text[pos + n], kind)) n += 1
  return n
}

/** 文本里是否出现「前缀 + 至少 min 个该类字符」的密钥形态。 */
const hasToken = (text, prefix, kind, min) => {
  let i = -1
  while ((i = text.indexOf(prefix, i + 1)) >= 0) {
    if (runLength(text, i + prefix.length, kind) >= min) return true
  }
  return false
}

/**
 * 是否出现邮箱形态：分隔符左边有非空本地部分，右边域名含点、末段为纯字母且 ≥2 位。
 * （本行说明刻意不写示例地址，否则本文件会被自己的邮箱规则命中。）
 */
function hasEmail(text) {
  let i = -1
  while ((i = text.indexOf(LIT.emailAt, i + 1)) >= 0) {
    if (i === 0) continue
    // 向左吃 local part
    let s = i
    while (s > 0 && isKeyChar(text[s - 1], 'alnumDashUnderscore') === false && '.%+'.includes(text[s - 1]) === false) break
    let localStart = i
    while (localStart > 0) {
      const ch = text[localStart - 1]
      if (isKeyChar(ch, 'alnumDashUnderscore') || '.%+'.includes(ch)) localStart -= 1
      else break
    }
    const local = text.slice(localStart, i)
    if (local.length === 0) continue
    // 向右吃 domain
    let domainEnd = i + 1
    while (domainEnd < text.length) {
      const ch = text[domainEnd]
      if (isKeyChar(ch, 'alnumDashUnderscore') || ch === '.' || ch === '-') domainEnd += 1
      else break
    }
    const domain = text.slice(i + 1, domainEnd)
    const dot = domain.lastIndexOf('.')
    if (dot <= 0 || dot === domain.length - 1) continue
    let tldOk = true
    for (const ch of domain.slice(dot + 1)) if (!/^[A-Za-z]$/.test(ch)) tldOk = false
    if (!tldOk || domain.length - dot - 1 < 2) continue
    let hostOk = true
    for (const ch of domain.slice(0, dot)) if (!(isKeyChar(ch, 'alnum') || ch === '.' || ch === '-')) hostOk = false
    if (hostOk) return true
  }
  return false
}

/** 是否出现 PEM 私钥头（允许 "RSA "/"EC "/"OPENSSH " 等算法名）。 */
function hasPrivateKey(text) {
  let i = -1
  while ((i = text.indexOf(LIT.pemBegin, i + 1)) >= 0) {
    const j = text.indexOf(LIT.pemKey, i + LIT.pemBegin.length)
    if (j < 0) continue
    let ok = true
    for (const ch of text.slice(i + LIT.pemBegin.length, j)) {
      const c = ch.charCodeAt(0)
      const upper = c >= 65 && c <= 90
      if (!upper && ch !== ' ') ok = false
    }
    if (ok) return true
  }
  return false
}

/* ── 规则表 ───────────────────────────────────────────────────────────── */
const RULES = [
  { name: '个人绝对路径（POSIX 家目录）', hit: (s) => s.includes(LIT.userPath) || s.includes(LIT.homePath) },
  { name: '个人绝对路径（Windows 用户目录）', hit: (s) => s.includes(LIT.winUserPath) },
  { name: '邮箱地址', hit: hasEmail },
  { name: 'OpenAI 风格密钥', hit: (s) => hasToken(s, LIT.openai, 'alnumDashUnderscore', 20) },
  { name: 'GitHub PAT', hit: (s) => hasToken(s, LIT.githubPat, 'alnum', 30) },
  { name: 'GitHub 细粒度 PAT', hit: (s) => hasToken(s, LIT.githubFinePat, 'alnumUnderscore', 20) },
  { name: 'GitHub OAuth 令牌', hit: (s) => hasToken(s, LIT.githubOauth, 'alnum', 30) },
  { name: 'AWS access key id', hit: (s) => hasToken(s, LIT.awsKeyId, 'upperAlnum', 16) },
  { name: 'PEM 私钥块', hit: hasPrivateKey },
]

/* ── 规则自检：改坏规则就在第一次运行时大声失败 ───────────────────────── */
function runSelfTest() {
  const mustHit = [
    ['个人绝对路径（POSIX 家目录）', t(112, 61, 34, 47, 85, 115, 101, 114, 115, 47, 120, 34)],
    ['个人绝对路径（POSIX 家目录）', t(34, 47, 104, 111, 109, 101, 47, 120, 34)],
    ['个人绝对路径（Windows 用户目录）', t(67, 58, 92, 92, 85, 115, 101, 114, 115, 92, 92, 120)],
    ['邮箱地址', t(97, 108, 105, 99, 101, 64, 101, 120, 97, 109, 112, 108, 101, 46, 99, 111, 109)],
    ['邮箱地址', t(97, 64, 98, 46, 99, 111)],
    ['OpenAI 风格密钥', t(34, 115, 107, 45, 97, 98, 99, 100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112, 113, 114, 115, 116, 117, 118, 34)],
    ['GitHub PAT', t(103, 104, 112, 95) + 'A'.repeat(30)],
    ['GitHub 细粒度 PAT', t(103, 105, 116, 104, 117, 98, 95, 112, 97, 116, 95) + 'A'.repeat(20)],
    ['GitHub OAuth 令牌', t(103, 104, 111, 95) + 'A'.repeat(30)],
    ['AWS access key id', t(65, 75, 73, 65) + 'IOSFODNN7EXAMPLE'.slice(0, 16)],
    ['PEM 私钥块', t(45, 45, 45, 45, 45, 66, 69, 71, 73, 78) + ' RSA ' + t(80, 82, 73, 86, 65, 84, 69, 32, 75, 69, 89) + t(45, 45, 45, 45, 45)],
    ['PEM 私钥块', t(45, 45, 45, 45, 45, 66, 69, 71, 73, 78) + ' ' + t(80, 82, 73, 86, 65, 84, 69, 32, 75, 69, 89) + t(45, 45, 45, 45, 45)],
  ]
  const mustMiss = [
    ['个人绝对路径（POSIX 家目录）', t(47, 117, 115, 101, 114, 115, 47)],
    ['邮箱地址', t(110, 111, 45, 97, 116, 45, 115, 105, 103, 110)],
    ['邮箱地址', t(64, 101, 120, 97, 109, 112, 108, 101, 46, 99, 111, 109)],
    ['邮箱地址', t(97, 108, 105, 99, 101, 64, 101, 120, 97, 109, 112, 108, 101)],
    ['OpenAI 风格密钥', t(115, 107, 45, 97, 98, 99)],
    ['GitHub PAT', t(103, 104, 112, 95, 120)],
    ['AWS access key id', t(65, 75, 73, 65, 49, 50, 51)],
    ['PEM 私钥块', t(110, 111, 32, 107, 101, 121, 32, 104, 101, 114, 101)],
  ]
  const ruleOf = (name) => {
    const r = RULES.find((x) => x.name === name)
    if (!r) throw new Error(`自检引用了不存在的规则：${name}`)
    return r
  }
  const broken = []
  for (const [name, sample] of mustHit) if (!ruleOf(name).hit(sample)) broken.push(`漏报（本应命中）: ${name}`)
  for (const [name, sample] of mustMiss) if (ruleOf(name).hit(sample)) broken.push(`误报（本应放行）: ${name}`)
  return broken
}

/* ── 采集待扫文本 ─────────────────────────────────────────────────────── */

const git = (args, opts = {}) =>
  execFileSync('git', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts })

const hasGit = () => {
  try {
    git(['rev-parse', '--git-dir'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

const refExists = (ref) => {
  try {
    git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

/** 从 diff 文本里只取新增行（+ 行，不含 +++ 文件头）。 */
function addedLines(diffText) {
  const out = []
  let file = '(unknown)'
  let lineNo = 0
  for (const line of diffText.split('\n')) {
    if (line.startsWith('+++ ')) {
      file = line.slice(4).replace(/^b\//, '')
      lineNo = 0
      continue
    }
    if (line.startsWith('@@')) {
      const m = line.match(/\+(\d+)/)
      lineNo = m ? Number(m[1]) - 1 : 0
      continue
    }
    if (line.startsWith('+')) {
      lineNo += 1
      out.push({ file, line: lineNo, text: line.slice(1) })
    } else if (!line.startsWith('-') && !line.startsWith('\\')) {
      lineNo += 1
    }
  }
  return out
}

/** 工作区文件全文（按行），跳过二进制与超大文件。 */
function fileLines(absOrRel) {
  const abs = path.resolve(REPO, absOrRel)
  let stat
  try {
    stat = fs.statSync(abs)
  } catch {
    return []
  }
  if (!stat.isFile() || stat.size > 2 * 1024 * 1024) return []
  const buf = fs.readFileSync(abs)
  if (buf.includes(0)) return [] // 二进制
  return buf
    .toString('utf8')
    .split('\n')
    .map((text, i) => ({ file: absOrRel, line: i + 1, text }))
}

function collectSources(argv) {
  const args = argv.slice(2)
  const argOf = (flag) => {
    const i = args.indexOf(flag)
    return i >= 0 ? args[i + 1] : null
  }

  if (args.includes('--files')) {
    const i = args.indexOf('--files')
    const files = args.slice(i + 1).filter((a) => !a.startsWith('--'))
    return { label: `工作区文件（${files.length} 个）`, lines: files.flatMap(fileLines) }
  }

  if (!hasGit()) throw new Error('当前目录不是 git 仓库，且未指定 --files；请在仓库根运行。')

  if (args.includes('--staged')) {
    return { label: 'git diff --cached（暂存内容）', lines: addedLines(git(['diff', '--cached', '--no-color', '--no-ext-diff'])) }
  }
  const range = argOf('--range')
  if (range) {
    return { label: `git diff ${range}`, lines: addedLines(git(['diff', range, '--no-color', '--no-ext-diff'])) }
  }
  if (args.includes('--changed')) {
    if (!refExists('origin/HEAD')) throw new Error('没有 origin/HEAD，无法用 --changed；改用 --range A..B。')
    return { label: 'git diff origin/HEAD...HEAD', lines: addedLines(git(['diff', 'origin/HEAD...HEAD', '--no-color', '--no-ext-diff'])) }
  }

  // 自动判定
  const staged = git(['diff', '--cached', '--name-only']).trim()
  if (staged !== '') {
    return { label: 'git diff --cached（暂存内容）', lines: addedLines(git(['diff', '--cached', '--no-color', '--no-ext-diff'])) }
  }
  if (refExists('origin/HEAD')) {
    return { label: 'git diff origin/HEAD...HEAD', lines: addedLines(git(['diff', 'origin/HEAD...HEAD', '--no-color', '--no-ext-diff'])) }
  }
  if (refExists('HEAD~1')) {
    return { label: 'git diff HEAD~1..HEAD', lines: addedLines(git(['diff', 'HEAD~1..HEAD', '--no-color', '--no-ext-diff'])) }
  }
  const tracked = git(['ls-files']).trim().split('\n').filter(Boolean)
  return { label: `工作区全部已跟踪文件（${tracked.length} 个）`, lines: tracked.flatMap(fileLines) }
}

/* ── 主流程 ───────────────────────────────────────────────────────────── */

function main() {
  // 规则自检先行：规则被改坏时，宁可这里报错，也不要静默放行一切。
  const broken = runSelfTest()
  if (broken.length > 0) {
    console.error('[scan-sanitize] 规则自检失败，闸门不可信，已中止：')
    for (const b of broken) console.error(`  ${b}`)
    console.error('  修好 scripts/scan-sanitize.mjs 的 RULES/自检样本后重试。')
    return 2
  }
  if (process.argv.includes('--self-test')) {
    console.log(`[scan-sanitize] 规则自检通过（${RULES.length} 条规则）。`)
    return 0
  }

  const { label, lines } = collectSources(process.argv)
  const hits = []
  for (const { file, line, text } of lines) {
    for (const { name, hit } of RULES) {
      if (hit(text)) hits.push({ name, file, line, snippet: text.trim().slice(0, 160) })
    }
  }

  if (hits.length === 0) {
    console.log(`[scan-sanitize] 通过：${label}，扫 ${lines.length} 行，无命中。`)
    return 0
  }

  console.error(`[scan-sanitize] 拦截：${label}，扫 ${lines.length} 行，命中 ${hits.length} 处。\n`)
  // 只回显截断片段，避免把整条密钥打进终端/日志。
  for (const h of hits) {
    console.error(`  ${h.file}:${h.line}  【${h.name}】`)
    console.error(`      ${h.snippet}`)
  }
  console.error(
    `\n处置：把上面的个人路径/邮箱改成占位符（路径写成家目录缩写，邮箱用 ` +
      `${t(121, 111, 117)}${t(64)}${t(101, 120, 97, 109, 112, 108, 101)}${t(46, 99, 111, 109)} 这类示例地址），` +
      `密钥从源码里删掉并立刻作废重发；确认是误报可在本次推送时用 git push --no-verify 显式跳过。`,
  )
  return 1
}

process.exit(main())
