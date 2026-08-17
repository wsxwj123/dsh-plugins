// host RPC 增量 2 契约测试：/ct/instructions.create scope='global'（INTERFACE §1.5）
// + /ct/instructions.delete（INTERFACE §1.6）+ list 增补 canCreateGlobalAgents（§1.1）
// + instructionViewReducer 状态机（§2.6）。
//
// 覆盖面：
//   A. create scope='global'：正常建到 dshHome/AGENTS.md（全局模板全文）；scope 非法→invalid-scope；
//      dshHome/AGENTS.md 已存在→global path-exists（逐字）；scope 缺省→等同 project（建到项目根）。
//   B. delete：正常删项目级/全局；path basename 非法→invalid-path(400)；不在发现集合→path-out-of-scope；
//      path 是 symlink→path-out-of-scope；父目录链 symlink 越界→path-out-of-scope；文件不存在→
//      file-not-found（并发窗口）；并发双删同一 path→恰一 ok 一 file-not-found。
//   C. list 增补 canCreateGlobalAgents：dshHome 无 AGENTS.md→true；有→false；symlink 占用→false；
//      dshHome 不可解析（realpath 失败）→false。
//   D. instructionViewReducer：按 §2.6 9 事件主路径，纯函数不改入参。
//
// 驱动：create/delete/list 走 ROUTER（真实 handler 经真实 HTTP）；reducer 因增量 2 尚未实现、
//      且 contractClient 未导出该符号，本文件内置 §2.6 参考 reducer（文件头标明，实现落地后换接 seam）。
//
// TDD 状态：create global / delete / list 增补字段走真实 ROUTER——增量 2 未实现，预期对现有
//       router 全红（返回 404 等）；reducer 驱动的是本文件内置参考（绿）。均需能加载、能跑。

import test from 'node:test'
import assert from 'node:assert/strict'
import { createHttpHarness } from './helpers/http.mjs'
import { ROUTER } from './helpers/contractHost.mjs'
import { buildTree } from './helpers/scenarios.mjs'
import { createTempDir, mkdirp } from './helpers/fixture.mjs'
import {
  writeFileSync, readFileSync, existsSync, statSync,
  symlinkSync, mkdirSync, lstatSync,
} from 'node:fs'
import { join } from 'node:path'

const PROJECT_TEMPLATE =
  '# 项目指令（AGENTS.md）\n\n<!-- 记录本项目的团队约定、编码规范、任务要求与常用命令。此文件会被 DSH 作为本项目的指令自动加载。 -->\n'
const GLOBAL_TEMPLATE =
  '# 全局指令（AGENTS.md）\n\n<!-- 记录所有会话通用的全局约定、编码规范与常用命令。此文件会被 DSH 作为全局指令自动加载。 -->\n'

const create = (srv, body) => srv.request({ path: '/ct/instructions.create', body })
const del = (srv, body) => srv.request({ path: '/ct/instructions.delete', body })
const list = (srv, cwd) => srv.request({ path: '/ct/instructions.list', body: { cwd } })

// 以 buildTree 的假 dshHome 起服务器；home = 假 dshHome 目录。
function boot(tree) {
  return createHttpHarness((req, res) => ROUTER(req, res, { dshHome: tree.home }))
}

