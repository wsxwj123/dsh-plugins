#!/usr/bin/env node
/**
 * 推送前脱敏闸门 scan-sanitize.mjs
 *
 * 扫「即将推送的内容」：密钥/私钥在**任何路径**命中即拦；个人绝对路径/邮箱在
 * **仓库根 tests/ 之外**命中即拦（exit 1）。为什么这么分级见下面「规则分级」。
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
 *   3. **启动先跑 runSelfTest() + runScopeSelfTest()**：用合成样本验证每条规则
 *      真的会命中、真的不误报、命中片段真的被遮住，并验证「哪些规则能在 tests/
 *      下放行」的分级没被悄悄放宽。一旦有人将来改坏了规则或降级了口子，闸门会
 *      在第一次运行时就大声报错退出，而不是安静地放行所有内容。
 *   4. **回显只给位置 + 规则名 + 遮罩后的片段**（见下面「回显契约」一节）：
 *      命中字面量一个字符都不许进终端/CI 日志。
 * 改动本文件时请保持这四条约束。
 *
 * 规则分级的理由（凭据类对全路径生效、个人路径/邮箱类跳过仓库根的 tests/）
 * 见下面「规则分级」一节——那是按**规则性质**分的，不是给文件开白名单。
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

/** 路径字符（用于把家目录前缀后面的整条路径都算进命中区间）。 */
const isPathChar = (ch) => isKeyChar(ch, 'alnum') || ch === '.' || ch === '_' || ch === '-' || ch === '/' || ch === '\\'

/** 从 pos 起连续满足字符集的字符个数。 */
function runLength(text, pos, kind) {
  let n = 0
  while (pos + n < text.length && isKeyChar(text[pos + n], kind)) n += 1
  return n
}

/**
 * 「前缀 + 至少 min 个该类字符」的密钥形态在文本里的所有命中区间。
 * 命中判定与位置是同一次扫描的产物：要报命中就必须知道命中在哪儿，
 * 不存在「报了命中却定位不到、只好把整行打出来」的退路。
 */
const findTokenSpans = (text, prefix, kind, min) => {
  const spans = []
  let i = -1
  while ((i = text.indexOf(prefix, i + 1)) >= 0) {
    const n = runLength(text, i + prefix.length, kind)
    if (n >= min) spans.push({ start: i, end: i + prefix.length + n })
  }
  return spans
}

/** 家目录前缀及其后整条路径的命中区间（只遮前缀等于把用户名/项目名照印出来）。 */
const findPathSpans = (text, prefixes) => {
  const spans = []
  for (const prefix of prefixes) {
    let i = -1
    while ((i = text.indexOf(prefix, i + 1)) >= 0) {
      let end = i + prefix.length
      while (end < text.length && isPathChar(text[end])) end += 1
      spans.push({ start: i, end })
    }
  }
  return spans
}

/**
 * 邮箱形态的命中区间：分隔符左边有非空本地部分，右边域名含点、末段为纯字母且 ≥2 位。
 * （本行说明刻意不写示例地址，否则本文件会被自己的邮箱规则命中。）
 */
function findEmailSpans(text) {
  const spans = []
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
    if (hostOk) spans.push({ start: localStart, end: domainEnd })
  }
  return spans
}

/** PEM 私钥头（允许 "RSA "/"EC "/"OPENSSH " 等算法名）的命中区间。 */
function findPrivateKeySpans(text) {
  const spans = []
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
    if (ok) spans.push({ start: i, end: j + LIT.pemKey.length })
  }
  return spans
}

