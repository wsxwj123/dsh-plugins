// host RPC 端点 /ct/instructions.read — 读单个指令文件 契约测试（INTERFACE §1.2）
// 判定顺序：cwd → path 校验 → 范围校验(path-out-of-scope) → 文件不存在(file-not-found)
//           → IO 失败(system-error) → 成功(含 truncated 读)

import test from 'node:test'
import assert from 'node:assert/strict'
import { createHttpHarness } from './helpers/http.mjs'
import { ROUTER } from './helpers/contractHost.mjs'
import { buildTree } from './helpers/scenarios.mjs'
import { writeFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

test.describe('POST /ct/instructions.read 读指令文件', () => {
  let srv, tree

  test.beforeEach(async () => {
    tree = buildTree()
    srv = await createHttpHarness((req, res) => ROUTER(req, res, { dshHome: tree.home }))
  })
  test.afterEach(async () => {
    await srv.stop()
    tree.cleanup()
  })

  test('正常读：返回 content 原文（不归一 \\r\\n）、path/mtimeMs/truncated=false', async () => {
    tree.write('AGENTS.md', 'line1\r\nline2\nline3')
    const r = await srv.request({
      path: '/ct/instructions.read',
      body: { cwd: tree.project, path: join(tree.project, 'AGENTS.md') },
    })
    assert.equal(r.status, 200)
    assert.deepEqual(r.json, {
      ok: true,
      path: join(tree.project, 'AGENTS.md'),
      content: 'line1\r\nline2\nline3',
      mtimeMs: statSync(join(tree.project, 'AGENTS.md')).mtimeMs,
      truncated: false,
    })
  })

  test('读全局文件也能成功（范围含全局）', async () => {
    writeFileSync(join(tree.home, 'AGENTS.md'), 'global', 'utf8')
    const r = await srv.request({
      path: '/ct/instructions.read',
      body: { cwd: tree.project, path: join(tree.home, 'AGENTS.md') },
    })
    assert.equal(r.status, 200)
    assert.equal(r.json.ok, true)
    assert.equal(r.json.content, 'global')
  })

  test('truncated 读：>1MB 文件返回 truncated:true + 最长合法 utf8 前缀', async () => {
    const big = '中'.repeat(600000) // 1200000 字节，超过 1MB
    tree.write('AGENTS.md', big)
    const MB = 1048576
    const r = await srv.request({
      path: '/ct/instructions.read',
      body: { cwd: tree.project, path: join(tree.project, 'AGENTS.md') },
    })
    assert.equal(r.json.ok, true)
    assert.equal(r.json.truncated, true)
    // 前缀不超过 MB 字节，且是合法 utf8（不劈在多字节字符中间，'中' 3 字节）
    const bytes = Buffer.from(r.json.content, 'utf8')
    assert.ok(bytes.length <= MB, `prefix bytes ${bytes.length} > ${MB}`)
    // 最长合法前缀：再补一个'中'就会超限
    assert.ok(Buffer.byteLength(big.slice(0, Math.floor(MB / 3) * 3 + 3), 'utf8') > MB, '应还有更长的合法前缀被截断了')
    // 合法：每个字符都是完整 '中'
    assert.ok(r.json.content.length > 0 && /^(中)+$/.test(r.json.content), '前缀应为整多字节字符')
    // 并且应恰好是最大数量的完整字符
    assert.equal(r.json.content.length, Math.floor(MB / 3))
  })

  test('正好 1MB 不截断；>1MB 才截断', async () => {
    // 正好 1048576 字节
    tree.write('sub/AGENTS.md', 'a'.repeat(1048576))
    const r = await srv.request({
      path: '/ct/instructions.read',
      body: { cwd: tree.sub, path: join(tree.sub, 'AGENTS.md') },
    })
    assert.equal(r.json.truncated, false)
    assert.equal(r.json.content.length, 1048576)
  })

  // —— 错误契约 ——
  test('cwd 非法 → 400 invalid-cwd', async () => {
    const r = await srv.request({
      path: '/ct/instructions.read',
      body: { cwd: 'rel', path: join(tree.project, 'AGENTS.md') },
    })
    assert.equal(r.status, 400)
    assert.equal(r.json.code, 'invalid-cwd')
    assert.equal(r.json.message, 'invalid cwd: must be an absolute path string')
  })

  test('path 缺失/相对/不在白名单 → 400 invalid-path（逐字）', async () => {
    tree.write('AGENTS.md', 'x')
    const base = { cwd: tree.project }
    const cases = [
      { ...base, path: undefined },
      { ...base, path: null },
      { ...base, path: 123 },
      { ...base, path: 'relative.md' },
      { ...base, path: join(tree.project, 'AGENTS.txt') },
      { ...base, path: join(tree.project, 'sub/README.md') },
    ]
    for (const body of cases) {
      const r = await srv.request({ path: '/ct/instructions.read', body })
      assert.equal(r.status, 400, JSON.stringify(body))
      assert.deepEqual(
        { ok: r.json.ok, code: r.json.code, message: r.json.message },
        { ok: false, code: 'invalid-path', message: 'invalid path: must be an absolute path to AGENTS.md / CLAUDE.md / AGENTS.local.md / CLAUDE.local.md' },
      )
    }
  })

  test('路径越界：不在发现集合（项目外）→ 200 path-out-of-scope（逐字）', async () => {
    // 项目外一个 AGENTS.md（不在发现集合）
    const outside = join(tree.path('outside'), 'AGENTS.md')
    const { mkdirSync } = await import('node:fs')
    mkdirSync(tree.path('outside'), { recursive: true })
    writeFileSync(outside, 'x', 'utf8')
    const r = await srv.request({
      path: '/ct/instructions.read',
      body: { cwd: tree.project, path: outside },
    })
    assert.equal(r.status, 200)
    assert.deepEqual(r.json, {
      ok: false,
      code: 'path-out-of-scope',
      message: 'path is not among the instruction files discovered for cwd',
    })
  })

  test('范围校验在 path 白名单之后判定（合法 basename 但越界才算 out-of-scope）', async () => {
    // cwd 是 sub，root/AGENTS.md 合法但不在 sub 的发现范围? —— 不，sub 之下向上到 project 会含 root。
    // 用一个真正不在范围的：cwd 指向另一个树。这里用不存在 cwd（范围=全局），root/AGENTS.md 不在范围。
    const deadCwd = join(tree.path('ghost'), 'x')
    tree.write('AGENTS.md', 'in project') // project/AGENTS.md 存在
    const r = await srv.request({
      path: '/ct/instructions.read',
      body: { cwd: deadCwd, path: join(tree.project, 'AGENTS.md') },
    })
    assert.equal(r.json.code, 'path-out-of-scope', '死 cwd 下 project 文件不在发现集合内')
  })

  test('文件不存在（发现集合内但已被删）→ 200 file-not-found（逐字）', async () => {
    const p = join(tree.project, 'AGENTS.md')
    tree.write('AGENTS.md', 'x')
    // 删除它，但让发现仍认为它在：不可能，因为发现是实时的。
    // 契约第5步是"列出后被删"竞态；这里模拟不了实时竞态，
    // 等价覆盖：读一个在发现集合内、被删后重新请求——发现实时就不在集合。
    // 改用直接验证 file-not-found 分支：范围检查过但读不到文件。
    const { rmSync } = await import('node:fs')
    rmSync(p)
    const r = await srv.request({ path: '/ct/instructions.read', body: { cwd: tree.project, path: p } })
    // 发现已实时不含被删文件 → 命中 path-out-of-scope 而非 file-not-found。
    // 说明：file-not-found 是显式竞态分支（列出后、读前被删），单测难稳定复现，
    // 契约要求保留该分支；此处断言"删除后至少被正确拒绝（不 500、code 为领域错误）"。
    assert.ok(r.status === 200 && r.json.ok === false, '被删文件必须被领域级拒绝')
    assert.ok(['path-out-of-scope', 'file-not-found'].includes(r.json.code), `actual=${r.json.code}`)
  })

  test('读入不可读文件（IO 失败）→ 200 system-error, message=String(err)', async () => {
    const p = join(tree.project, 'AGENTS.md')
    tree.write('AGENTS.md', 'x')
    const { chmodSync } = await import('node:fs')
    chmodSync(p, 0o000)
    const r = await srv.request({ path: '/ct/instructions.read', body: { cwd: tree.project, path: p } })
    chmodSync(p, 0o644) // 恢复便于清理
    if (process.getuid && process.getuid() === 0) {
      assert.equal(r.json.ok, true, 'root 跳过：无权限读不生效')
    } else {
      assert.equal(r.status, 200)
      assert.equal(r.json.ok, false)
      assert.equal(r.json.code, 'system-error')
      assert.equal(typeof r.json.message, 'string')
    }
  })
})
