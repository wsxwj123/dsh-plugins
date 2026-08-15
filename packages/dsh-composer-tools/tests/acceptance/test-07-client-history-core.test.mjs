// client 历史状态机（history-core.ts / INTERFACE §2.2）契约测试
// 覆盖：空历史 recallOlder null；cursor 从 -1 上移存 stash；翻到底恢复草稿；
// 去重后 unshift 置顶；上限 100 裁剪丢最旧；capturePending trim 空不录；
// commitPending 去重+置顶+裁剪；dropPending；resetCursor；纯函数（不改入参）。
//
// 接入：函数从 helpers/contractClient 导入；换真实实现仅改 import 源。

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createHistory,
  capturePending,
  commitPending,
  dropPending,
  recallOlder,
  recallNewer,
  resetCursor,
  HISTORY_LIMIT,
} from './helpers/contractClient.mjs'

test.describe('history-core 历史状态机', () => {
  // —— 空历史 ——
  test('entries 为空：recallOlder → null（放行不拦截）', () => {
    const s = createHistory()
    assert.equal(recallOlder(s, 'draft'), null)
  })
  test('entries 为空：recallNewer → null', () => {
    assert.equal(recallNewer(createHistory()), null)
  })

  // —— cursor 从 -1 上移：存 stash ——
  test('首次 ↑（cursor -1→0）：stash 记录当前草稿，返回 entries[0]', () => {
    const s = createHistory(['A', 'B'])
    const r = recallOlder(s, 'my draft')
    assert.ok(r, '应返回结果')
    assert.equal(r.text, 'A')
    assert.equal(r.state.cursor, 0)
    assert.equal(r.state.stash, 'my draft')
    // entries 不动
    assert.deepEqual(r.state.entries, ['A', 'B'])
  })

  // —— 连续 ↑ 上移 ——
  test('连续 ↑：cursor 递增，返回对应条目', () => {
    let s = createHistory(['A', 'B', 'C'])
    let r = recallOlder(s, 'draft') // cursor 0, A
    r = recallOlder(r.state, 'draft') // cursor 1, B
    assert.equal(r.text, 'B')
    assert.equal(r.state.cursor, 1)
    r = recallOlder(r.state, 'draft') // cursor 2, C
    assert.equal(r.text, 'C')
    assert.equal(r.state.cursor, 2)
  })

  // —— 翻到最旧后继续 ↑：消费最旧，状态不变 ——
  test('已到最旧（cursor === entries.length-1）继续 ↑：返回最旧文本，cursor 不变', () => {
    const s = createHistory(['A', 'B'])
    const r1 = recallOlder(s, 'draft') // cursor0 → A
    const r2 = recallOlder(r1.state, 'draft') // cursor1 → B
    assert.equal(r2.state.cursor, 1)
    assert.equal(r2.text, 'B')
    const r3 = recallOlder(r2.state, 'draft') // 已在最旧，仍返回最旧
    assert.equal(r3.text, 'B')
    assert.equal(r3.state.cursor, 1, 'cursor 不再 +1（越界防护）')
  })

  // —— recallNewer ——
  test('recallNewer：cursor===0 → 恢复草稿 stash，stash 清空，cursor=-1', () => {
    const s = createHistory(['A'])
    const up = recallOlder(s, 'my draft') // cursor 0
    const down = recallNewer(up.state)
    assert.equal(down.text, 'my draft')
    assert.equal(down.state.cursor, -1)
    assert.equal(down.state.stash, null)
  })
  test('recallNewer：cursor===0 且无 stash → 返回空串', () => {
    // stash 为 null 时翻到底恢复 ''（契约：stash ?? ''）
    const s = createHistory(['A'])
    const up = recallOlder(s, '') // stash 存空串? 不，存 ''，但契约 stash=currentDraft
    const down = recallNewer(up.state)
    assert.equal(down.text, '')
  })
  test('recallNewer：cursor>0 → 下移一档，返回对应条目（不动 stash）', () => {
    const s = createHistory(['A', 'B'])
    const up1 = recallOlder(s, 'draft') // cursor0 A
    const up2 = recallOlder(up1.state, 'draft') // cursor1 B
    const down1 = recallNewer(up2.state) // cursor0 A
    assert.equal(down1.text, 'A')
    assert.equal(down1.state.cursor, 0)
    assert.equal(down1.state.stash, 'draft', '下移不破坏 stash')
  })
  test('recallNewer：cursor === -1 → null', () => {
    assert.equal(recallNewer(createHistory(['A'])), null)
  })

  // —— capturePending ——
  test('capturePending：trim 后为空 → 原样返回（不录空白），pending 仍 null', () => {
    const s = createHistory()
    assert.equal(capturePending(s, '   '), s)
    assert.equal(capturePending(s, ''), s)
    assert.equal(capturePending(s, '\n\t'), s)
    assert.equal(capturePending(s, null), s)
    assert.equal(s.pending, null)
  })
  test('capturePending：trim 非空 → pending = trim 后原文', () => {
    const s = capturePending(createHistory(), '  hello  ')
    assert.equal(s.pending, 'hello')
    assert.deepEqual(s.entries, [], '未 commit 前不进 entries')
  })

  // —— commitPending ——
  test('commitPending：pending 为 null → 原样返回', () => {
    const s = createHistory(['A'])
    assert.equal(commitPending(s), s)
  })
  test('commitPending：去重 + 置顶 + pending 清空', () => {
    const s = capturePending(createHistory(['B', 'A']), 'B')
    const c = commitPending(s)
    assert.deepEqual(c.entries, ['B', 'A'], 'B 已存在去重后仍置顶')
    assert.equal(c.pending, null)
  })
  test('commitPending：新条目 unshift 最前', () => {
    const s = capturePending(createHistory(['A']), 'N')
    const c = commitPending(s)
    assert.deepEqual(c.entries, ['N', 'A'])
  })
  test('commitPending：去重去掉中间重复项', () => {
    const s = capturePending(createHistory(['A', 'B', 'C', 'B']), 'B')
    const c = commitPending(s)
    assert.deepEqual(c.entries, ['B', 'A', 'C'])
  })
  test('commitPending：裁剪到 100 条，丢最旧', () => {
    const many = Array.from({ length: HISTORY_LIMIT + 20 }, (_, i) => `item-${i}`)
    // 最新在前：item-0 最前（最新）
    const h = createHistory(many)
    const s = capturePending(h, 'newest')
    const c = commitPending(s)
    assert.equal(c.entries.length, HISTORY_LIMIT)
    assert.equal(c.entries[0], 'newest')
    // 原始去重后为 120 条，置顶 newest → 共 121，裁到 100 → 丢最旧 21 条
    // 保留：newest + item-0..item-98（共 100）；item-99 及更旧全部丢弃
    assert.ok(!c.entries.includes('item-119'), '最旧应被裁剪')
    assert.equal(c.entries.includes('item-99'), false, 'item-99 是最旧被裁边界之后')
    assert.equal(c.entries.includes('item-98'), true, 'item-98 是最新侧边界，保留')
  })
  test('commitPending：cursor/stash 不动', () => {
    const s = createHistory(['A'])
    const up = recallOlder(s, 'draft') // cursor0 stash=draft
    const captured = capturePending(up.state, 'x')
    const c = commitPending(captured)
    assert.equal(c.cursor, 0)
    assert.equal(c.stash, 'draft')
  })

  // —— dropPending ——
  test('dropPending：pending → null，不入 entries', () => {
    const s = createHistory(['A'])
    const captured = capturePending(s, 'failed send')
    const d = dropPending(captured)
    assert.equal(d.pending, null)
    assert.deepEqual(d.entries, ['A'], '误录条目不进 entries')
  })
  test('dropPending：pending 已为 null → 原样返回', () => {
    const s = createHistory(['A'])
    assert.equal(dropPending(s), s)
  })

  // —— resetCursor ——
  test('resetCursor：cursor=-1、stash=null，entries/pending 不动', () => {
    const s = createHistory(['A'])
    const up = recallOlder(s, 'draft')
    const r = resetCursor(up.state)
    assert.equal(r.cursor, -1)
    assert.equal(r.stash, null)
    assert.deepEqual(r.entries, ['A'])
  })
  test('resetCursor：未在翻历史时调用无副作用', () => {
    const s = createHistory(['A'])
    assert.deepEqual(resetCursor(s), s)
  })

  // —— 纯函数：不改入参 ——
  test('纯函数：所有函数都不原地修改入参 state', () => {
    const s = createHistory(['A'])
    const sBefore = JSON.stringify(s)
    capturePending(s, 'x')
    commitPending(s)
    recallOlder(s, 'draft')
    resetCursor(s)
    dropPending(s)
    assert.equal(JSON.stringify(s), sBefore)
  })
})
