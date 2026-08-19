// client 会话快照 user 消息提取（session-history.ts / INTERFACE §2.7）契约测试
// 增量 3 新增纯函数：把"从会话快照节点到历史条目的提取"抽成 node 可直接驱动的纯函数，
// 采集主路径（快照订阅 → 水位线 diff → recordSend）依赖它们。
//
// 覆盖：
//   userMessageText：单/多 text 块（多块以 '\n' 连接）、非 text 块过滤、
//     content null/undefined/非数组 → ''、无 text 块 → ''。
//   isUserMessageNode：kind === 'user' 判别（assistant/command/steering/context
//     及 null/无 kind/非对象 → false）。
//   newUserTexts：水位线推进（见到更大 seq 即推进，与是否产出文本无关）、只取
//     seq > sawSeq、翻页回填低 seq 旧消息过滤、空文本占位不丢位、discontinuity
//     （新快照 max seq < sawSeq）、nodes 非数组按空处理、sawSeq 负数/NaN 视为
//     -Infinity（首个快照全采）、返回按 seq 升序。
//
// 接入：函数从 helpers/contractClient 导入（接驳 lib/session-history.js）；
// 换真实实现仅改 import 源。增量 3 未实现时本文件全红属预期（PLAN §9.9）。

import test from 'node:test'
import assert from 'node:assert/strict'
import { isUserMessageNode, newUserTexts, userMessageText } from './helpers/contractClient.mjs'

test.describe('session-history userMessageText（§2.7）', () => {
  test('单 text 块：直接返回块文本原文', () => {
    assert.equal(userMessageText([{ type: 'text', text: 'hello world' }]), 'hello world')
  })
  test('多 text 块：按顺序以 \'\\n\' 连接（多段落 prompt 还原换行）', () => {
    const content = [
      { type: 'text', text: '第一段' },
      { type: 'text', text: '第二段' },
    ]
    assert.equal(userMessageText(content), '第一段\n第二段')
  })
  test('非 text 块（image/tool-call）被过滤，只拼 text 块', () => {
    const content = [
      { type: 'image', url: 'x' },
      { type: 'text', text: 'keep me' },
      { type: 'tool-call', name: 'ls' },
    ]
    assert.equal(userMessageText(content), 'keep me')
  })
  test('content 为 null/undefined → 空串', () => {
    assert.equal(userMessageText(null), '')
    assert.equal(userMessageText(undefined), '')
  })
  test('content 非数组（对象/字符串）→ 空串', () => {
    assert.equal(userMessageText({ type: 'text', text: 'x' }), '')
    assert.equal(userMessageText('plain string'), '')
  })
  test('无 text 块（空数组 / 全非文本）→ 空串', () => {
    assert.equal(userMessageText([]), '')
    assert.equal(userMessageText([{ type: 'image', url: 'x' }]), '')
  })
})

test.describe('session-history isUserMessageNode（§2.7）', () => {
  test('kind === user → true（已受理的 user 消息）', () => {
    assert.equal(isUserMessageNode({ kind: 'user', seq: 3, content: [{ type: 'text', text: 'hi' }] }), true)
  })
  test('其他 kind（assistant/command/steering/context）→ false', () => {
    assert.equal(isUserMessageNode({ kind: 'assistant', seq: 1 }), false)
    assert.equal(isUserMessageNode({ kind: 'command', seq: 2 }), false)
    assert.equal(isUserMessageNode({ kind: 'steering', seq: 3 }), false)
    assert.equal(isUserMessageNode({ kind: 'context', seq: 4 }), false)
  })
  test('null/undefined/无 kind 字段/非对象 → false', () => {
    assert.equal(isUserMessageNode(null), false)
    assert.equal(isUserMessageNode(undefined), false)
    assert.equal(isUserMessageNode({ seq: 1, content: [] }), false)
    assert.equal(isUserMessageNode('user'), false)
  })
})