// ---------------------------------------------------------------------------
// A. create scope='global'
// ---------------------------------------------------------------------------
test.describe('POST /ct/instructions.create scope=global（§1.5）', () => {
  let srv, tree

  test.beforeEach(async () => {
    tree = buildTree()
    srv = await boot(tree)
  })
  test.afterEach(async () => {
    await srv.stop()
    tree.cleanup()
  })

  const globalTarget = () => join(tree.home, 'AGENTS.md')

  test('A1 正常：dshHome 无 AGENTS.md → 创建到 dshHome/AGENTS.md，返回 {ok,path,content,mtimeMs}，content=全局模板全文', async () => {
    const r = await create(srv, { cwd: tree.sub, scope: 'global' })
    assert.equal(r.status, 200, JSON.stringify(r.json))
    assert.equal(r.json.ok, true, JSON.stringify(r.json))
    assert.equal(r.json.path, globalTarget(), '目标 = realpath(dshHome)/AGENTS.md')
    assert.equal(r.json.content, GLOBAL_TEMPLATE, 'content 必须是全局模板全文，与 project 模板不同')
    assert.equal(typeof r.json.mtimeMs, 'number')
    // 落盘在 dshHome（假 home）内，且内容即全局模板
    assert.equal(existsSync(globalTarget()), true, '磁盘应存在 dshHome/AGENTS.md')
    assert.equal(readFileSync(globalTarget(), 'utf8'), GLOBAL_TEMPLATE)
    assert.equal(r.json.mtimeMs, statSync(globalTarget()).mtimeMs, 'mtimeMs 可作 save 基线')
    // 反向：全局创建不落项目根
    assert.equal(existsSync(join(tree.project, 'AGENTS.md')), false, '全局创建不得落项目根')
  })

  test('A2 正常且幂等：同目标再调用 → 200 path-exists（global 逐字文案），不覆盖', async () => {
    await create(srv, { cwd: tree.sub, scope: 'global' })
    const r2 = await create(srv, { cwd: tree.sub, scope: 'global' })
    assert.equal(r2.status, 200)
    assert.deepEqual(r2.json, {
      ok: false,
      code: 'path-exists',
      message: 'global AGENTS.md already exists; create refused to overwrite',
    })
    assert.equal(readFileSync(globalTarget(), 'utf8'), GLOBAL_TEMPLATE, '二次不得改写')
  })

  test('A3 非法 scope（xxx）→ 400 invalid-scope（逐字）', async () => {
    for (const scope of ['xxx', '', 'PROJECT', null, 1, true, []]) {
      const r = await create(srv, { cwd: tree.sub, scope })
      assert.equal(r.status, 400, `scope=${JSON.stringify(scope)}`)
      assert.deepEqual(r.json, {
        ok: false,
        code: 'invalid-scope',
        message: 'invalid scope: must be "project" or "global"',
      })
    }
  })

  test('A4 scope 缺省 → 行为等同 project（创建到项目根，不落 dshHome）', async () => {
    const r = await create(srv, { cwd: tree.sub }) // 无 scope
    assert.equal(r.status, 200)
    assert.equal(r.json.ok, true, JSON.stringify(r.json))
    assert.equal(r.json.path, join(tree.project, 'AGENTS.md'), '缺省=project 目标项目根')
    assert.equal(r.json.content, PROJECT_TEMPLATE, '缺省=project 模板')
    assert.equal(existsSync(join(tree.project, 'AGENTS.md')), true)
    assert.equal(existsSync(globalTarget()), false, '缺省不落 dshHome')
  })

  test('A5 边界：dshHome 已存在 AGENTS.md → 200 path-exists（global 逐字），原文件不动', async () => {
    writeFileSync(globalTarget(), '# existing global', 'utf8')
    const r = await create(srv, { cwd: tree.sub, scope: 'global' })
    assert.equal(r.status, 200)
    assert.equal(r.json.ok, false)
    assert.equal(r.json.code, 'path-exists')
    assert.equal(r.json.message, 'global AGENTS.md already exists; create refused to overwrite')
    assert.equal(readFileSync(globalTarget(), 'utf8'), '# existing global', '已存在全局文件不得被覆盖')
  })

  test('A6 边界：dshHome/AGENTS.md 被 symlink 占用 → 200 path-exists（global），绝不跟随链接写', async () => {
    const outside = tree.path('outside-home', 'real.md')
    mkdirp(tree.path('outside-home'))
    writeFileSync(outside, 'outside real', 'utf8')
    symlinkSync(outside, globalTarget(), 'file')
    const r = await create(srv, { cwd: tree.sub, scope: 'global' })
    assert.equal(r.status, 200)
    assert.equal(r.json.code, 'path-exists', 'symlink 占用全局入口视为已存在')
    assert.equal(readFileSync(outside, 'utf8'), 'outside real', 'symlink 目标不得被改写')
  })

  test('A7 边界：全局创建不依赖项目根有无 .git（无项目根 cwd 也能建全局）', async () => {
    const { path, cleanup } = createTempDir()
    try {
      const cwd = path('nowhere', 'deep') // 祖先链无 .git
      const r = await create(srv, { cwd, scope: 'global' })
      assert.equal(r.status, 200)
      assert.equal(r.json.ok, true, JSON.stringify(r.json))
      assert.equal(r.json.path, globalTarget())
      assert.equal(existsSync(globalTarget()), true)
    } finally {
      cleanup()
    }
  })

  test('A8 反向：create 不接受客户端 path（body 带越界 path 被忽略），全局目标由 host 推导', async () => {
    const evil = tree.path('evil', 'AGENTS.md')
    const r = await create(srv, { cwd: tree.sub, scope: 'global', path: evil, extra: 1 })
    assert.equal(r.json.ok, true)
    assert.equal(r.json.path, globalTarget())
    assert.equal(existsSync(globalTarget()), true)
    assert.equal(existsSync(evil), false, '客户端任意 path 不得落盘')
  })
})

