// host RPC 端点 /ct/instructions.create — 新建项目级 AGENTS.md 契约测试（INTERFACE §1.5）
//
// 覆盖面：
//   a. 正常路径：合法 cwd + 项目根（.git 标记）+ 无 AGENTS.md → 创建成功，返回
//      {ok:true, path, content, mtimeMs}；content=模板全文；磁盘真实存在；再调 → path-exists
//   b. 边界：cwd 即项目根 / cwd 为子目录 / 项目根用 .git 文件（worktree 场景）
//   c. 错误路径：invalid-cwd(400) / no-project-root(200) / path-exists(200, 常规文件/目录/symlink)
//      / system-error（只读目录触发写失败）
//   d. 反向用例：create 不读客户端 path（多余字段忽略，仍按推导目标落盘）；文件不落项目根之外
//   e. 幂等/并发：连续两次唯一成功；Promise.all 并发同 cwd → 恰一 ok 一 path-exists
//   f. list 增补字段 projectRootFound / canCreateRootAgents 四种取值
//   g. create→save 衔接：以 create 返回的 mtimeMs 为基线 save 成功
//
// 驱动：ROUTER（真实 handler）经真实 HTTP 服务；不 import 内部模块。
// 模板 = INTERFACE §1.5 定死的 2 行模板，全文逐字比对。

import test from 'node:test'
import assert from 'node:assert/strict'
import { createHttpHarness } from './helpers/http.mjs'
import { ROUTER } from './helpers/contractHost.mjs'
import { buildTree } from './helpers/scenarios.mjs'
import { createTempDir, mkdirp, writeFile } from './helpers/fixture.mjs'
import {
  writeFileSync, readFileSync, existsSync, statSync, realpathSync,
  symlinkSync, mkdirSync, chmodSync, rmSync,
} from 'node:fs'
import { join, resolve } from 'node:path'

const TEMPLATE =
  '# 项目指令（AGENTS.md）\n\n<!-- 记录本项目的团队约定、编码规范、任务要求与常用命令。此文件会被 DSH 作为本项目的指令自动加载。 -->\n'

const method = (srv, cwd) => srv.request({ path: '/ct/instructions.create', body: { cwd } })
const list = (srv, cwd) => srv.request({ path: '/ct/instructions.list', body: { cwd } })