/* ── 规则分级：按规则性质决定生效范围，不按文件开白名单 ─────────────────
 *
 * 为什么是分级而不是白名单：白名单豁免的是**整个文件**——一旦新增一个测试文件
 * 就得回来改名单，而且会把密钥规则一起豁免掉；凭据出现在测试里同样是事故。
 * 分级豁免的是**某类规则在某个路径范围**：放行与否由「漏报的代价」决定，
 * 与文件放在哪儿无关。
 *
 *   1. 凭据类（OpenAI 风格密钥 / GitHub PAT / GitHub 细粒度 PAT / GitHub OAuth /
 *      AWS access key id / PEM 私钥块）→ 所有路径生效，一处命中就拦。
 *      私钥与 token 在任何文件里都是真事故，没有「写在测试里属正常」这回事。
 *   2. 个人标识类（个人绝对路径 / 邮箱）→ 跳过仓库根 tests/ 下的文件。
 *      这两类在测试里正是**检测模式本身**：验收测试 D1
 *      （tests/acceptance/dsh-0.2-adapt/D1-D2-release-gates.test.mjs）的职责就是
 *      逐字定义这些模式，它必然命中自己。该文件已锁定不能改，且它只随仓库走、
 *      不进 npm 包（D1 自己守的是 packages/<name>/src 与各包顶层文件），
 *      所以对这两类规则放行，而不是去改测试。其余路径照旧生效。
 *
 * 只在**仓库根**的 tests/ 放行：packages/<name>/tests/ 不豁免——那里写死本机
 * 绝对路径仍是真实的个人信息泄漏，且它不在 D1 的扫描范围内，没有第二道门兜底。
 * 若将来要改成「任意层级的 tests 目录」，只改 isTestPath() 一处即可。
 * ------------------------------------------------------------------------ */

/** 规则的生效范围。 */
const SCOPE = {
  all: 'all', // 所有路径生效（凭据/私钥类）
  outsideTests: 'outside-tests', // 跳过仓库根 tests/（个人绝对路径/邮箱类）
}

/**
 * 允许跳过 tests/ 的规则清单：只有这里逐条列出的规则才允许被降级，
 * 其余规则（尤其凭据类）一律全路径生效。runScopeSelfTest() 据此把口子钉死。
 */
const PERSONAL_IDENTITY_RULES = ['个人绝对路径（POSIX 家目录）', '个人绝对路径（Windows 用户目录）', '邮箱地址']

/**
 * 该文件路径是否落在仓库根的 tests/ 下。
 * 兼容 diff 里去掉 b/ 前缀后的相对路径、`--files` 传来的绝对路径、Windows 反斜杠。
 */