// ---------------------------------------------------------------------------
// B. /ct/instructions.delete（§1.6）
// ---------------------------------------------------------------------------
test.describe('POST /ct/instructions.delete（§1.6）', () => {
  let srv, tree

  test.beforeEach(async () => {
    tree = buildTree()
    srv = await boot(tree)
  })
  test.afterEach(async () => {
    await srv.stop()
    tree.cleanup()
  })

  // 项目级正常删除：直接把文件写到发现集合（create 红，用磁盘落位代替 create→delete 衔接），再删。
  test('B1 正常：删项目级已发现文件 → ok:true，文件从磁盘消失', async () => {
    tree.write('AGENTS.md', PROJECT_TEMPLATE)
    const p = join(tree.project, 'AGENTS.md')
    const l = await list(srv, tree.sub)
    assert.ok(l.json.files.some((f) => f.path === p), '前置：需先在发现集合')
    const r = await del(srv, { cwd: tree.sub, path: p })
    assert.equal(r.status, 200)
    assert.equal(r.json.ok, true, JSON.stringify(r.json))
    assert.equal(existsSync(p), false, '删除后文件应消失')
  })

  test('B2 正常：删全局文件 → ok:true，dshHome/AGENTS.md 消失', async () => {
    writeFileSync(join(tree.home, 'AGENTS.md'), GLOBAL_TEMPLATE, 'utf8')
    const p = join(tree.home, 'AGENTS.md')
    const r = await del(srv, { cwd: tree.sub, path: p })
    assert.equal(r.status, 200)
    assert.equal(r.json.ok, true, JSON.stringify(r.json))
    assert.equal(existsSync(p), false, '全局文件应被删')
  })

  test('B3 path basename 非法 → 400 invalid-path（逐字）', async () => {
    for (const p of [
      '/tmp/x/FOO.md',
      '/tmp/x/README.md',
      join(tree.project, 'AGENTS'),
      null, undefined, 42, '', 'relative/AGENTS.md',
    ]) {
      const body = p === undefined ? { cwd: tree.sub } : { cwd: tree.sub, path: p }
      const r = await del(srv, body)
      assert.equal(r.status, 400, `path=${JSON.stringify(p)}`)
      assert.deepEqual(r.json, {
        ok: false,
        code: 'invalid-path',
        message: 'invalid path: must be an absolute path to AGENTS.md / CLAUDE.md / AGENTS.local.md / CLAUDE.local.md',
      })
    }
  })

  test('B4 path 不在发现集合 → 200 path-out-of-scope，磁盘不动', async () => {
    // project/other/AGENTS.md 真实存在，但 cwd=sub 的发现链只走 project→sub，不含 other
    const outside = tree.write('other/AGENTS.md', 'outside scope')
    const r = await del(srv, { cwd: tree.sub, path: outside })
    assert.equal(r.status, 200)
    assert.equal(r.json.ok, false)
    assert.equal(r.json.code, 'path-out-of-scope')
    assert.equal(r.json.message, 'path is not among the instruction files discovered for cwd')
    assert.equal(readFileSync(outside, 'utf8'), 'outside scope', '集合外文件不得被删')
  })

  test('B5 path 是 symlink → 200 path-out-of-scope（发现拒收 symlink，成员闸门拦截）', async () => {
    const real = tree.path('out-of-project', 'real.md')
    mkdirp(tree.path('out-of-project'))
    writeFileSync(real, 'link target', 'utf8')
    tree.write('.keep', '')
    symlinkSync(real, join(tree.sub, 'AGENTS.md'), 'file')
    const p = join(tree.sub, 'AGENTS.md')
    const r = await del(srv, { cwd: tree.sub, path: p })
    assert.equal(r.status, 200)
    assert.equal(r.json.code, 'path-out-of-scope', JSON.stringify(r.json))
    assert.equal(r.json.ok, false)
    assert.ok(lstatSync(p).isSymbolicLink(), 'symlink 本身不得被删')
    assert.equal(readFileSync(real, 'utf8'), 'link target', 'symlink 目标不得被删')
  })

  test('B6 父目录链 symlink 越界 → 200 path-out-of-scope（物理位置暴露拒绝），真实文件不删', async () => {
    // tmp/A/.git 标记项目根；tmp/A/lnk 是指向 tmp/B（无 .git）的目录 symlink；
    // 文件 tmp/B/deep/AGENTS.md 真实存在，经词法路径 tmp/A/lnk/deep/AGENTS.md 被发现。
    // delete 的父目录 realpath=realpath(tmp/A/lnk/deep)=tmp/B/deep，不在 realpath(projectRoot)=tmp/A
    // 前缀下 → path-out-of-scope，绝不物理删 tmp/B/deep/AGENTS.md。
    const { path, cleanup } = createTempDir()
    try {
      mkdirSync(path('A', '.git'), { recursive: true }) // A 有 .git 标记
      mkdirSync(path('B', 'deep'), { recursive: true }) // B 无 .git
      writeFileSync(path('B', 'deep', 'AGENTS.md'), 'real file in B', 'utf8')
      symlinkSync(path('B'), path('A', 'lnk'), 'dir')
      const cwd = path('A', 'lnk', 'deep')
      const p = path('A', 'lnk', 'deep', 'AGENTS.md')
      // 前置确认：该文件确实被发现（词法上属于集合成员）
      const l = await list(srv, cwd)
      assert.ok(l.json.files.some((f) => f.path === p), '前置：词法路径应被发现')
      const r = await del(srv, { cwd, path: p })
      assert.equal(r.status, 200)
      assert.equal(r.json.ok, false)
      assert.equal(r.json.code, 'path-out-of-scope', JSON.stringify(r.json))
      // 真实物理文件必须完好
      assert.equal(readFileSync(path('B', 'deep', 'AGENTS.md'), 'utf8'), 'real file in B', '越界真实文件不得被删')
      assert.equal(existsSync(path('B', 'deep', 'AGENTS.md')), true)
    } finally {
      cleanup()
    }
  })

  test('B7 path 目标在删除发生时已不存在 → 200 file-not-found（并发窗口卸载映射）', async () => {
    // 并发同 path 双删：一个 ok 移除，另一个 unlink 时 ENOENT → 映射 file-not-found。
    // file-not-found 属"发现后、删除前文件消失"的竞态分支（TEST-PLAN 已说明单靠顺序调用
    // 命中的是 path-out-of-scope），这里用并发双删按契约语义锚定它。
    tree.write('AGENTS.md', PROJECT_TEMPLATE)
    const p = join(tree.project, 'AGENTS.md')
    const [r1, r2] = await Promise.all([del(srv, { cwd: tree.sub, path: p }), del(srv, { cwd: tree.sub, path: p })])
    const ok = [r1, r2].filter((r) => r.json.ok === true)
    const nf = [r1, r2].filter((r) => r.json.code === 'file-not-found')
    assert.equal(ok.length, 1, `应恰一 ok，实际=${[r1.json, r2.json].map((j) => JSON.stringify(j))}`)
    assert.equal(nf.length, 1, '恰一个返回 file-not-found')
    assert.equal(existsSync(p), false, '删除后文件消失，不重建')
  })

  test('B8 并发双删同一 path → 恰一 ok 一 file-not-found，永不双删', async () => {
    tree.write('AGENTS.md', PROJECT_TEMPLATE)
    const p = join(tree.project, 'AGENTS.md')
    const [r1, r2] = await Promise.all([del(srv, { cwd: tree.sub, path: p }), del(srv, { cwd: tree.sub, path: p })])
    const outcomes = [r1.json, r2.json]
    const ok = outcomes.filter((o) => o.ok === true)
    const nf = outcomes.filter((o) => o.code === 'file-not-found')
    assert.equal(ok.length, 1, `应恰一 ok，实际=${outcomes.map((o) => JSON.stringify(o))}`)
    assert.equal(nf.length, 1, '恰一个返回 file-not-found')
    assert.equal(existsSync(p), false, '双删后文件消失，不重建')
  })

  test('B9 反向：并发删不同 path → 各自独立 ok，互不影响', async () => {
    tree.write('AGENTS.md', 'a')
    tree.write('CLAUDE.md', 'b')
    const p1 = join(tree.project, 'AGENTS.md')
    const p2 = join(tree.project, 'CLAUDE.md')
    const [r1, r2] = await Promise.all([
      del(srv, { cwd: tree.project, path: p1 }),
      del(srv, { cwd: tree.project, path: p2 }),
    ])
    assert.equal(r1.json.ok, true, JSON.stringify(r1.json))
    assert.equal(r2.json.ok, true, JSON.stringify(r2.json))
    assert.equal(existsSync(p1), false)
    assert.equal(existsSync(p2), false)
  })

  test('B10 边界：cwd 无项目根时删全局文件仍可 → ok:true（全局不依赖 .git）', async () => {
    const { path, cleanup } = createTempDir()
    try {
      writeFileSync(join(tree.home, 'AGENTS.md'), GLOBAL_TEMPLATE, 'utf8')
      const cwd = path('nowhere')
      const r = await del(srv, { cwd, path: join(tree.home, 'AGENTS.md') })
      assert.equal(r.json.ok, true, JSON.stringify(r.json))
      assert.equal(existsSync(join(tree.home, 'AGENTS.md')), false)
    } finally {
      cleanup()
    }
  })
})

