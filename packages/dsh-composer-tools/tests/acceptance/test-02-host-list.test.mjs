// host RPC 端点 /ct/instructions.list — 指令文件发现 契约测试（INTERFACE §1.1）
// 正常路径 / 排序契约 / cwd 不存在语义 / 符号链接拒收 / 各错误契约 /
// displayPath 与 level 规则 / 去重。
//
// 驱动：契约参考实现；换真实插件只改底部 ROUTER 注入。

import test from 'node:test'
import assert from 'node:assert/strict'
import { createHttpHarness } from './helpers/http.mjs'
import { ROUTER } from './helpers/contractHost.mjs'
import { buildTree } from './helpers/scenarios.mjs'
import { writeFileSync, symlinkSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

function harness(ctx) {
  return createHttpHarness((req, res) => ROUTER(req, res, ctx || {}))
}

test.describe('POST /ct/instructions.list 指令发现', () => {
  let srv, tree
  let ctx

  test.beforeEach(async () => {
    tree = buildTree()
    ctx = { dshHome: tree.home }
    srv = await harness({ dshHome: tree.home })
  })
  test.afterEach(async () => {
    await srv.stop()
    tree.cleanup()
  })

  test('正常：全局 + 项目根 + 子目录 + nested 的指令文件按发现顺序列出', async () => {
    // 真实全局文件放 fake dshHome
    writeFileSync(join(ctx.dshHome, 'AGENTS.md'), 'global: base\n', 'utf8')
    tree.write('AGENTS.md', '# project root')
    tree.write('CLAUDE.md', '# project claude')
    tree.write('AGENTS.local.md', '# project local')
    tree.write('sub/AGENTS.md', '# sub')
    tree.write('sub/nested/CLAUDE.md', '# nested claude')

    const r = await srv.request({
      path: '/ct/instructions.list',
      body: { cwd: tree.nested },
    })
    assert.equal(r.status, 200)
    assert.equal(r.json.ok, true, JSON.stringify(r.json))
    assert.equal(r.json.dshHome, ctx.dshHome)
    assert.equal(r.json.projectRoot, tree.project)
    // 排序契约：全局在前 → project 根→cwd 由宽到窄 → 常规候选先于 local
    const paths = r.json.files.map((f) => f.path)
    assert.deepEqual(paths, [
      join(ctx.dshHome, 'AGENTS.md'),        // global
      join(tree.project, 'AGENTS.md'),       // project root 常规
      join(tree.project, 'CLAUDE.md'),       // project root 常规
      join(tree.project, 'AGENTS.local.md'), // project root local
      join(tree.sub, 'AGENTS.md'),           // sub 常规
      join(tree.nested, 'CLAUDE.md'),        // nested 常规
    ])
  })

  test('字段精确：path/displayPath/level/name 逐项断言', async () => {
    writeFileSync(join(ctx.dshHome, 'AGENTS.md'), 'g', 'utf8')
    tree.write('AGENTS.md', 'r')
    tree.write('sub/AGENTS.local.md', 'local')

    const r = await srv.request({ path: '/ct/instructions.list', body: { cwd: tree.sub } })
    const g = r.json.files.find((f) => f.level === 'global')
    // 非默认 dshHome → $DSH_HOME/AGENTS.md
    assert.equal(g.displayPath, '$DSH_HOME/AGENTS.md')
    assert.equal(g.path, join(ctx.dshHome, 'AGENTS.md'))
    assert.equal(g.name, 'AGENTS.md')

    const proj = r.json.files.find((f) => f.path === join(tree.project, 'AGENTS.md'))
    assert.equal(proj.level, 'project')
    assert.equal(proj.displayPath, 'AGENTS.md')

    const local = r.json.files.find((f) => f.path === join(tree.sub, 'AGENTS.local.md'))
    assert.equal(local.level, 'local')
    assert.equal(local.displayPath, 'sub/AGENTS.local.md')
    // sizeBytes/mtimeMs 类型
    assert.equal(typeof local.sizeBytes, 'number')
    assert.equal(typeof local.mtimeMs, 'number')
  })

  test('一个文件都没有 → files: [] 且 ok:true', async () => {
    const r = await srv.request({ path: '/ct/instructions.list', body: { cwd: tree.sub } })
    assert.equal(r.status, 200)
    assert.equal(r.json.ok, true)
    assert.deepEqual(r.json.files, [])
    assert.equal(r.json.projectRoot, tree.project)
  })

  test('排序：项目根→cwd 由宽到窄；常规候选先于 local', async () => {
    tree.write('AGENTS.md', 'r')
    tree.write('CLAUDE.local.md', 'root local')      // 根目录 local
    tree.write('sub/CLAUDE.md', 'sub claude')        // 子目录常规
    tree.write('sub/nested/AGENTS.local.md', 'n local') // 最深层 local

    const r = await srv.request({ path: '/ct/instructions.list', body: { cwd: tree.nested } })
    const paths = r.json.files.map((f) => f.path)
    const rel = r.json.files.map((f) => f.displayPath)
    // 顺序：根常规 → 根 local → sub 常规 → sub local(无) → nested 常规(无) → nested local
    assert.deepEqual(rel, ['AGENTS.md', 'CLAUDE.local.md', 'sub/CLAUDE.md', 'sub/nested/AGENTS.local.md'])
  })

  test('去重：同一绝对路径不重复列出', async () => {
    // cwd 就在项目根，根目录的 AGENTS.md 只会出现一次
    tree.write('AGENTS.md', 'dup?')
    const r = await srv.request({ path: '/ct/instructions.list', body: { cwd: tree.project } })
    const paths = r.json.files.map((f) => f.path)
    assert.equal(new Set(paths).size, paths.length)
    assert.equal(paths.filter((p) => p === join(tree.project, 'AGENTS.md')).length, 1)
  })

  test('符号链接不收录：指向项目外的 AGENTS.md 不出现', async () => {
    // 项目外真实文件（先建父目录）
    const ext = tree.path('external')
    mkdirSync(ext, { recursive: true })
    writeFileSync(join(ext, 'AGENTS.md'), 'outside', 'utf8')
    // 项目根内一个符号链接 AGENTS.md → 外部文件
    symlinkSync(join(ext, 'AGENTS.md'), join(tree.project, 'AGENTS.md'), 'file')
    const r = await srv.request({ path: '/ct/instructions.list', body: { cwd: tree.project } })
    assert.equal(r.json.ok, true)
    const hasSymlink = r.json.files.some((f) => f.path === join(tree.project, 'AGENTS.md'))
    assert.equal(hasSymlink, false, '符号链接不得被收录')
  })

  test('cwd 不存在 → 不报错，ok:true 且 projectRoot=resolve(cwd)、只含全局文件（若存在）', async () => {
    // 无全局文件
    const deadCwd = join(tree.path('ghost'), 'deeper')
    const r1 = await srv.request({ path: '/ct/instructions.list', body: { cwd: deadCwd } })
    assert.equal(r1.status, 200)
    assert.equal(r1.json.ok, true)
    assert.equal(r1.json.projectRoot, resolve(deadCwd))
    assert.deepEqual(r1.json.files, [])

    // 存在全局文件时，cwd 死目录仍列全局
    writeFileSync(join(ctx.dshHome, 'AGENTS.md'), 'g', 'utf8')
    const r2 = await srv.request({ path: '/ct/instructions.list', body: { cwd: deadCwd } })
    assert.equal(r2.json.ok, true)
    assert.equal(r2.json.projectRoot, resolve(deadCwd))
    assert.equal(r2.json.files.length, 1)
    assert.equal(r2.json.files[0].level, 'global')
  })

  test('cwd 校验：相对路径 → 400 invalid-cwd（逐字比对）', async () => {
    const r = await srv.request({
      path: '/ct/instructions.list',
      body: { cwd: 'relative/path' },
    })
    assert.equal(r.status, 400)
    assert.deepEqual(r.json, {
      ok: false,
      code: 'invalid-cwd',
      message: 'invalid cwd: must be an absolute path string',
    })
  })

  test('cwd 校验：缺失 / 非 string / 空串 → 400 invalid-cwd', async () => {
    for (const cwd of [undefined, null, 123, '', '   ']) {
      const r = await srv.request({ path: '/ct/instructions.list', body: cwd === undefined ? {} : { cwd } })
      assert.equal(r.status, 400, `cwd=${JSON.stringify(cwd)}`)
      assert.equal(r.json.code, 'invalid-cwd')
      assert.equal(r.json.message, 'invalid cwd: must be an absolute path string')
    }
  })
})
