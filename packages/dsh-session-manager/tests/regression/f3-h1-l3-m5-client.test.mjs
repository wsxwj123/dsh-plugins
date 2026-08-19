/**
 * F3 (致命) + H1 (高) + L3 / M5(双页) — client 层。
 *
 * 这一层没有浏览器：本包没装 node_modules（react/react-dom 都不可用），
 * DeleteButton 需要真实 DOM（querySelectorAll(':scope …')、dataset、innerHTML），
 * ArchiveView 需要 react hooks。所以这些条目用**源码结构断言**复现，
 * 与既有 tests/unit/delete-controller-dispose.unit.test.js 的做法一致；
 * 真实交互留给 04 之后的 playwright（见 FIX-TEST-PLAN.md 的接线说明）。
 */
import { test } from 'node:test'
import assert from 'node:assert'
import { readPkgFile, loadSrc } from './_harness.mjs'

const archiveView = readPkgFile('src/client/ArchiveView.tsx')
const deleteButton = readPkgFile('src/client/DeleteButton.tsx')
const clientIndex = readPkgFile('src/client/index.tsx')
const pendingDeletesSrc = readPkgFile('src/client/pendingDeletes.ts')
const undoRail = readPkgFile('src/client/UndoRail.tsx')
const bridgeSrc = readPkgFile('src/client/bridge.ts')
const handlerSrc = readPkgFile('src/handler.ts')
const indexSrc = readPkgFile('src/index.ts')
const readme = readPkgFile('README.md')

/** 所有会调用 bridge 的 client 模块（bridge.ts 自身是定义处，不算调用点）。 */
const CALLERS = { archiveView, deleteButton, clientIndex, pendingDeletesSrc, undoRail }

// ---- F3：回收站只进不出 ----

test('F3: smRestore 必须至少有一个 UI 调用点（当前全仓只有定义处）', () => {
  const callers = Object.entries(CALLERS)
    .filter(([, src]) => /smRestore\s*\(/.test(src))
    .map(([name]) => name)
  assert.ok(
    callers.length > 0,
    '5 秒撤销窗口过后界面上没有任何恢复入口，删错只能手工搬 ~/.dsh/session-manager-trash（INTERFACE §2.4 不允许中间态无恢复入口）',
  )
})

test('F3: 归档视图必须渲染「恢复」控件并接到 smRestore', () => {
  assert.ok(/恢复/.test(archiveView), '归档视图里必须有「恢复」按钮文案')
  assert.ok(/smRestore/.test(archiveView), '「恢复」必须真的调用 smRestore(id)')
})

test('F3-相邻: bridge.smRestore 仍然 POST /sm/restore 且只带 id', async () => {
  const original = globalThis.fetch
  const calls = []
  try {
    globalThis.fetch = async (input, init) => {
      calls.push({ input, init })
      return { ok: true, status: 200, json: async () => ({ ok: true }) }
    }
    const { smRestore } = await loadSrc('src/client/bridge.ts')
    const res = await smRestore('abc-123')
    assert.strictEqual(res.ok, true)
    assert.strictEqual(calls.length, 1)
    assert.strictEqual(calls[0].input, '/sm/restore')
    assert.strictEqual(calls[0].init.method, 'POST')
    assert.deepStrictEqual(JSON.parse(calls[0].init.body), { id: 'abc-123' })
  } finally {
    globalThis.fetch = original
  }
})

test('F3-相邻: 归档视图仍然保留取消归档/删除/清空回收站三个入口', () => {
  assert.ok(/取消归档/.test(archiveView))
  assert.ok(/'删除'|"删除"/.test(archiveView))
  assert.ok(/清空回收站/.test(archiveView))
  assert.ok(/smUnarchive/.test(archiveView) && /smEmptyTrash/.test(archiveView))
})

// ---- H1：取消归档绕开 workspaceRegistry 缓存 ----

test('H1: 取消归档“刷新后回滚”的限制必须被明确记录，或改走官方 registry 接口', () => {
  // dsh-workspace 的 this.state 只在 start 时读一次域，且全文没有 ctx.on 监听，
  // 外部直接写域后它就是脏的：刷新页面 / 下一次官方写操作会把 id 写回归档集。
  const documentedInReadme = /(取消归档|unarchive)[\s\S]{0,300}(刷新|回滚|rollback)/i.test(readme)
  const warnedInUi = /(刷新|回滚)[\s\S]{0,80}(归档|回滚)/.test(archiveView)
  const viaOfficialApi = /workspaceRegistry|workspaces?\.(unarchive|setArchived|update)/.test(handlerSrc + indexSrc)
  assert.ok(
    documentedInReadme || warnedInUi || viaOfficialApi,
    '直接写 workspace 域会被 dsh-workspace 的内存缓存覆盖：要么走官方 API，要么在 README/UI 明确标注该限制',
  )
})

test('H1-相邻: README 的「边界与已知限制」小节仍然存在（新增说明写进这里）', () => {
  assert.ok(/## 边界与已知限制/.test(readme), '限制说明的落点不要挪走')
})

// ---- L3：已有按钮 early-return，id 冻结在注入时刻 ----

test('L3: 行上已有删除按钮时必须校验绑定的 id 是否仍然一致', () => {
  assert.ok(
    !/if\s*\(row\.querySelector\(DELETE_BTN_SEL\)\s*!==\s*null\)\s*return\s*\n/.test(deleteButton),
    'React 复用行节点后，无条件 early-return 会让按钮永远指向旧会话',
  )
  assert.ok(
    /(===|!==)\s*action\.id|action\.id\s*(===|!==)/.test(deleteButton),
    '需要把 id 存到 row.dataset 并与新解析出的 action.id 比对，不一致就重绑',
  )
})

test('L3-相邻: 注入逻辑仍然只靠 role 锚点，不依赖 hash 后的 CSS 类名', () => {
  assert.ok(/\[role="tree"\]/.test(deleteButton))
  assert.ok(/\[role="treeitem"\]/.test(deleteButton))
  assert.ok(
    !/querySelector(All)?\([^)]*\.[A-Za-z0-9]{5,}_[A-Za-z]/.test(deleteButton),
    '选择器里不得出现 build 后 hash 的 CSS Module 类名',
  )
})

// ---- M5(2)：双标签页不同步 ----

test('M5: 已删除 id 集合必须跨标签页同步（当前没有任何 storage 事件监听）', () => {
  const all = Object.values(CALLERS).join('\n')
  assert.ok(
    /addEventListener\(\s*['"]storage['"]/.test(all),
    'deletedIds 存在 localStorage 里但没人监听 storage 事件：A 页删除后 B 页的行还在，B 页写回还会覆盖',
  )
})

test('M5-相邻: deletedIds 仍然持久化在 localStorage（跨刷新隐藏不能丢）', () => {
  assert.ok(/localStorage/.test(pendingDeletesSrc))
  assert.ok(/dsh-sm\.deleted/.test(pendingDeletesSrc), 'storage key 不要改名，否则老用户的隐藏集丢失')
})
