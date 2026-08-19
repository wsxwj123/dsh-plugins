/**
 * Unit tests for the pure turn-index builder (src/turn-index.ts).
 *
 * Uses synthetic event feeds only (禁止真实存档进 repo): turn/start is the
 * turn authority, user/message carries content blocks, compaction events carry
 * shadowedSeqs / summary as they do in real archives (spike-verified shapes —
 * summary is an ARRAY of content blocks, shadowedSeqs is a number array).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildTurnIndex, PREVIEW_LEN, type TurnIndexEvent } from '../../src/turn-index.ts'

function turnStart(turn: number, seq: number): TurnIndexEvent {
  return { type: 'turn/start', seq, time: 1, data: { turn } }
}

function userMessage(seq: number, content: unknown): TurnIndexEvent {
  return { type: 'user/message', seq, time: 1, data: { content } }
}

function compactionSummary(seq: number, shadowedSeqs: number[], summaryText: string): TurnIndexEvent {
  return {
    type: 'compaction/summary',
    seq,
    time: 1,
    data: { shadowedSeqs, summary: [{ type: 'text', text: summaryText }] },
  }
}

function compactionPrune(seq: number, shadowedSeqs: number[]): TurnIndexEvent {
  return { type: 'compaction/prune', seq, time: 1, data: { shadowedSeqs } }
}

test('empty feed → total 0, turns [], asOfSeq -1', () => {
  const result = buildTurnIndex([])
  assert.equal(result.total, 0)
  assert.equal(result.turns.length, 0)
  assert.equal(result.asOfSeq, -1)
})

test('single turn with one user message', () => {
  const events = [turnStart(1, 4), userMessage(9, [{ type: 'text', text: 'hello' }])]
  const result = buildTurnIndex(events)
  assert.equal(result.total, 1)
  assert.equal(result.asOfSeq, 9)
  assert.deepEqual(result.turns, [{ turn: 1, preview: 'hello', compacted: false }])
})

test('preview truncates to PREVIEW_LEN (120)', () => {
  const long = 'x'.repeat(300)
  const events = [turnStart(1, 4), userMessage(9, [{ type: 'text', text: long }])]
  const result = buildTurnIndex(events)
  assert.equal(result.turns[0].preview.length, PREVIEW_LEN)
  assert.equal(result.turns[0].preview, 'x'.repeat(PREVIEW_LEN))
})

test('preview uses LAST user/message of the turn (first ones are injections)', () => {
  const events = [
    turnStart(1, 4),
    userMessage(9, [{ type: 'text', text: 'system injection' }]),
    userMessage(11, 'real user input'),
  ]
  const result = buildTurnIndex(events)
  assert.equal(result.turns[0].preview, 'real user input')
})

test('content blocks are concatenated; empty when no text block', () => {
  const events = [
    turnStart(1, 4),
    userMessage(9, [
      { type: 'text', text: 'a' },
      { type: 'text', text: 'b' },
    ]),
  ]
  assert.equal(buildTurnIndex(events).turns[0].preview, 'ab')
  const noText = [turnStart(1, 4), userMessage(9, [{ type: 'image', source: {} }])]
  assert.equal(buildTurnIndex(noText).turns[0].preview, '')
  const noUser = [turnStart(1, 4)]
  assert.equal(buildTurnIndex(noUser).turns[0].preview, '')
})

test('multiple turns: segmentation by turn/start, preview per turn, 1-based preserved', () => {
  const events = [
    turnStart(1, 4),
    userMessage(9, 'first'),
    turnStart(2, 20),
    userMessage(30, 'second'),
    turnStart(7, 50), // non-contiguous must be preserved as-is
    userMessage(55, 'seventh'),
  ]
  const result = buildTurnIndex(events)
  assert.equal(result.total, 3)
  assert.deepEqual(
    result.turns.map((t) => t.turn),
    [1, 2, 7],
  )
  assert.deepEqual(
    result.turns.map((t) => t.preview),
    ['first', 'second', 'seventh'],
  )
  assert.ok(result.turns.every((t) => !t.compacted))
})

test('compaction/summary shadows turn whose FIRST user seq is in shadowedSeqs', () => {
  // Turn 1: first user message seq 9 → shadowed → compacted, preview = summary.
  const events = [
    turnStart(1, 4),
    userMessage(9, 'shadowed content'),
    userMessage(11, 'later content'),
    compactionSummary(100, [9, 11], 'compacted summary text'),
  ]
  const result = buildTurnIndex(events)
  const turn = result.turns[0]
  assert.equal(turn.compacted, true)
  assert.equal(turn.preview, 'compacted summary text')
})

test('compaction/prune shadowedSeqs also marks the turn compacted (merged, harmless)', () => {
  const events = [
    turnStart(1, 4),
    userMessage(9, 'content'),
    compactionPrune(100, [9]),
  ]
  const result = buildTurnIndex(events)
  assert.equal(result.turns[0].compacted, true)
  // No summary available → preview falls back to the user text.
  assert.equal(result.turns[0].preview, 'content')
})

test('unshadowed turn stays compacted=false even after compaction events', () => {
  const events = [
    turnStart(1, 4),
    userMessage(9, 'kept'),
    turnStart(2, 20),
    userMessage(30, 'shadowed'),
    compactionSummary(100, [30], 'summary'),
  ]
  const result = buildTurnIndex(events)
  assert.equal(result.turns[0].compacted, false)
  assert.equal(result.turns[0].preview, 'kept')
  assert.equal(result.turns[1].compacted, true)
  assert.equal(result.turns[1].preview, 'summary')
})

test('matching compaction selects the LAST summary shadowing the turn (later dominates)', () => {
  const events = [
    turnStart(1, 4),
    userMessage(9, 'content'),
    compactionSummary(100, [9], 'first summary'),
    compactionSummary(200, [9], 'second summary'),
  ]
  const result = buildTurnIndex(events)
  assert.equal(result.turns[0].compacted, true)
  assert.equal(result.turns[0].preview, 'second summary')
})

test('compaction summary preview is truncated to PREVIEW_LEN', () => {
  const long = 's'.repeat(500)
  const events = [turnStart(1, 4), userMessage(9, 'content'), compactionSummary(100, [9], long)]
  const result = buildTurnIndex(events)
  assert.equal(result.turns[0].preview.length, PREVIEW_LEN)
})

test('summary may be a plain string (defensive) rather than content blocks', () => {
  const events = [
    turnStart(1, 4),
    userMessage(9, 'content'),
    { type: 'compaction/summary', seq: 100, time: 1, data: { shadowedSeqs: [9], summary: 'plain string summary' } },
  ]
  assert.equal(buildTurnIndex(events).turns[0].preview, 'plain string summary')
})

test('turn/start without user/message → empty preview, not compacted', () => {
  const events = [turnStart(1, 4), compactionSummary(100, [])]
  const result = buildTurnIndex(events)
  assert.deepEqual(result.turns, [{ turn: 1, preview: '', compacted: false }])
})

test('events without seq do not break asOfSeq (last numeric seq wins)', () => {
  const events = [turnStart(1, 4), userMessage(9, 'x'), { type: 'unknown/event', time: 1, data: {} }]
  assert.equal(buildTurnIndex(events).asOfSeq, 9)
})

test('asOfSeq is the last event seq in append order', () => {
  const events = [turnStart(1, 4), userMessage(9, 'x'), userMessage(10, 'y')]
  assert.equal(buildTurnIndex(events).asOfSeq, 10)
})