// ---------------------------------------------------------------------------
// C. list 增补 canCreateGlobalAgents（§1.1 增量 2 新增）
// ---------------------------------------------------------------------------
test.describe('list 增补字段 canCreateGlobalAgents（§1.1）', () => {
  let srv, tree
  test.beforeEach(async () => {
    tree = buildTree()
    srv = await boot(tree)
  })
  test.afterEach(async () => {
    await srv.stop()
    tree.cleanup()
  })

  test('C1 dshHome 无 AGENTS.md → canCreateGlobalAgents=true', async () => {
    const r = await list(srv, tree.sub)
    assert.equal(r.json.ok, true)
    assert.equal(r.json.canCreateGlobalAgents, true)
    assert.equal(r.json.dshHome, tree.home)
  })

  test('C2 dshHome 有 AGENTS.md → canCreateGlobalAgents=false', async () => {
    writeFileSync(join(tree.home, 'AGENTS.md'), GLOBAL_TEMPLATE, 'utf8')
    const r = await list(srv, tree.sub)
    assert.equal(r.json.canCreateGlobalAgents, false)
  })

  test('C3 dshHome/AGENTS.md 是 symlink → false（占用视为已存在）', async () => {
    const real = tree.path('g-sym', 'real.md')
    mkdirp(tree.path('g-sym'))
    writeFileSync(real, 'g', 'utf8')
    symlinkSync(real, join(tree.home, 'AGENTS.md'), 'file')
    const r = await list(srv, tree.sub)
    assert.equal(r.json.canCreateGlobalAgents, false)
  })

  test('C4 dshHome 不可解析（realpath 失败）→ false', async () => {
    // 独立 server，dshHome 指向不存在的目录
    const srv2 = await createHttpHarness((req, res) =>
      ROUTER(req, res, { dshHome: join(tree.path('missing-home'), '.dsh') }),
    )
    try {
      const r = await list(srv2, tree.sub)
      assert.equal(r.json.ok, true)
      assert.equal(r.json.canCreateGlobalAgents, false, 'realpath 失败按不可新建')
    } finally {
      await srv2.stop()
    }
  })

  test('C5 全局入口与项目根 .git 无关：无项目根 cwd 时 canCreateGlobalAgents 仍据 dshHome', async () => {
    const { path, cleanup } = createTempDir()
    try {
      const r = await list(srv, path('nowhere'))
      assert.equal(r.json.projectRootFound, false)
      assert.equal(r.json.canCreateGlobalAgents, true, '可新建全局与项目根 .git 无关')
    } finally {
      cleanup()
    }
  })
})

