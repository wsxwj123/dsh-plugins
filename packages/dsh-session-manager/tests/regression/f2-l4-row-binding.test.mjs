/**
 * F2 (致命) + L4 (低) — 侧栏行 → 会话 id 的绑定 (src/client/sessionRowMatch.ts)。
 *
 * 三条独立缺陷（任一成立就删错会话）：
 *  (a) tie 分组没套官方可见性过滤。官方渲染器只渲染
 *      `origin !== 'subagent' && !archived.has(id) && (!blank || 当前选中)`
 *      （dsh-client-ui-workspace/lib/client.js:100-102），插件却从全部 ids 建
 *      同名组 → 归档/子代理会话占掉槽位 0。
 *  (b) “DOM 行序 = ids 序”不成立：flat 视图 rows.sort(byRecency) 显式重排，
 *      两种视图还都套一层用户可拖拽的持久化顺序 reconciledSessionOrder。
 *  (c) aria 模板本身是 `会话“{name}”的操作` / `Session actions for {name}`
 *      （client.js:2227/2292），bestTitleIn 取“被 label 包含的最长标题”，
 *      所以标题正好叫「会话」/「Session」的会话会劫持所有更短标题的行。
 *
 * L4：每次 sync 都做 O(行×会话) 的 includes 扫描。
 */
import { test } from 'node:test'
import assert from 'node:assert'
import { loadSrc } from './_harness.mjs'

const { resolveRows } = await loadSrc('src/client/sessionRowMatch.ts')

const ZH = (name) => `会话“${name}”的操作`
const EN = (name) => `Session actions for ${name}`

/**
 * 归档 id 集合作为第 4 个实参传入。当前实现忽略多余实参，修复后无论选择
 * `string[]` / `Set` / `{ archivedSessionIds }` 哪种签名都能从这一个值里读到，
 * 所以本套测试不会因为签名细节而假绿。
 */
function archivedArg(ids) {
  const arg = [...ids]
  arg.archivedSessionIds = [...ids]
  arg.archived = new Set(ids)
  return arg
}

test('F2a: 已归档的同名会话不得占用可见行的 tie 槽位（会删错到归档会话）', () => {
  const byId = {
    arch: { title: 'tmp', displayTitle: 'tmp', cwd: '/private/tmp', blank: false, archived: true },
    live: { title: 'tmp', displayTitle: 'tmp', cwd: '/private/tmp', blank: false },
  }
  // host 列表序把归档会话排在前面；官方侧栏只渲染 live 这一行。
  const rows = resolveRows([ZH('tmp')], byId, ['arch', 'live'], archivedArg(['arch']))
  assert.notStrictEqual(rows[0], null, '唯一可见候选应当能绑定')
  assert.strictEqual(rows[0].id, 'live', '可见行必须绑到可见会话，不能绑到已归档的同名会话')
})

test('F2a: 子代理（origin=subagent）同名会话不得占用可见行的 tie 槽位', () => {
  const byId = {
    sub: { title: 'tmp', displayTitle: 'tmp', cwd: '/private/tmp', origin: 'subagent' },
    live: { title: 'tmp', displayTitle: 'tmp', cwd: '/private/tmp', blank: false },
  }
  const rows = resolveRows([ZH('tmp')], byId, ['sub', 'live'], archivedArg([]))
  assert.notStrictEqual(rows[0], null, '唯一可见候选应当能绑定')
  assert.strictEqual(rows[0].id, 'live', '官方渲染器过滤掉 subagent，tie 槽位也必须过滤')
})

test('F2b: DOM 行序 ≠ ids 序时，同名两行宁可都不绑按钮，也不能猜', () => {
  // 官方 flat 视图 rows.sort(byRecency)：DOM 行序是 [b, a]，而 snapshot.ids 是 [a, b]。
  // 只凭 aria-label 无法区分这两行，按 ids 序对齐就是在赌。
  const byId = {
    a: { title: '需求', displayTitle: '需求', cwd: '/pa', blank: false, updatedAt: 1 },
    b: { title: '需求', displayTitle: '需求', cwd: '/pb', blank: false, updatedAt: 999 },
  }
  const rows = resolveRows([ZH('需求'), ZH('需求')], byId, ['a', 'b'], archivedArg([]))
  assert.strictEqual(rows[0], null, '同名歧义行不得注入按钮（删错会话的代价远高于少个按钮）')
  assert.strictEqual(rows[1], null, '同名歧义行不得注入按钮')
})

test('F2c: 标题正好叫「会话」的会话不得劫持其它更短标题的行（中文模板）', () => {
  const byId = {
    tpl: { title: '会话', displayTitle: '会话', cwd: '/tpl', blank: false },
    x: { title: '短', displayTitle: '短', cwd: '/x', blank: false },
  }
  const rows = resolveRows([ZH('短')], byId, ['tpl', 'x'], archivedArg([]))
  assert.notStrictEqual(rows[0], null, '这一行有唯一精确命中')
  assert.strictEqual(rows[0].id, 'x', 'label 是模板 + 名字，必须精确重建匹配，不能取“最长被包含标题”')
})