test.describe('session-history newUserTexts（§2.7）', () => {
  // 快速构造 UserMessageNode 形状节点；text 缺省 → content 为空数组（userMessageText 产出 ''）
  const user = (seq, text) =>
    text === undefined
      ? { kind: 'user', seq, content: [] }
      : { kind: 'user', seq, content: [{ type: 'text', text }] }

  test('水位线推进：seq > sawSeq 的新消息全采，sawSeq = 本次所有 user 节点最大 seq', () => {
    const nodes = [user(1, 'a'), user(3, 'c'), user(5, 'e')]
    const r = newUserTexts(nodes, 2)
    assert.deepEqual(r, { texts: ['c', 'e'], sawSeq: 5, discontinuity: false })
  })
  test('只采 seq > sawSeq：翻页回填的低 seq 旧消息被过滤，不误采', () => {
    const nodes = [
      { kind: 'assistant', seq: 4, content: [] }, // 非 user 节点不参与
      user(1, 'old-backfilled'),
      user(9, 'fresh'),
    ]
    const r = newUserTexts(nodes, 6)
    assert.deepEqual(r, { texts: ['fresh'], sawSeq: 9, discontinuity: false })
  })
  test('快照无新消息（全部 seq ≤ sawSeq）→ null（无新、无断裂）', () => {
    const nodes = [user(1, 'old'), user(5, 'old'), user(9, 'old')]
    assert.equal(newUserTexts(nodes, 9), null)
  })
  test('空文本占位：产出 "" 的新消息仍进 texts（不丢位），其 seq 计入水位线', () => {
    // user(5) 的 content 全非文本 → userMessageText 为 ''；仍占位返回且 sawSeq 越过 5
    const nodes = [user(5), user(6, 'hello')]
    const r = newUserTexts(nodes, 4)
    assert.deepEqual(r, { texts: ['', 'hello'], sawSeq: 6, discontinuity: false })
  })
  test('连续空文本：sawSeq 仍推进（水位线推进与是否产出文本无关）', () => {
    const nodes = [user(5), user(6)]
    const r = newUserTexts(nodes, 4)
    assert.deepEqual(r, { texts: ['', ''], sawSeq: 6, discontinuity: false })
  })
  test('水位线断裂：新快照 max seq < sawSeq → discontinuity:true、texts 空、sawSeq 重初始化为新 max', () => {
    const nodes = [user(2, 'a'), user(50, 'b')]
    const r = newUserTexts(nodes, 100)
    assert.deepEqual(r, { texts: [], sawSeq: 50, discontinuity: true })
  })
  test('nodes 非数组（null/undefined/对象/字符串/数字）→ 按空处理：texts 空、sawSeq 不变、无断裂', () => {
    for (const bad of [null, undefined, { nodes: [] }, 'not-array', 42]) {
      const r = newUserTexts(bad, 7)
      assert.deepEqual(r, { texts: [], sawSeq: 7, discontinuity: false }, `nodes=${String(bad)}`)
    }
  })
  test('nodes 为空数组：无任何消息 → 无新无断裂 → null', () => {
    assert.equal(newUserTexts([], 3), null)
  })
  test('sawSeq 为负数 → 视为 -Infinity：首个快照全采', () => {
    const nodes = [user(1, 'a'), user(2, 'b')]
    const r = newUserTexts(nodes, -1)
    assert.deepEqual(r, { texts: ['a', 'b'], sawSeq: 2, discontinuity: false })
  })
  test('sawSeq 为 NaN → 视为 -Infinity：首个快照全采', () => {
    const r = newUserTexts([user(3, 'c')], NaN)
    assert.deepEqual(r, { texts: ['c'], sawSeq: 3, discontinuity: false })
  })
  test('返回的 texts 按 seq 升序（与快照节点数组顺序无关）', () => {
    const nodes = [user(9, 'nine'), user(1, 'one'), user(5, 'five')]
    const r = newUserTexts(nodes, 0)
    assert.deepEqual(r.texts, ['one', 'five', 'nine'])
    assert.equal(r.sawSeq, 9)
  })
})