// ---------------------------------------------------------------------------
// D. instructionViewReducer 状态机（§2.6）
// ---------------------------------------------------------------------------
// 注：增量 2 的 reducer 尚未实现，contractClient 也未 re-export 该符号。为让本文件能加载跑通，
// 此处内置 §2.6 契约的参考 reducer（逐条按判定规则照抄，非实现）。实现落地后把下方 import seam
// 换成 `import { instructionViewReducer } from './helpers/contractClient.mjs'` 即可黑盒驱动真实代码。
function referenceReducer(view, event) {
  switch (event.type) {
    case 'open-list':
      return { kind: 'list' }
    case 'start-create':
      if (view.kind === 'create' && view.scope === event.scope) return view // 防重复点击
      return { kind: 'create', scope: event.scope, pending: true }
    case 'create-pending':
      if (view.kind === 'create') return { ...view, pending: true }
      return view
    case 'create-succeeded':
      if (view.kind === 'create') return { kind: 'create', scope: view.scope, pending: false, path: event.path }
      return view
    case 'create-failed':
      return { kind: 'list' }
    case 'open-edit':
      return { kind: 'edit', path: event.path, dirty: false }
    case 'mark-dirty':
      if (view.kind === 'edit' || (view.kind === 'create' && view.pending === false && view.path !== undefined)) {
        return { ...view, dirty: true }
      }
      return view
    case 'saved':
      if ((view.kind === 'edit' || view.kind === 'create') && view.path === event.path) return { kind: 'list' }
      return view
    case 'cancel-edit':
      return { kind: 'list' }
    default:
      return view
  }
}