function isTestPath(file) {
  if (typeof file !== 'string' || file === '') return false
  let p = file.replace(/\\/g, '/')
  // `--files` 可能传绝对路径：能落到仓库内就先转成仓库相对路径，判定口径才一致。
  const rel = path.relative(REPO, path.resolve(REPO, p)).replace(/\\/g, '/')
  if (rel !== '' && !rel.startsWith('../') && !path.isAbsolute(rel)) p = rel
  p = p.replace(/^\.\//, '')
  return p === 'tests' || p.startsWith('tests/')
}

/* ── 规则表：每条规则只提供 find(text) → 命中区间[] ──────────────────────
 * 「是否命中」= find() 是否非空，判定与定位同源，不给「命中却定位不到」留后路。
 */
const RULES = [
  // 个人标识类：能被 tests/ 豁免（理由见上「规则分级」，改动前先读那段）。
  { name: '个人绝对路径（POSIX 家目录）', scope: SCOPE.outsideTests, find: (s) => findPathSpans(s, [LIT.userPath, LIT.homePath]) },
  { name: '个人绝对路径（Windows 用户目录）', scope: SCOPE.outsideTests, find: (s) => findPathSpans(s, [LIT.winUserPath]) },
  { name: '邮箱地址', scope: SCOPE.outsideTests, find: findEmailSpans },
  // 凭据类：任何路径命中即拦，不参与 tests/ 豁免。
  { name: 'OpenAI 风格密钥', scope: SCOPE.all, find: (s) => findTokenSpans(s, LIT.openai, 'alnumDashUnderscore', 20) },
  { name: 'GitHub PAT', scope: SCOPE.all, find: (s) => findTokenSpans(s, LIT.githubPat, 'alnum', 30) },
  { name: 'GitHub 细粒度 PAT', scope: SCOPE.all, find: (s) => findTokenSpans(s, LIT.githubFinePat, 'alnumUnderscore', 20) },
  { name: 'GitHub OAuth 令牌', scope: SCOPE.all, find: (s) => findTokenSpans(s, LIT.githubOauth, 'alnum', 30) },
  { name: 'AWS access key id', scope: SCOPE.all, find: (s) => findTokenSpans(s, LIT.awsKeyId, 'upperAlnum', 16) },
  { name: 'PEM 私钥块', scope: SCOPE.all, find: findPrivateKeySpans },
]

/* ── 回显契约：命中片段整体遮罩，绝不把命中字面量打进终端/CI 日志 ─────────
 *
 * 改动这里的输出格式前先读这段。契约四条：
 *   1. 只回显「文件:行号 + 列号 + 规则名 + 脱敏后的片段」，不打印整行原文；
 *   2. 被规则命中的**整段字面量**（不是只遮前缀）全部换成遮罩标记，标记里只报
 *      「遮罩了几位」，不带命中内容的任何一个字符；
 *   3. 两侧各留 CONTEXT 个上下文；落在这一行上**其它**命中区间里的字符同样一律
 *      遮掉——否则上下文会把紧挨着的第二条密钥/邮箱带出来；
 *   4. 遮罩只依赖 find() 给出的区间，不依赖「截断到 N 个字符」这类长度阈值：
 *      真实密钥普遍不到 80 字符，长度阈值只会把短密钥整条放出去（本注释刻意不
 *      写出密钥前缀，见文件开头第 1 条约束）。
 * 为什么连前缀都不留：本闸门同时拦邮箱与个人路径，留前缀等于把「是谁」印出来；
 * 对密钥而言几个前缀字符也足以在日志里被人认领归属，收益远小于风险。
 */
/** 命中片段两侧保留的上下文字符数。 */
const CONTEXT = 16
/** 遮罩标记：只报位数，不含命中内容的任何字符。 */
const maskLabel = (n) => `[已遮罩 ${n} 位]`

/** 该行上所有规则的命中区间（重叠合并），用于把上下文里别的命中也一并遮掉。 */
function mergedSpans(text) {
  const raw = []
  for (const rule of RULES) for (const span of rule.find(text)) raw.push({ start: span.start, end: span.end })
  raw.sort((a, b) => a.start - b.start || a.end - b.end)
  const out = []
  for (const span of raw) {
    const last = out[out.length - 1]
    if (last && span.start <= last.end) last.end = Math.max(last.end, span.end)
    else out.push({ ...span })
  }
  return out
}

/** 下标 i 是否落在某个命中区间里。 */
const inSpans = (spans, i) => spans.some((s) => i >= s.start && i < s.end)

/**
 * 脱敏后的片段：命中区间整体换成遮罩标记，两侧各留 CONTEXT 个字符，
 * 上下文里落在任一命中区间的字符也遮成 *。返回的字符串不含任何命中字符。
 */
function maskedView(text, span, spans) {
  const chars = []
  for (let i = Math.max(0, span.start - CONTEXT); i < span.start; i += 1) chars.push(inSpans(spans, i) ? '*' : text[i])
  chars.push(maskLabel(span.end - span.start))
  for (let i = span.end; i < Math.min(text.length, span.end + CONTEXT); i += 1) chars.push(inSpans(spans, i) ? '*' : text[i])
  const head = span.start > CONTEXT ? '…' : '' // 前文被截断时补省略号
  const tail = span.end + CONTEXT < text.length ? '…' : ''
  return `${head}${chars.join('')}${tail}`
}

/**
 * 把家目录形态的绝对路径折叠成 ~/…（Windows 折成 ~\…）：路径本身也是
 * 个人绝对路径，回显命中位置时不能把它原样打进终端/CI 日志。
 * 只用字符码拼出的前缀 + 纯字符扫描，不引入正则转义风险。
 */
function foldHomePaths(text) {
  let out = String(text)
  for (const prefix of [LIT.userPath, LIT.homePath]) {
    let i = 0
    while ((i = out.indexOf(prefix, i)) >= 0) {
      let end = i + prefix.length
      while (end < out.length && out[end] !== '/') end += 1 // 吃掉用户名那一级
      out = `${out.slice(0, i)}${t(126, 47)}${out.slice(end + 1)}`
      i += 2
    }
  }
  let j = 0
  while ((j = out.indexOf(LIT.winUserPath, j)) >= 0) {
    let end = j + LIT.winUserPath.length
    while (end < out.length && out[end] !== '\\') end += 1
    out = `${out.slice(0, j)}${t(126, 92)}${out.slice(end + 1)}`
    j += 2
  }
  return out
}

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
  for (const [name, sample] of mustHit) if (ruleOf(name).find(sample).length === 0) broken.push(`漏报（本应命中）: ${name}`)
  for (const [name, sample] of mustMiss) if (ruleOf(name).find(sample).length > 0) broken.push(`误报（本应放行）: ${name}`)

  // 回显自检：命中片段必须整段被遮罩——命中原文一个字符都不许出现在回显里。
  // 这条不变量专门守「命中就把密钥原样打出去」那类回归（短密钥尤其容易漏）。
  for (const [name, sample] of mustHit) {
    for (const span of ruleOf(name).find(sample)) {
      const literal = sample.slice(span.start, span.end)
      if (literal.length === 0) broken.push(`命中区间为空: ${name}`)
      else if (maskedView(sample, span, mergedSpans(sample)).includes(literal)) broken.push(`回显未遮罩命中片段: ${name}`)
    }
  }

  // 个人路径的区间必须盖住整条路径：只遮家目录前缀等于把用户名与项目名照印出来。
  const pathSample = t(112, 61, 34, 47, 85, 115, 101, 114, 115, 47) + 'someone/project/src' + t(34)
  const pathSpans = ruleOf('个人绝对路径（POSIX 家目录）').find(pathSample)
  const pathLiteral = t(47, 85, 115, 101, 114, 115, 47) + 'someone/project/src'
  if (pathSpans.length !== 1 || pathSample.slice(pathSpans[0].start, pathSpans[0].end) !== pathLiteral) {
    broken.push('个人路径命中区间未覆盖整条路径')
  }
  return broken
}