test.describe('POST /ct/instructions.create 新建项目级 AGENTS.md', () => {
  let srv, tree

  test.beforeEach(async () => {
    tree = buildTree()
    srv = await createHttpHarness((req, res) => ROUTER(req, res, { dshHome: tree.home }))
  })
  test.afterEach(async () => {
    await srv.stop()
    tree.cleanup()
  })

  const target = () => join(tree.project, 'AGENTS.md')

  // —— a. 正常路径 ——
  test('正常：cwd 有项目根且无 AGENTS.md → 创建成功，返回模板全文/content/path/mtimeMs', async () => {
    const cwd = tree.sub
    const r = await method(srv, cwd)
    assert.equal(r.status, 200)
    assert.equal(r.json.ok, true, JSON.stringify(r.json))
    assert.equal(r.json.path, target())
    assert.equal(r.json.content, TEMPLATE, 'content 必须是模板全文')
    assert.equal(typeof r.json.mtimeMs, 'number')
    // 文件真的落盘且内容即模板
    assert.equal(existsSync(target()), true, '磁盘应存在 AGENTS.md')
    assert.equal(readFileSync(target(), 'utf8'), TEMPLATE)
    // mtimeMs 是写后重新 stat 的值，可作为 save 基线
    assert.equal(r.json.mtimeMs, statSync(target()).mtimeMs)
  })

  test('正常：同一 cwd 再调一次 → path-exists（逐字），且不再覆盖', async () => {
    await method(srv, tree.sub)
    const r2 = await method(srv, tree.sub)
    assert.equal(r2.status, 200)
    assert.deepEqual(r2.json, {
      ok: false,
      code: 'path-exists',
      message: 'project-level AGENTS.md already exists; create refused to overwrite',
    })
    assert.equal(readFileSync(target(), 'utf8'), TEMPLATE, '二次调用不得改写内容')
  })

  // —— b. 边界 ——
  test('边界：cwd 即项目根 → 创建到项目根/AGENTS.md', async () => {
    const r = await method(srv, tree.project)
    assert.equal(r.json.ok, true)
    assert.equal(r.json.path, join(tree.project, 'AGENTS.md'))
    assert.equal(existsSync(join(tree.project, 'AGENTS.md')), true)
  })

  test('边界：cwd 是项目根的子目录（多层）→ 仍创建到项目根/AGENTS.md', async () => {
    // buildTree 已有 sub/nested；用最深层 nested 走完整父链
    const r = await method(srv, tree.nested)
    assert.equal(r.json.ok, true, JSON.stringify(r.json))
    assert.equal(r.json.path, join(tree.project, 'AGENTS.md'), '目标始终是项目根，不是 cwd')
  })

  test('边界：项目根用 .git 文件而非目录（worktree 场景）→ 创建成功', async () => {
    // 独立树：.git 是普通文件（git worktree 的 .git 文件指向主仓库 gitdir）
    const { root, path, cleanup } = createTempDir()
    try {
      mkdirp(path('proj', 'sub'))
      writeFileSync(path('proj', '.git'), 'gitdir: /real/main/.git\n', 'utf8') // .git 作为文件标记
      const cwd = path('proj', 'sub')
      const r = await method(srv, cwd)
      assert.equal(r.json.ok, true, JSON.stringify(r.json))
      assert.equal(r.json.path, path('proj', 'AGENTS.md'))
      assert.equal(existsSync(path('proj', 'AGENTS.md')), true)
    } finally {
      cleanup()
    }
  })

  // —— c. 错误路径 ——
  test('cwd 非法：非绝对路径 / 空串 → 400 invalid-cwd（逐字）', async () => {
    for (const cwd of ['relative/path', '', '   ', null, undefined, 123]) {
      const body = cwd === undefined ? {} : { cwd }
      const r = await srv.request({ path: '/ct/instructions.create', body })
      assert.equal(r.status, 400, `cwd=${JSON.stringify(cwd)}`)
      assert.deepEqual(r.json, {
        ok: false,
        code: 'invalid-cwd',
        message: 'invalid cwd: must be an absolute path string',
      })
    }
  })

  test('cwd 合法但无项目根（祖先链无 .git）→ 200 no-project-root（逐字），且不落盘', async () => {
    // 独立临时目录，其祖先链（temp 区）无 .git
    const { root, path, cleanup } = createTempDir()
    try {
      const cwd = path('somewhere', 'deeper') // 先确认无项目根
      const l = await list(srv, cwd)
      assert.equal(l.json.projectRootFound, false, '前置：该 cwd 无项目根')
      assert.equal(l.json.canCreateRootAgents, false)
      const r = await method(srv, cwd)
      assert.equal(r.status, 200)
      assert.deepEqual(r.json, {
        ok: false,
        code: 'no-project-root',
        message: 'no project root found for cwd: no .git marker on the path up to the fs root',
      })
      // 反向：无项目根处不得创建文件
      assert.equal(existsSync(path('somewhere', 'deeper', 'AGENTS.md')), false)
    } finally {
      cleanup()
    }
  })

  test('根 AGENTS.md 已存在 → 200 path-exists，且原文件内容不被改动', async () => {
    tree.write('AGENTS.md', '# existing project file')
    const r = await method(srv, tree.sub)
    assert.equal(r.status, 200)
    assert.equal(r.json.ok, false)
    assert.equal(r.json.code, 'path-exists')
    assert.equal(r.json.message, 'project-level AGENTS.md already exists; create refused to overwrite')
    assert.equal(readFileSync(target(), 'utf8'), '# existing project file', '已存在文件不得被覆盖')
  })

  test('根 AGENTS.md 被目录占用 → 200 path-exists', async () => {
    mkdirSync(join(tree.project, 'AGENTS.md'), { recursive: true }) // 目录占位
    const r = await method(srv, tree.sub)
    assert.equal(r.status, 200)
    assert.equal(r.json.ok, false)
    assert.equal(r.json.code, 'path-exists')
    assert.equal(r.json.message, 'project-level AGENTS.md already exists; create refused to overwrite')
  })

  test('根 AGENTS.md 是 symlink → 200 path-exists（绝不跟随链接写入）', async () => {
    // 指向项目外文件
    const outside = tree.path('outside', 'real.md')
    mkdirp(tree.path('outside'))
    writeFileSync(outside, 'real outside file', 'utf8')
    symlinkSync(outside, join(tree.project, 'AGENTS.md'), 'file')
    const r = await method(srv, tree.sub)
    assert.equal(r.status, 200)
    assert.equal(r.json.ok, false)
    assert.equal(r.json.code, 'path-exists', 'symlink 占用视为已存在')
    // 反向：symlink 指向的真实文件未被写、未被覆盖
    assert.equal(readFileSync(outside, 'utf8'), 'real outside file', 'symlink 目标不得被改写')
  })

  test('写失败 → 200 system-error（只读项目目录触发 EACCES）', async (t) => {
    // 跳过 root：root 无视目录权限位，读/写都成功，无法触发 EACCES
    if (process.getuid && process.getuid() === 0) {
      t.skip('root 下只读目录不生效，跳过 system-error 分支')
      return
    }
    tree.write('sub/.keep', '')
    chmodSync(tree.project, 0o555) // r-x：可发现可 realpath，但不可在其中建文件
    try {
      const r = await method(srv, tree.sub)
      assert.equal(r.status, 200)
      assert.equal(r.json.ok, false)
      assert.equal(r.json.code, 'system-error', JSON.stringify(r.json))
      assert.equal(typeof r.json.message, 'string', 'message 应为 String(err)')
      // 反向：写失败则文件不存在
      assert.equal(existsSync(target()), false)
    } finally {
      chmodSync(tree.project, 0o755)
    }
  })

  // —— d. 反向用例 ——
  test('反向：create 不接受客户端 path（body 带 path 被忽略，仍按推导目标落盘）', async () => {
    const evil = tree.path('evil', 'AGENTS.md')
    const r = await srv.request({
      path: '/ct/instructions.create',
      body: { cwd: tree.sub, path: evil, something: 42 },
    })
    assert.equal(r.status, 200)
    assert.equal(r.json.ok, true)
    assert.equal(r.json.path, target(), '目标路径必须由 host 按 projectRoot 推导')
    assert.equal(existsSync(target()), true, '应创建在推导出的项目根目标')
    // 反向：客户端传入的 path 不得被创建
    assert.equal(existsSync(evil), false, '客户端任意 path 不得落盘')
  })

  test('反向：cwd 经符号链接目录抵达项目，文件仍落在真实物理项目根内（realpath 校验）', async () => {
    // 真实项目（含 .git）在 realDir 下；alias 是指向它的符号链接目录。
    // cwd 走 alias，模拟"字符路径在范围内但物理位置需 realpath 解开"的场景。
    const { root, path, cleanup } = createTempDir()
    try {
      mkdirp(path('realDir', 'project', 'sub'))
      writeFileSync(path('realDir', 'project', '.git'), '', 'utf8') // 物理项目根标记
      symlinkSync(path('realDir', 'project'), path('alias'))
      const cwdLexical = path('alias', 'sub')
      const r = await method(srv, cwdLexical)
      assert.equal(r.json.ok, true, JSON.stringify(r.json))
      const createdReal = realpathSync(r.json.path)
      const realRoot = realpathSync(path('realDir', 'project'))
      // realpath 校验：创建文件必须物理落在真项目根内
      assert.ok(createdReal.startsWith(realRoot + '/'), `created=${createdReal} realRoot=${realRoot}`)
      assert.equal(createdReal, join(realRoot, 'AGENTS.md'))
      // 反向：目标必须是真实物理目录（realpath 后）内的 AGENTS.md，
      // 因为 alias 与 realDir 指向同一物理项目，词法位置 alias/AGENTS.md 经
      // symlink 也解析到同一物理文件——物理落盘位置已由 realRoot 断言覆盖。
      // 这里补一个防御：真实项目根下确实落盘了模板内容。
      assert.equal(readFileSync(join(realRoot, 'AGENTS.md'), 'utf8'), TEMPLATE)
    } finally {
      cleanup()
    }
  })

  test('反向：成功后模板未被追加/污染额外内容（磁盘逐字 = 模板）', async () => {
    await method(srv, tree.sub)
    assert.equal(readFileSync(target(), 'utf8'), TEMPLATE)
    const st = statSync(target())
    assert.equal(st.size, Buffer.byteLength(TEMPLATE, 'utf8'), '文件字节数应恰为模板，无额外内容')
  })

  // —— e. 幂等 / 并发 ——
  test('幂等：同 cwd 连续两次 create → 第一次 ok、第二次 path-exists', async () => {
    const r1 = await method(srv, tree.sub)
    const r2 = await method(srv, tree.sub)
    assert.equal(r1.json.ok, true)
    assert.equal(r2.json.code, 'path-exists')
    assert.equal(r2.json.ok, false)
  })

  test('并发：两个 create 并发同一 cwd → 恰一 ok 一 path-exists，无覆盖', async () => {
    const [r1, r2] = await Promise.all([method(srv, tree.sub), method(srv, tree.sub)])
    const outcomes = [r1.json, r2.json]
    const oks = outcomes.filter((o) => o.ok === true)
    const exists = outcomes.filter((o) => o.code === 'path-exists')
    assert.equal(oks.length, 1, `应恰好一个 ok，实际=${outcomes.map((o) => JSON.stringify(o))}`)
    assert.equal(exists.length, 1)
    // 并发下不被追逐写入：落盘内容仍是完整模板
    assert.equal(readFileSync(target(), 'utf8'), TEMPLATE)
  })

  // —— f. list 增补字段 ——
  test('list 增补：有项目根且无 AGENTS.md → projectRootFound=true, canCreateRootAgents=true', async () => {
    const r = await list(srv, tree.sub)
    assert.equal(r.json.projectRootFound, true)
    assert.equal(r.json.canCreateRootAgents, true)
    assert.equal(r.json.projectRoot, tree.project)
    // files 里此刻没有根 AGENTS.md
    assert.equal(r.json.files.some((f) => f.path === target()), false)
  })

  test('list 增补：无项目根 → projectRootFound=false, canCreateRootAgents=false', async () => {
    const { root, path, cleanup } = createTempDir()
    try {
      const l = await list(srv, path('nowhere'))
      assert.equal(l.json.projectRootFound, false)
      assert.equal(l.json.canCreateRootAgents, false)
    } finally {
      cleanup()
    }
  })

  test('list 增补：有项目根且根 AGENTS.md 已存在 → true/false', async () => {
    tree.write('AGENTS.md', '# exists')
    const r = await list(srv, tree.sub)
    assert.equal(r.json.projectRootFound, true)
    assert.equal(r.json.canCreateRootAgents, false)
  })

  test('list 增补：根 AGENTS.md 是 symlink → projectRootFound=true, canCreateRootAgents=false', async () => {
    const outside = tree.path('outside', 'real.md')
    mkdirp(tree.path('outside'))
    writeFileSync(outside, 'real', 'utf8')
    symlinkSync(outside, join(tree.project, 'AGENTS.md'), 'file')
    const r = await list(srv, tree.sub)
    assert.equal(r.json.projectRootFound, true)
    assert.equal(r.json.canCreateRootAgents, false, 'symlink 占用视为已存在，无新建入口')
  })

  // —— g. create → save 衔接 ——
  test('衔接：create 返回的 mtimeMs 作 save 基线修改内容 → save 成功', async () => {
    const c = await method(srv, tree.sub)
    assert.equal(c.json.ok, true)
    const p = c.json.path
    const r = await srv.request({
      path: '/ct/instructions.save',
      body: {
        cwd: tree.sub,
        path: p,
        content: '# 项目指令（AGENTS.md）\n\n追加的团队约定\n',
        expectedMtimeMs: c.json.mtimeMs,
      },
    })
    assert.equal(r.status, 200)
    assert.equal(r.json.ok, true, JSON.stringify(r.json))
    assert.equal(r.json.code, undefined, 'create 产物应可直接进入现有 save 编辑流')
    assert.equal(readFileSync(p, 'utf8'), '# 项目指令（AGENTS.md）\n\n追加的团队约定\n')
  })

  test('衔接：create 后若外部改文件再 save → mtime 乐观锁照常拦截', async () => {
    const c = await method(srv, tree.sub)
    await new Promise((r) => setTimeout(r, 20))
    writeFileSync(c.json.path, 'external overwrite', 'utf8')
    const r = await srv.request({
      path: '/ct/instructions.save',
      body: { cwd: tree.sub, path: c.json.path, content: 'x', expectedMtimeMs: c.json.mtimeMs },
    })
    assert.equal(r.status, 200)
    assert.equal(r.json.ok, false)
    assert.equal(r.json.code, 'mtime-conflict')
    assert.equal(readFileSync(c.json.path, 'utf8'), 'external overwrite', '冲突时不写入')
  })
})
