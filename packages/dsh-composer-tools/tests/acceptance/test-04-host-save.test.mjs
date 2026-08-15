// host RPC 端点 /ct/instructions.save — 写回指令文件 契约测试（INTERFACE §1.3）
// 判定顺序：cwd → path → content → expectedMtimeMs → allowTruncatedBase →
// 范围(path-out-of-scope) → 不存在(file-not-found, 不建文件) →
// 截断保护(file-truncated) → mtime 乐观锁(mtime-conflict) → 写入(system-error/success).
// 反向用例：save 不得创建新文件、不得写出项目根范围。

import test from 'node:test'
import assert from 'node:assert/strict'
import { createHttpHarness } from './helpers/http.mjs'
import { ROUTER } from './helpers/contractHost.mjs'
import { buildTree } from './helpers/scenarios.mjs'
import { writeFileSync, readFileSync, existsSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

test.describe('POST /ct/instructions.save 写回指令文件', () => {
  let srv, tree

  test.beforeEach(async () => {
    tree = buildTree()
    srv = await createHttpHarness((req, res) => ROUTER(req, res, { dshHome: tree.home }))
  })
  test.afterEach(async () => {
    await srv.stop()
    tree.cleanup()
  })

  const mtimeOf = (p) => statSync(p).mtimeMs

  test('正常写入：返回 ok:true + 新 mtimeMs，文件内容原样落盘', async () => {
    const p = join(tree.project, 'AGENTS.md')
    tree.write('AGENTS.md', 'old')
    const before = mtimeOf(p)
    const r = await srv.request({
      path: '/ct/instructions.save',
      body: { cwd: tree.project, path: p, content: 'new content', expectedMtimeMs: before },
    })
    assert.equal(r.status, 200)
    assert.equal(r.json.ok, true)
    assert.equal(typeof r.json.mtimeMs, 'number')
    assert.equal(r.json.mtimeMs, mtimeOf(p), 'mtimeMs 应为写入后重新 stat 的值')
    assert.equal(readFileSync(p, 'utf8'), 'new content')
  })

  // —— 判定顺序：cwd → path → content ——
  test('cwd 非法 → 400 invalid-cwd', async () => {
    const r = await srv.request({
      path: '/ct/instructions.save',
      body: { cwd: 'rel', path: join(tree.project, 'AGENTS.md'), content: 'x', expectedMtimeMs: 0 },
    })
    assert.equal(r.status, 400)
    assert.equal(r.json.code, 'invalid-cwd')
  })

  test('path 非法 → 400 invalid-path（逐字）', async () => {
    const r = await srv.request({
      path: '/ct/instructions.save',
      body: { cwd: tree.project, path: join(tree.project, 'other.md'), content: 'x', expectedMtimeMs: 0 },
    })
    assert.equal(r.status, 400)
    assert.deepEqual(
      { code: r.json.code, message: r.json.message },
      { code: 'invalid-path', message: 'invalid path: must be an absolute path to AGENTS.md / CLAUDE.md / AGENTS.local.md / CLAUDE.local.md' },
    )
  })

  test('content 非法：非 string / 超 1MB → 400 invalid-content（逐字）', async () => {
    const p = join(tree.project, 'AGENTS.md')
    tree.write('AGENTS.md', 'x')
    const base = { cwd: tree.project, path: p, expectedMtimeMs: 0 }
    const overMB = 'x'.repeat(1048577)
    const cases = [
      { ...base, content: undefined },
      { ...base, content: 123 },
      { ...base, content: null },
      { ...base, content: overMB },
    ]
    for (const body of cases) {
      const r = await srv.request({ path: '/ct/instructions.save', body })
      assert.equal(r.status, 400, JSON.stringify({ hasContent: typeof body.content }))
      assert.deepEqual(
        { code: r.json.code, message: r.json.message },
        { code: 'invalid-content', message: 'invalid content: must be a string of at most 1048576 utf8 bytes' },
      )
    }
  })

  test('content 恰好 1MB 允许', async () => {
    const p = join(tree.project, 'AGENTS.md')
    tree.write('AGENTS.md', 'x')
    const r = await srv.request({
      path: '/ct/instructions.save',
      body: { cwd: tree.project, path: p, content: 'x'.repeat(1048576), expectedMtimeMs: mtimeOf(p) },
    })
    assert.equal(r.json.ok, true)
  })

  test('expectedMtimeMs 非法：非 number / 非有限 / 负 → 400 invalid-mtime（逐字）', async () => {
    const p = join(tree.project, 'AGENTS.md')
    tree.write('AGENTS.md', 'x')
    const base = { cwd: tree.project, path: p, content: 'x' }
    const cases = [
      { ...base, expectedMtimeMs: '123' },
      { ...base, expectedMtimeMs: NaN },
      { ...base, expectedMtimeMs: Infinity },
      { ...base, expectedMtimeMs: -1 },
      { ...base, expectedMtimeMs: null },
    ]
    for (const body of cases) {
      const r = await srv.request({ path: '/ct/instructions.save', body })
      assert.equal(r.status, 400, JSON.stringify(body.expectedMtimeMs))
      assert.deepEqual(
        { code: r.json.code, message: r.json.message },
        { code: 'invalid-mtime', message: 'invalid expectedMtimeMs: must be a finite non-negative number' },
      )
    }
  })

  test('allowTruncatedBase 非 boolean → 400 invalid-allow-truncated-base（逐字）', async () => {
    const p = join(tree.project, 'AGENTS.md')
    tree.write('AGENTS.md', 'x')
    const base = { cwd: tree.project, path: p, content: 'x', expectedMtimeMs: 0 }
    const cases = [
      { ...base, allowTruncatedBase: 'yes' },
      { ...base, allowTruncatedBase: 1 },
      { ...base, allowTruncatedBase: null },
    ]
    for (const body of cases) {
      const r = await srv.request({ path: '/ct/instructions.save', body })
      assert.equal(r.status, 400, JSON.stringify(body.allowTruncatedBase))
      assert.deepEqual(
        { code: r.json.code, message: r.json.message },
        { code: 'invalid-allow-truncated-base', message: 'invalid allowTruncatedBase: must be a boolean' },
      )
    }
  })

  test('缺省 allowTruncatedBase 视为 false，不影响正常保存', async () => {
    const p = join(tree.project, 'AGENTS.md')
    tree.write('AGENTS.md', 'x')
    const r = await srv.request({
      path: '/ct/instructions.save',
      body: { cwd: tree.project, path: p, content: 'y', expectedMtimeMs: mtimeOf(p) },
    })
    assert.equal(r.json.ok, true)
    assert.equal(readFileSync(p, 'utf8'), 'y')
  })

  // —— 范围 → 不存在 → 截断保护 → mtime 锁 ——
  test('路径越界：不在发现集合 → 200 path-out-of-scope（逐字，且不动磁盘）', async () => {
    // 项目外文件（不在发现集合）
    const outside = resolve(tree.path('outside'), 'AGENTS.md')
    const { mkdirSync } = await import('node:fs')
    mkdirSync(tree.path('outside'), { recursive: true })
    writeFileSync(outside, 'old-out', 'utf8')
    const r = await srv.request({
      path: '/ct/instructions.save',
      body: { cwd: tree.project, path: outside, content: 'pwn', expectedMtimeMs: mtimeOf(outside) },
    })
    assert.equal(r.status, 200)
    assert.deepEqual(
      { ok: r.json.ok, code: r.json.code, message: r.json.message },
      { ok: false, code: 'path-out-of-scope', message: 'path is not among the instruction files discovered for cwd' },
    )
    assert.equal(readFileSync(outside, 'utf8'), 'old-out', '项目外文件不得被写')
  })

  test('路径越界：符号链接被拒（不在发现集合）→ path-out-of-scope，目标文件不被写', async () => {
    // 项目外真实文件 + 项目根内 symlink AGENTS.md → 外部文件
    const outside = resolve(tree.path('outside'), 'real.md')
    const { mkdirSync, symlinkSync } = await import('node:fs')
    mkdirSync(tree.path('outside'), { recursive: true })
    writeFileSync(outside, 'real', 'utf8')
    symlinkSync(outside, join(tree.project, 'AGENTS.md'), 'file')
    const r = await srv.request({
      path: '/ct/instructions.save',
      body: { cwd: tree.project, path: join(tree.project, 'AGENTS.md'), content: 'hijacked', expectedMtimeMs: 0 },
    })
    assert.equal(r.json.code, 'path-out-of-scope', '符号链接不被发现 → 判定越界')
    assert.equal(readFileSync(outside, 'utf8'), 'real', 'symlink 指向的真实文件不得被写')
  })

  test('反向用例：save 不创建新文件（文件不存在 → 领域级拒绝，且文件仍不存在）', async () => {
    const p = join(tree.project, 'AGENTS.md')
    assert.equal(existsSync(p), false)
    const r = await srv.request({
      path: '/ct/instructions.save',
      body: { cwd: tree.project, path: p, content: 'new', expectedMtimeMs: 0 },
    })
    assert.equal(r.status, 200)
    assert.equal(r.json.ok, false)
    assert.equal(r.json.code, 'path-out-of-scope', '不存在文件同时也不在实时发现集合 → 按判定顺序先命中 scope')
    assert.equal(existsSync(p), false, 'save 不得创建不存在的文件')
    // 反向：磁盘确实没被写
    // 说明：判定顺序是“范围检查(step7)先于 file-not-found(step8)”。
    // 发现集合是实时的，不存在的文件同时也不在集合内，因此按契约顺序先命中
    // path-out-of-scope；file-not-found 是“发现后、读前被删”的竞态分支，
    // 这一支无法单测稳定复现，但契约保留它。反向用例的核心承诺（不建新文件）
    // 在此成立。
  })

  test('截断保护：>1MB 文件且未 allowTruncatedBase → 200 file-truncated（逐字）', async () => {
    const p = join(tree.project, 'AGENTS.md')
    tree.write('AGENTS.md', '中'.repeat(400000)) // 1200000 + bytes
    const r = await srv.request({
      path: '/ct/instructions.save',
      body: { cwd: tree.project, path: p, content: 'small replacement', expectedMtimeMs: mtimeOf(p) },
    })
    assert.equal(r.status, 200)
    assert.deepEqual(
      { ok: r.json.ok, code: r.json.code, message: r.json.message },
      {
        ok: false,
        code: 'file-truncated',
        message: 'file exceeds 1048576 bytes; saving a truncated base would silently drop the tail — edit it with an external editor, or resend with allowTruncatedBase:true',
      },
    )
    // 文件未被改动
    assert.ok(Buffer.byteLength(readFileSync(p, 'utf8'), 'utf8') > 1048576)
  })

  test('截断保护逃生门：allowTruncatedBase:true 允许覆盖 >1MB 文件', async () => {
    const p = join(tree.project, 'AGENTS.md')
    tree.write('AGENTS.md', '中'.repeat(400000))
    const r = await srv.request({
      path: '/ct/instructions.save',
      body: { cwd: tree.project, path: p, content: 'over', expectedMtimeMs: mtimeOf(p), allowTruncatedBase: true },
    })
    assert.equal(r.json.ok, true)
    assert.equal(readFileSync(p, 'utf8'), 'over')
  })

  test('mtime 乐观锁：expectedMtimeMs 与磁盘不等 → 200 mtime-conflict + currentMtimeMs（逐字）', async () => {
    const p = join(tree.project, 'AGENTS.md')
    tree.write('AGENTS.md', 'x')
    const stale = mtimeOf(p) - 5000 // 过期基线
    const r = await srv.request({
      path: '/ct/instructions.save',
      body: { cwd: tree.project, path: p, content: 'y', expectedMtimeMs: stale },
    })
    assert.equal(r.status, 200)
    assert.equal(r.json.ok, false)
    assert.equal(r.json.code, 'mtime-conflict')
    assert.equal(r.json.message, 'file changed on disk since it was read')
    assert.equal(r.json.currentMtimeMs, mtimeOf(p))
    // 冲突时不写入
    assert.equal(readFileSync(p, 'utf8'), 'x')
  })

  test('系统级并发写入：两次 save 之间磁盘被改 → 第二次 mtime-conflict', async () => {
    const p = join(tree.project, 'AGENTS.md')
    tree.write('AGENTS.md', 'v1')
    const m1 = mtimeOf(p)
    const r1 = await srv.request({ path: '/ct/instructions.save', body: { cwd: tree.project, path: p, content: 'v2', expectedMtimeMs: m1 } })
    assert.equal(r1.json.ok, true)
    // 外部把文件改了（mtime 变）
    await new Promise((r) => setTimeout(r, 20))
    writeFileSync(p, 'external', 'utf8')
    const r2 = await srv.request({
      path: '/ct/instructions.save',
      body: { cwd: tree.project, path: p, content: 'client-thinks-v2', expectedMtimeMs: r1.json.mtimeMs },
    })
    assert.equal(r2.json.code, 'mtime-conflict', '外部修改后重存应冲突')
  })

  test('写内容含 \\n 后缀：原样落盘，不做归一', async () => {
    const cp = join(tree.project, 'CLAUDE.md')
    tree.write('CLAUDE.md', 'c')
    const r = await srv.request({
      path: '/ct/instructions.save',
      body: { cwd: tree.project, path: cp, content: 'a\nb\n', expectedMtimeMs: mtimeOf(cp) },
    })
    assert.equal(r.json.ok, true)
    assert.equal(readFileSync(cp, 'utf8'), 'a\nb\n')
  })
})