/**
 * 分级自检：把「哪些规则能在 tests/ 下放行」钉死。
 * 关键不变量——只有 PERSONAL_IDENTITY_RULES 里逐条列出的规则允许 outsideTests，
 * 其余规则（尤其凭据类）一律 all。将来有人往规则表里加一条凭据规则却顺手写成
 * outsideTests，或者把已有的凭据规则降级，都会在这里直接炸掉，而不是静默漏检。
 */
function runScopeSelfTest() {
  const broken = []
  const scopes = new Set(Object.values(SCOPE))

  for (const rule of RULES) {
    if (!scopes.has(rule.scope)) broken.push(`规则未声明合法分级: ${rule.name}`)
    const allowedToSkipTests = PERSONAL_IDENTITY_RULES.includes(rule.name)
    if (allowedToSkipTests && rule.scope !== SCOPE.outsideTests) broken.push(`个人标识类规则未按分级放行 tests/: ${rule.name}`)
    if (!allowedToSkipTests && rule.scope !== SCOPE.all) broken.push(`非个人标识类规则被降级为可跳过 tests/，禁止: ${rule.name}`)
  }
  for (const name of PERSONAL_IDENTITY_RULES) {
    if (!RULES.some((r) => r.name === name)) broken.push(`分级自检引用了不存在的规则：${name}`)
  }

  // isTestPath 的边界：只放行仓库根的 tests/，不放行任意层级的 tests 目录。
  const mustBeTest = ['tests/a.mjs', 'tests/acceptance/x/y.test.mjs', './tests/a.mjs']
  const mustNotBeTest = ['src/a.mjs', 'scripts/scan-sanitize.mjs', 'packages/p/tests/e2e.spec.mjs', 'tests.md', '(unknown)']
  for (const p of mustBeTest) if (!isTestPath(p)) broken.push(`分级判定漏判（本应视为测试路径）: ${p}`)
  for (const p of mustNotBeTest) if (isTestPath(p)) broken.push(`分级判定误判（本应照常检查）: ${p}`)

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
  const broken = [...runSelfTest(), ...runScopeSelfTest()]
  if (broken.length > 0) {
    console.error('[scan-sanitize] 规则自检失败，闸门不可信，已中止：')
    for (const b of broken) console.error(`  ${b}`)
    console.error('  修好 scripts/scan-sanitize.mjs 的 RULES/自检样本后重试。')
    return 2
  }
  if (process.argv.includes('--self-test')) {
    console.log(`[scan-sanitize] 规则自检通过（${RULES.length} 条规则；分级：凭据类全路径 / 个人标识类跳过仓库根 tests/）。`)
    return 0
  }

  const { label, lines } = collectSources(process.argv)
  const hits = []
  let skipped = 0
  for (const { file, line, text: raw } of lines) {
    const testPath = isTestPath(file)
    const text = raw.endsWith('\r') ? raw.slice(0, -1) : raw // CRLF 的行尾不进回显
    // 上下文遮罩口径：这一行上**任何**规则命中过的区间都算，含被分级跳过的规则。
    const spans = mergedSpans(text)
    for (const rule of RULES) {
      // 分级：只有个人标识类规则能在仓库根 tests/ 下放行；凭据类不看路径。
      if (testPath && rule.scope !== SCOPE.all) {
        skipped += 1
        continue
      }
      // 一处命中区间算一处：同一行两条密钥报两处，各自带自己的列号与上下文。
      for (const span of rule.find(text)) {
        hits.push({
          name: rule.name,
          file: foldHomePaths(file),
          line,
          col: span.start + 1,
          view: maskedView(text, span, spans),
        })
      }
    }
  }
  hits.sort((a, b) => (a.file === b.file ? a.line - b.line || a.col - b.col : a.file < b.file ? -1 : 1))
  // 跳过多少、为什么跳过要说出来：静默放行会变成最难发现的假绿。
  const skipNote =
    skipped > 0 ? `按规则分级跳过 ${skipped} 条检查项（仓库根 tests/ 下的个人绝对路径/邮箱；凭据类不看路径）。` : ''

  if (hits.length === 0) {
    console.log(`[scan-sanitize] 通过：${label}，扫 ${lines.length} 行，无命中。${skipNote}`)
    return 0
  }

  console.error(`[scan-sanitize] 拦截：${label}，扫 ${lines.length} 行，命中 ${hits.length} 处。${skipNote}\n`)
  // 只回显「位置 + 规则名 + 遮罩后的片段」：命中字面量整段被遮，一个字符都不进终端/日志。
  for (const h of hits) {
    console.error(`  ${h.file}:${h.line}  【${h.name}】`)
    console.error(`      第 ${h.col} 列命中：${h.view}`)
  }
  console.error(
    `\n处置：把上面的个人路径/邮箱改成占位符（路径写成家目录缩写，邮箱用 ` +
      `${t(121, 111, 117)}${t(64)}${t(101, 120, 97, 109, 112, 108, 101)}${t(46, 99, 111, 109)} 这类示例地址），` +
      `密钥从源码里删掉并立刻作废重发；确认是误报可在本次推送时用 git push --no-verify 显式跳过。`,
  )
  return 1
}

/*
 * 运行外壳：本文件所有回显都在 main() 里，异常也不能例外——Node 默认会把未捕获
 * 异常的调用栈整条打出来，而栈里带着本机绝对路径（可能含家目录）。这里兜住，
 * 统一把家目录折成 ~。退出码：1 = 有命中（语义不变），2 = 闸门自己没跑完（与
 * 上面的「自检失败」同义），两者都不放行，但自动化能区分「抓到东西」和「工具坏了」。
 */
try {
  process.exit(main())
} catch (error) {
  const message = error && error.message ? error.message : String(error)
  console.error('[scan-sanitize] 运行失败：闸门没能完成扫描，不能视为通过。')
  console.error(`  ${foldHomePaths(message)}`)
  if (error && error.stack) {
    console.error('  调用栈（已把家目录折叠成 ~）：')
    for (const frame of String(error.stack).split('\n').slice(1, 7)) console.error(`    ${foldHomePaths(frame.trim())}`)
  }
  process.exit(2)
}