test.describe('instructionViewReducer 状态机（§2.6，参考 reducer）', () => {
  // 参考 reducer 主路径：一条完整往返 list → 全局新建 → 编辑 → 保存回 list
  test('D1 主流程：list → start-create(global) → create-pending → create-succeeded → mark-dirty → saved → list', () => {
    let v = referenceReducer({ kind: 'list' }, { type: 'open-list' })
    assert.deepEqual(v, { kind: 'list' })

    v = referenceReducer(v, { type: 'start-create', scope: 'global' })
    assert.deepEqual(v, { kind: 'create', scope: 'global', pending: true })

    v = referenceReducer(v, { type: 'create-pending' })
    assert.equal(v.pending, true)

    v = referenceReducer(v, { type: 'create-succeeded', path: '/home/AGENTS.md' })
    assert.deepEqual(v, { kind: 'create', scope: 'global', pending: false, path: '/home/AGENTS.md' })
    assert.equal(v.dirty, undefined, '创建成功未保存前 dirty 不置位')

    v = referenceReducer(v, { type: 'mark-dirty' })
    assert.equal(v.dirty, true)

    v = referenceReducer(v, { type: 'saved', path: '/home/AGENTS.md' })
    assert.deepEqual(v, { kind: 'list' })
  })

  test('D2 主流程：open-edit → mark-dirty → cancel-edit（drop）回 list', () => {
    let v = referenceReducer({ kind: 'list' }, { type: 'open-edit', path: '/p/AGENTS.md' })
    assert.deepEqual(v, { kind: 'edit', path: '/p/AGENTS.md', dirty: false })
    v = referenceReducer(v, { type: 'mark-dirty' })
    assert.deepEqual(v, { kind: 'edit', path: '/p/AGENTS.md', dirty: true })
    v = referenceReducer(v, { type: 'cancel-edit' })
    assert.deepEqual(v, { kind: 'list' })
  })

  test('D3 start-create 重复同 scope → 原样返回；换 scope → 生成新的 create 态', () => {
    const orig = { kind: 'create', scope: 'project', pending: true }
    const again = referenceReducer(orig, { type: 'start-create', scope: 'project' })
    assert.strictEqual(again, orig, '同 scope 防重复点击：原样返回同一引用')
    const v2 = referenceReducer(orig, { type: 'start-create', scope: 'global' })
    assert.deepEqual(v2, { kind: 'create', scope: 'global', pending: true })
  })

  test('D4 create-failed → 回 list', () => {
    const v = referenceReducer({ kind: 'create', scope: 'global', pending: true }, { type: 'create-failed' })
    assert.deepEqual(v, { kind: 'list' })
  })

  test('D5 saved 匹配当前编辑目标 → list；不匹配 → 保持原状', () => {
    const edit = { kind: 'edit', path: '/a/AGENTS.md', dirty: true }
    assert.deepEqual(referenceReducer(edit, { type: 'saved', path: '/a/AGENTS.md' }), { kind: 'list' })
    assert.deepEqual(referenceReducer(edit, { type: 'saved', path: '/other/AGENTS.md' }), edit)
  })

  test('D6 mark-dirty：list / 无 path 的 create 不置位', () => {
    assert.deepEqual(referenceReducer({ kind: 'list' }, { type: 'mark-dirty' }), { kind: 'list' })
    assert.deepEqual(referenceReducer({ kind: 'create', scope: 'global', pending: true }, { type: 'mark-dirty' }), {
      kind: 'create', scope: 'global', pending: true,
    })
  })

  test('D7 open-list：任何状态都回 list', () => {
    assert.deepEqual(referenceReducer({ kind: 'edit', path: '/x', dirty: true }, { type: 'open-list' }), { kind: 'list' })
    assert.deepEqual(referenceReducer({ kind: 'edit', path: '/x', dirty: true }, { type: 'open-list' }), { kind: 'list' })
    assert.deepEqual(referenceReducer({ kind: 'create', scope: 'global', pending: false, path: '/x' }, { type: 'open-list' }), { kind: 'list' })
  })

  test('D8 纯函数：不改入参（返回新对象）', () => {
    const before = { kind: 'create', scope: 'global', pending: true }
    const out = referenceReducer(before, { type: 'open-edit', path: '/p/AGENTS.md' })
    assert.deepEqual(out, { kind: 'edit', path: '/p/AGENTS.md', dirty: false })
    assert.notStrictEqual(out, before, '应返回新状态对象')
    assert.deepEqual(before, { kind: 'create', scope: 'global', pending: true }, '入参不被修改')
  })
})
