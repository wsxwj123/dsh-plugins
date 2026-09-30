// 发布面门禁（必验清单 D1、D2）— 跨三个包
//
// D1 脱敏：扫描开发者手写的「随包发布」内容（src/**、package.json、cordis.patch.yml、
// build.mjs、NOTICE、README、CHANGELOG）是否出现个人绝对路径 / 邮箱 / 密钥 / 私钥。
// 这是发布前闸门，不是 bug 复现测试——当前应为绿；一旦有人把个人路径/密钥/邮箱写进源码即红。
// 注意：lib/、skins/、data/ 是构建产物 / 精选第三方皮肤 / 精选提示词数据，不在此扫描范围
// （皮肤 bundle 里出现 `/home/` 等属第三方内容，非本仓库开发者泄漏，故不按「个人路径」扫）。
//
// D2 构建完整性：确认三个包的构建入口都在，且「lib 已提交」的包（turn-scrubber、
// appearance-gallery）产物非空；composer-tools 的 lib/ 按 .gitignore 约定是构建期生成，
// 不要求随仓库存在——其「重建」走 node build.mjs（见 TEST-PLAN 运行命令）。
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { PKGS, walk } from './helpers.mjs'

// 开发者手写内容：src 全部 + 顶层配置/文档（排除构建产物与精选资产）
function developerFiles(pkgDir) {
  const top = [
    'package.json',
    'cordis.patch.yml',
    'build.mjs',
    'NOTICE',
    'README.md',
    'README.en.md',
    'README.zh-CN.md',
    'CHANGELOG.md',
    'LICENSE',
  ]
  const files = walk(path.join(pkgDir, 'src'), null)
  for (const t of top) {
    const p = path.join(pkgDir, t)
    if (fs.existsSync(p)) files.push(p)
  }
  return files
}

const ALL_FILES = [
  ...developerFiles(PKGS.turnScrubber),
  ...developerFiles(PKGS.composerTools),
  ...developerFiles(PKGS.appearanceGallery),
]

const PATTERNS = [
  { name: '个人绝对路径 /Users/…', re: /\/Users\/[A-Za-z0-9_.-]+/ },
  { name: '邮箱地址', re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/ },
  { name: 'OpenAI 密钥 sk-…', re: /\bsk-[A-Za-z0-9]{20,}/ },
  { name: 'GitHub PAT ghp_…', re: /\bghp_[A-Za-z0-9]{30,}/ },
  { name: 'GitHub 细粒度 PAT github_pat_…', re: /\bgithub_pat_[A-Za-z0-9_]{20,}/ },
  { name: '私钥块 PRIVATE KEY', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
]

for (const { name, re } of PATTERNS) {
  test(`D1 脱敏_开发者手写内容不含「${name}」`, () => {
    const hits = []
    for (const f of ALL_FILES) {
      const text = fs.readFileSync(f, 'utf8')
      if (re.test(text)) hits.push(path.relative(path.dirname(PKGS.turnScrubber), f))
    }
    assert.deepEqual(hits, [], `以下文件命中「${name}」：${hits.join(', ')}`)
  })
}

// ---------------- D2：构建入口 + 已提交产物完整性 ----------------
test('D2 构建完整性_三个包 build.mjs 均存在', () => {
  for (const [name, dir] of Object.entries(PKGS)) {
    assert.ok(fs.existsSync(path.join(dir, 'build.mjs')), `${name} 缺少 build.mjs`)
  }
})

test('D2 构建完整性_turn-scrubber 与 appearance-gallery 的 lib 产物非空（源码改动后需重建）', () => {
  for (const name of ['turnScrubber', 'appearanceGallery']) {
    const dir = PKGS[name]
    for (const entry of ['lib/index.js', 'lib/client.js']) {
      const p = path.join(dir, entry)
      assert.ok(fs.existsSync(p), `${name} 缺少 ${entry}（改源码后跑 node build.mjs 重建）`)
      assert.ok(fs.statSync(p).size > 0, `${name} ${entry} 为空（构建产物异常）`)
    }
  }
})

test('D2 构建完整性_composer-tools 的 lib 按约定为构建期生成（.gitignore 含 lib/）', () => {
  const gi = path.join(PKGS.composerTools, '.gitignore')
  const text = fs.existsSync(gi) ? fs.readFileSync(gi, 'utf8') : ''
  assert.match(text, /^lib\/\s*$/m, 'composer-tools/.gitignore 未忽略 lib/（重建走 node build.mjs）')
})
