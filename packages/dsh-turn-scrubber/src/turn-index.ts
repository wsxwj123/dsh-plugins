/**
 * Pure turn-index construction for the node half: events → `{turn, preview,
 * compacted}[]`.
 *
 * Turn authority = `turn/start` events (`data.turn`, 1-based). Every rule below
 * is spike-verified against real archives (see PLAN §1.1 / TEST-PLAN §0):
 * - preview = the LAST `user/message` text in the turn (first ones are usually
 *   system injections), truncated to `PREVIEW_LEN`; compacted turns use the
 *   shadowing `compaction/summary.data.summary` text instead; empty when there
 *   is no usable text.
 * - compacted = the turn's FIRST `user/message` seq falls inside any
 *   compaction shadowedSeqs set (summary + prune merged; prune alone would not
 *   shadow a user message, but merging is harmless).
 *
 * This module is intentionally dependency-free and side-effect free so the
 * node endpoint and the unit tests share one implementation.
 */

/** Truncation length for every preview field (INTERFACE §4). */
export const PREVIEW_LEN = 120

/** One feed entry in the turn index (INTERFACE §1.3). */
export interface TurnIndexEntry {
  /** Turn number straight from `turn/start.data.turn` (1-based, preserved). */
  turn: number
  /** Text taken from the turn (≤ PREVIEW_LEN chars), '' when none. */
  preview: string
  /** Whether compaction shadows the turn's first user message. */
  compacted: boolean
}

/** Successful build result the node endpoint returns (INTERFACE §1.3). */
export interface TurnIndexBuildResult {
  /** Seq of the last event the index was built from; -1 for an empty feed. */
  asOfSeq: number
  /** Total turns == turns.length (turn/start count). */
  total: number
  /** Ascending by turn; turn values are the original 1-based numbers. */
  turns: TurnIndexEntry[]
}

/**
 * Structural subset of a session event this module reads. Matches the DSH
 * `SessionEvent` envelope (`{type, seq, time, data}`) while staying free of
 * `@deepseek-ai` imports so it can run unchanged on both halves' tests.
 */
export interface TurnIndexEvent {
  type?: string
  seq?: number
  data?: {
    turn?: number
    content?: unknown
    summary?: unknown
    shadowedSeqs?: number[]
  }
}

function isNumberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'number')
}

/**
 * Extract plain text from an event field, which may be a string, a content
 * block array (`[{type:"text",text:"..."}, ...]`), or a structured object —
 * the same tolerances the rail's `textOfContent` applies to chat nodes.
 */
function textOfContent(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    let out = ''
    for (const block of value) {
      if (typeof block === 'string') out += block
      else if (block !== null && typeof block === 'object') {
        const b = block as { text?: unknown; content?: unknown }
        if (typeof b.text === 'string') out += b.text
        else if (typeof b.content === 'string') out += b.content
      }
    }
    return out
  }
  if (value !== null && typeof value === 'object') {
    const c = value as { text?: unknown; content?: unknown }
    if (typeof c.text === 'string') return c.text
    if (typeof c.content === 'string') return c.content
  }
  return ''
}

interface TurnBucket {
  turn: number
  /** First `user/message` seq of the turn (compaction判定依据). */
  firstUserSeq?: number
  /** Text of the LAST `user/message` seen in the turn. */
  lastUserText: string
}

interface CompactionSummary {
  /** Used only to keep "last wins" ordering (later compaction dominates). */
  seq: number
  text: string
  shadowedSeqs: number[]
}

/**
 * Build the full turn index from an ordered event feed.
 *
 * Single pass per concern:
 * 1. collect every `compaction/*.shadowedSeqs` and the compaction summary texts;
 * 2. segment turns by `turn/start`, tracking first/last `user/message` facts;
 * 3. assemble per-turn entries (compacted flag + preview source).
 *
 * @param events - ordered session events (append order, seq ascending).
 * @returns the index; empty feed yields `{asOfSeq:-1, total:0, turns:[]}`.
 */
export function buildTurnIndex(events: readonly TurnIndexEvent[]): TurnIndexBuildResult {
  const shadowedSeqs = new Set<number>()
  const summaries: CompactionSummary[] = []

  for (const event of events) {
    const type = event.type
    const data = event.data
    // Merge both compaction markers: summary shadows user messages, prune
    // normally shadows tool results — merging is harmless (INTERFACE §1.3).
    if (type === 'compaction/summary' || type === 'compaction/prune') {
      if (isNumberArray(data?.shadowedSeqs)) {
        for (const seq of data.shadowedSeqs) shadowedSeqs.add(seq)
      }
    }
    if (type === 'compaction/summary') {
      summaries.push({
        seq: typeof event.seq === 'number' ? event.seq : -1,
        text: textOfContent(data?.summary),
        shadowedSeqs: isNumberArray(data?.shadowedSeqs) ? data.shadowedSeqs : [],
      })
    }
  }

  // Segment turns and record per-turn user-message facts.
  const buckets = new Map<number, TurnBucket>()
  let currentTurn: number | undefined
  for (const event of events) {
    const type = event.type
    const data = event.data
    if (type === 'turn/start') {
      const turn = typeof data?.turn === 'number' ? data.turn : undefined
      if (turn === undefined) continue
      currentTurn = turn
      if (!buckets.has(turn)) buckets.set(turn, { turn, lastUserText: '' })
      continue
    }
    if (type !== 'user/message') continue
    // user/message carries no turn field — the closest turn/start rules.
    if (currentTurn === undefined) continue
    const bucket = buckets.get(currentTurn)
    if (bucket === undefined) continue
    if (bucket.firstUserSeq === undefined && typeof event.seq === 'number') {
      bucket.firstUserSeq = event.seq
    }
    bucket.lastUserText = textOfContent(data?.content)
  }

  const turns: TurnIndexEntry[] = []
  const sorted = [...buckets.values()].sort((left, right) => left.turn - right.turn)
  for (const bucket of sorted) {
    const firstUserSeq = bucket.firstUserSeq
    const compacted = firstUserSeq !== undefined && shadowedSeqs.has(firstUserSeq)
    let preview = bucket.lastUserText
    if (compacted) {
      // The compaction/summary that shadows this turn's first user message is
      // the "corresponding" summary; later compactions dominate (last wins).
      let summaryText = ''
      for (const summary of summaries) {
        if (summary.shadowedSeqs.includes(firstUserSeq)) summaryText = summary.text
      }
      if (summaryText !== '') preview = summaryText
    }
    turns.push({ turn: bucket.turn, preview: preview.slice(0, PREVIEW_LEN), compacted })
  }

  let asOfSeq = -1
  for (const event of events) {
    if (typeof event.seq === 'number') asOfSeq = event.seq
  }

  return { asOfSeq, total: turns.length, turns }
}