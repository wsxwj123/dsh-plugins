// 白盒单测：history-core.ts（lib/history-core.js 真实实现）
//
// 分工：验收测（test-07）覆盖状态机契约骨架；本文件补白盒内部与边界：
//   createHistory 传入数组被拷贝（入参不被引用）、commitPending 去重置顶
//   保留原相对顺序/多重复项、recallOlder 在 1 元素历史的 stash 语义、
//   recallOlder 已到最旧仍消费且输入不影响、recallNewer 恢复草稿时的
//   stash 清空、recallOlder/recallNewer 对 pending 字段的不动、纯函数
//   深度不变性。

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  HISTORY_LIMIT,
  createHistory,
  capturePending,
  commitPending,
  dropPending,
  recallOlder,
  recallNewer,
  resetCursor,
} from '../../lib/history-core.js'

test.describe('history-core.unit', () => {
  test.describe('createHistory', () => {
    test('缺省 entries 为 []，cursor=-1 stash=null pending=null', () => {
      const s = createHistory()
      assert.deepEqual(s, { entries: [], cursor: -1, stash: null, pending: null })
    })
    test('传入数组被浅拷贝：改入参数组不影响返回 state.entries', () => {
      const src = ['A', 'B']
      const s = createHistory(src)
      src.push('C')
      assert.deepEqual(s.entries, ['A', 'B'])
    })
    test('createHistory 返回独立对象（字段不被共享引用）', () => {
      const s1 = createHistory(['A'])
      const s2 = createHistory(['A'])
      assert.notEqual(s1, s2)
      assert.notEqual(s1.entries, s2.entries)
    })
  })

  test.describe('capturePending', () => {
    test('trim 后非空 → pending=trim 后原文，entries 不动', () => {
      const s = createHistory(['keep'])
      const c = capturePending(s, '  hello  ')
      assert.equal(c.pending, 'hello')
      assert.deepEqual(c.entries, ['keep'])
    })
    test('trim 后为空（含 \r\n\t 混合）→ 原样返回同一引用', () => {
      const s = createHistory()
      assert.equal(capturePending(s, '\r\n\t '), s)
      assert.equal(capturePending(s, '\uFEFF'), s) // BOM 不是空白，会录
    })
  })

  test.describe('commitPending', () => {
    test('去重时保留既有同值条目的最靠前位置（保持剩余相对顺序）', () => {
      const s = capturePending(createHistory(['B', 'A', 'B', 'C']), 'B')
      const c = commitPending(s)
      // 所有 'B' 都被去重移除，剩 A、C（保留原相对顺序），unshift 新 B 置顶
      assert.deepEqual(c.entries, ['B', 'A', 'C'])
    })
    test('pending 已存在于 entries 时置顶且不产生重复', () => {
      const s = capturePending(createHistory(['B', 'C']), 'B')
      const c = commitPending(s)
      assert.deepEqual(c.entries, ['B', 'C'])
      assert.equal(new Set(c.entries).size, c.entries.length)
    })
    test('裁剪 100 条：保留最新侧，丢最旧', () => {
      const many = Array.from({ length: HISTORY_LIMIT + 1 }, (_, i) => `e${i}`)
      const s = capturePending(createHistory(many), 'HEAD')
      const c = commitPending(s)
      assert.equal(c.entries.length, HISTORY_LIMIT)
      assert.equal(c.entries[0], 'HEAD')
      assert.ok(!c.entries.includes('e99'), '最旧被裁')
      assert.ok(c.entries.includes('e0'))
    })
    test('commitPending 不改 cursor/stash', () => {
      const s0 = createHistory(['A', 'B'])
      const up = recallOlder(s0, 'draft') // cursor0, stash='draft'
      const c = commitPending(capturePending(up.state, 'x'))
      assert.equal(c.cursor, 0)
      assert.equal(c.stash, 'draft')
    })
  })

  test.describe('dropPending', () => {
    test('pending 置 null，entries/stash/cursor 不动', () => {
      const s = capturePending(createHistory(['A']), 'f')
      const d = dropPending(s)
      assert.equal(d.pending, null)
      assert.deepEqual(d.entries, ['A'])
    })
    test('stash 不被 dropPending 清掉', () => {
      const s0 = createHistory(['A'])
      const up = recallOlder(s0, 'draft')
      const d = dropPending(capturePending(up.state, 'f'))
      assert.equal(d.stash, 'draft')
    })
  })

  test.describe('recallOlder 边界', () => {
    test('1 元素历史首次 ↑：stash=draft，cursor=0，返回 entry', () => {
      const s = createHistory(['only'])
      const r = recallOlder(s, 'my draft')
      assert.equal(r.text, 'only')
      assert.equal(r.state.cursor, 0)
      assert.equal(r.state.stash, 'my draft')
    })
    test('1 元素历史已到最旧再 ↑：仍返回最旧，cursor 不变，stash 保持', () => {
      const s = createHistory(['x'])
      const r1 = recallOlder(s, 'draft')
      const r2 = recallOlder(r1.state, 'ignored')
      assert.equal(r2.state.cursor, 0)
      assert.equal(r2.state.stash, 'draft', '第二次调用的 currentDraft 被忽略')
      assert.equal(r2.text, 'x')
    })
    test('cursor 已非 -1 时再次 ↑，currentDraft 被忽略（不覆写 stash）', () => {
      const s = createHistory(['A', 'B'])
      const r1 = recallOlder(s, 'first')
      const r2 = recallOlder(r1.state, 'changed')
      assert.equal(r2.state.stash, 'first')
      assert.equal(r2.text, 'B')
    })
    test('recallOlder 不修改 pending', () => {
      const s = capturePending(createHistory(['A']), 'pending-kept')
      const r = recallOlder(s, 'draft')
      assert.equal(r.state.pending, 'pending-kept')
    })
  })

  test.describe('recallNewer 边界', () => {
    test('cursor>0 → 下移一档返回条目，stash 保留', () => {
      const s = createHistory(['A', 'B'])
      const up1 = recallOlder(s, 'draft')
      const up2 = recallOlder(up1.state, 'draft')
      const down = recallNewer(up2.state)
      assert.equal(down.text, 'A')
      assert.equal(down.state.cursor, 0)
      assert.equal(down.state.stash, 'draft')
    })
    test('cursor===0 → 恢复草稿并清 stash；无 stash → 空串', () => {
      const s = createHistory(['A'])
      const up = recallOlder(s, 'my draft')
      const down = recallNewer(up.state)
      assert.equal(down.text, 'my draft')
      assert.equal(down.state.cursor, -1)
      assert.equal(down.state.stash, null)
      // 无 stash 场景：手工构造 cursor=0 stash=null
      const forced = { entries: ['A'], cursor: 0, stash: null, pending: null }
      const d2 = recallNewer(forced)
      assert.equal(d2.text, '')
      assert.equal(d2.state.cursor, -1)
    })
    test('cursor 已 -1 → null（不拦截 ↓）', () => {
      assert.equal(recallNewer(createHistory(['A'])), null)
    })
  })

  test.describe('resetCursor', () => {
    test('重置时 entries/pending 不动，只清 cursor/stash', () => {
      const s = createHistory(['A'])
      const up = recallOlder(capturePending(s, 'p'), 'draft')
      const r = resetCursor(up.state)
      assert.equal(r.cursor, -1)
      assert.equal(r.stash, null)
      assert.equal(r.pending, 'p')
      assert.deepEqual(r.entries, ['A'])
    })
    test('已在基线（cursor=-1 stash=null）→ 返回原引用', () => {
      const s = createHistory(['A'])
      assert.equal(resetCursor(s), s)
    })
  })

  test.describe('纯函数深度不变性', () => {
    test('入参 state 对象与嵌套 entries 数组不被任何函数修改', () => {
      const entries = ['A', 'B']
      const s = createHistory(entries)
      const snapshot = JSON.stringify(s)
      const entsBefore = JSON.stringify(entries)
      capturePending(s, 'x')
      commitPending(s)
      dropPending(s)
      recallOlder(s, 'draft')
      recallNewer(s)
      resetCursor(s)
      assert.equal(JSON.stringify(s), snapshot)
      assert.equal(JSON.stringify(entries), entsBefore, 'createHistory 的入参数组不被改')
    })
  })

  test('HISTORY_LIMIT = 100', () => {
    assert.equal(HISTORY_LIMIT, 100)
  })
})