test('F2c: 标题正好叫 Session 的会话不得劫持其它行（英文模板）', () => {
  const byId = {
    tpl: { title: 'Session', displayTitle: 'Session', cwd: '/tpl', blank: false },
    x: { title: 'A', displayTitle: 'A', cwd: '/x', blank: false },
  }
  const rows = resolveRows([EN('A')], byId, ['tpl', 'x'], archivedArg([]))
  assert.notStrictEqual(rows[0], null, '这一行有唯一精确命中')
  assert.strictEqual(rows[0].id, 'x')
})

test('F2-相邻: 标题互为子串的两行仍然各归其主', () => {
  const byId = {
    short: { title: '需求', displayTitle: '需求', cwd: '/short', blank: false },
    long: { title: '需求评审', displayTitle: '需求评审', cwd: '/long', blank: false },
  }
  // 「需求」这一行的 label 只精确匹配 short；包含式最长匹配会误取「需求评审」吗？
  // 不会——但反向（长标题行）会把短标题也算进候选，所以这里锁定两行都各归其主。
  const rows = resolveRows([ZH('需求'), ZH('需求评审')], byId, ['short', 'long'], archivedArg([]))
  assert.strictEqual(rows[0]?.id, 'short')
  assert.strictEqual(rows[1]?.id, 'long')
})

// ---- F2 相邻回归：修复不得把正常绑定一起干掉 ----

test('F2-相邻: 唯一标题的普通行仍然正常绑定并带上 cwd/running', () => {
  const byId = {
    a: { title: '项目A', displayTitle: '项目A', cwd: '/proj-a', running: true, blank: false },
    b: { title: '项目B', displayTitle: '项目B', cwd: '/proj-b', running: false, blank: false },
  }
  const rows = resolveRows([ZH('项目A'), ZH('项目B')], byId, ['a', 'b'], archivedArg([]))
  assert.strictEqual(rows[0]?.id, 'a')
  assert.strictEqual(rows[0].cwd, '/proj-a')
  assert.strictEqual(rows[0].running, true)
  assert.strictEqual(rows[1]?.id, 'b')
  assert.strictEqual(rows[1].running, false)
})

test('F2-相邻: 只有 displayTitle（无 raw title）的会话仍能绑定', () => {
  const byId = { c: { displayTitle: 'Untitled Session', cwd: '/proj-c', blank: false } }
  const rows = resolveRows([EN('Untitled Session')], byId, ['c'], archivedArg([]))
  assert.strictEqual(rows[0]?.id, 'c')
  assert.strictEqual(rows[0].title, 'Untitled Session')
})

test('F2-相邻: blank 行与无 label 的项目行仍然不绑', () => {
  const byId = {
    blank1: { displayTitle: 'New Session', cwd: '/d', blank: true },
    a: { title: 'A', displayTitle: 'A', cwd: '/a', blank: false },
  }
  const rows = resolveRows([null, 'New Session', ZH('A')], byId, ['blank1', 'a'], archivedArg([]))
  assert.strictEqual(rows[0], null, '项目行（无 aria-label）不绑')
  assert.strictEqual(rows[1], null, 'blank 行不绑')
  assert.strictEqual(rows[2]?.id, 'a')
})

test('F2-相邻: label 与任何会话都不匹配时返回 null', () => {
  const byId = { a: { title: 'A', displayTitle: 'A', cwd: '/a', blank: false } }
  const rows = resolveRows([ZH('不存在的会话')], byId, ['a'], archivedArg([]))
  assert.strictEqual(rows[0], null)
})

// ---- L4：每次 sync 的匹配复杂度 ----

test('L4: resolveRows 不得对每一行都全量扫描 byId（O(行×会话)）', () => {
  const N = 150
  const byId = {}
  const ids = []
  const labels = []
  for (let i = 0; i < N; i++) {
    const id = `s${i}`
    byId[id] = { title: `标题${i}`, displayTitle: `标题${i}`, cwd: '/p', blank: false }
    ids.push(id)
    labels.push(ZH(`标题${i}`))
  }
  let reads = 0
  const counted = new Proxy(byId, {
    get(target, key) {
      if (typeof key === 'string') reads++
      return target[key]
    },
  })
  resolveRows(labels, counted, ids, archivedArg([]))
  assert.ok(
    reads <= 4 * N,
    `byId 读取次数应为 O(行+会话)，实测 ${reads} 次（上限 ${4 * N}）——应复用 idsByTitle 索引，别每行重扫`,
  )
})
