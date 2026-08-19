// client 历史状态机（history-core.ts / INTERFACE §2.2）契约测试
// 覆盖：空历史 recallOlder null；cursor 从 -1 上移存 stash；翻到底恢复草稿；
// recordSend 单段式（trim 空白不录、去重置顶、unshift、上限 100 裁剪、
// 翻历史中发送 → cursor=-1、stash 清空）；resetCursor；纯函数（不改入参）。
//
// 增量 3 修订（PLAN §9.9）：capturePending/commitPending/dropPending/pending 已随
// 采集机制移除，相应用例替换为 recordSend 契约用例；未失效的 recallOlder/recallNewer/
// resetCursor 用例保持原样。
//
// 接入：函数从 helpers/contractClient 导入；换真实实现仅改 import 源。

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createHistory,
  recordSend,
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

  // —— recordSend（增量 3：会话快照单段式采集写入，取代 capturePending/commitPending/dropPending）——
  test('recordSend：trim 后为空 → 原样返回（不录空白），entries 不变', () => {
    const s = createHistory(['A'])
    assert.equal(recordSend(s, ''), s)
    assert.equal(recordSend(s, '   '), s)
    assert.equal(recordSend(s, '\n\t '), s)
    assert.deepEqual(s.entries, ['A'], '空白不写入 entries')
  })
  test('recordSend：同文本已是最新 → 去重后仍置顶，不产生重复', () => {
    const s = createHistory(['B', 'A'])
    const r = recordSend(s, 'B')
    assert.deepEqual(r.entries, ['B', 'A'], 'B 已存在且最前，去重后保持置顶、不重复')
  })
  test('recordSend：同文本在中间 → 去掉旧位置并置顶（去重 + unshift）', () => {
    const s = createHistory(['A', 'B', 'C', 'B'])
    const r = recordSend(s, 'B')
    assert.deepEqual(r.entries, ['B', 'A', 'C'])
  })
  test('recordSend：新条目 unshift 到最前（最新在前）；未翻历史时 cursor/stash 保持', () => {
    const s = createHistory(['A'])
    const r = recordSend(s, 'N')
    assert.deepEqual(r.entries, ['N', 'A'])
    assert.equal(r.cursor, -1)
    assert.equal(r.stash, null)
  })
  test('recordSend：去重键是 trim 后的全文（"  B  " 与既有 "B" 视为同一条）', () => {
    const s = createHistory(['B'])
    const r = recordSend(s, '  B  ')
    assert.deepEqual(r.entries, ['B'], 'trim 后命中既有条目，不产生重复')
  })
  test('recordSend：裁剪到 HISTORY_LIMIT 条，丢最旧', () => {
    const many = Array.from({ length: HISTORY_LIMIT + 20 }, (_, i) => `item-${i}`)
    // 最新在前：item-0 最前（最新）
    const h = createHistory(many)
    const r = recordSend(h, 'newest')
    assert.equal(r.entries.length, HISTORY_LIMIT)
    assert.equal(r.entries[0], 'newest')
    // 原始去重后为 120 条，置顶 newest → 共 121，裁到 100 → 丢最旧 21 条
    // 保留：newest + item-0..item-98（共 100）；item-99 及更旧全部丢弃
    assert.ok(!r.entries.includes('item-119'), '最旧应被裁剪')
    assert.equal(r.entries.includes('item-99'), false, 'item-99 是最旧被裁边界之后')
    assert.equal(r.entries.includes('item-98'), true, 'item-98 是最新侧边界，保留')
  })
  test('recordSend：翻历史中发送 → cursor 置 -1、stash 清空（退出翻历史态）', () => {
    let s = createHistory(['A', 'B'])
    s = recallOlder(s, 'draft').state // cursor 0, stash=draft
    s = recallOlder(s, 'draft').state // cursor 1
    assert.equal(s.cursor, 1)
    assert.equal(s.stash, 'draft')
    const r = recordSend(s, 'X')
    assert.equal(r.cursor, -1, '发送接受理后退出翻历史态')
    assert.equal(r.stash, null, 'stash 清空，避免指向被本次写入挪位的 entries')
    assert.deepEqual(r.entries, ['X', 'A', 'B'], '新消息仍正常写入最前')
  })

  // —— resetCursor ——
  test('resetCursor：cursor=-1、stash=null，entries 不动', () => {
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
    recordSend(s, 'x')
    recordSend(s, '   ') // 空白分支同样不改入参
    recallOlder(s, 'draft')
    resetCursor(s)
    assert.equal(JSON.stringify(s), sBefore)
  })
})
