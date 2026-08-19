/**
 * 历史状态机（INTERFACE §2.2，纯函数）。
 *
 * entries 最新在前（index 0 = 最近一次发送）；cursor = -1 表示未在翻历史；
 * stash 保存进入历史前的草稿（cursor 首次从 -1 上移时记录）；pending 为发送
 * 采集中尚未确认的文本。所有函数返回新状态对象（或语义上无变化时原样返回），
 * 不修改入参。
 */
export const HISTORY_LIMIT = 100

export interface HistoryState {
  /** 最新在前（index 0 = 最近一次发送）。 */
  entries: string[]
  /** -1 = 未在翻历史；0..entries.length-1 = 当前展示 entries[cursor]。 */
  cursor: number
  /** 进入历史前的草稿（cursor 从 -1 首次上移时保存）。 */
  stash: string | null
  /** 发送采集中、尚未确认的文本。 */
  pending: string | null
}

/**
 * entries 缺省 []；传入时被原样采用（调用方负责已裁剪/去重，来自 loadHistory）。
 */
export function createHistory(entries: string[] = []): HistoryState {
  return { entries: entries.slice(), cursor: -1, stash: null, pending: null }
}

/**
 * trim 后为空 → 原样返回（不录空白）；否则 pending = trim 后的原文，不碰 entries。
 */
export function capturePending(state: HistoryState, text: string): HistoryState {
  const trimmed = typeof text === 'string' ? text.trim() : ''
  if (!trimmed) return state
  return { ...state, pending: trimmed }
}

/**
 * pending === null → 原样返回。否则去掉 entries 中与 pending 完全相等的既有条目
 * （去重），unshift 到最前，裁到 HISTORY_LIMIT，pending 置 null。cursor/stash 不动。
 */
export function commitPending(state: HistoryState): HistoryState {
  if (state.pending === null) return state
  const rest = state.entries.filter((e) => e !== state.pending)
  const entries = [state.pending, ...rest].slice(0, HISTORY_LIMIT)
  return { ...state, entries, pending: null }
}

/**
 * pending 置 null（发送失败 restore 时调用，误录条目根本不进 entries）。
 */
export function dropPending(state: HistoryState): HistoryState {
  if (state.pending === null) return state
  return { ...state, pending: null }
}

/**
 * 单段式写入（会话快照采集入口，INTERFACE §2.2 增量 3）：文本已被快照确认受理，
 * 不存在"发送失败误录"，所以不需要 pending 两阶段。
 * trim 后为空 → 原样返回；否则去重（键 = trim 后全文）+ unshift 置顶 + 裁到上限。
 * 若当前正在翻历史（cursor ≥ 0）→ cursor 置 -1、stash 清空：本次写入挪动了
 * entries，旧 cursor 会指向别的条目。
 */
export function recordSend(state: HistoryState, text: string): HistoryState {
  const trimmed = typeof text === 'string' ? text.trim() : ''
  if (!trimmed) return state
  const entries = [trimmed, ...state.entries.filter((e) => e !== trimmed)].slice(0, HISTORY_LIMIT)
  if (state.cursor === -1) return { ...state, entries }
  return { ...state, entries, cursor: -1, stash: null }
}

/**
 * entries 为空 → null（放行）。cursor === -1：stash = currentDraft，cursor = 0。
 * cursor 已在最旧（=== entries.length - 1）→ 仍消费：返回最旧条目文本，状态不变。
 * 其余：cursor + 1。返回 entries[cursor]。
 */
export function recallOlder(
  state: HistoryState,
  currentDraft: string,
): { state: HistoryState; text: string } | null {
  if (state.entries.length === 0) return null
  let { cursor, stash } = state
  if (cursor === -1) {
    stash = currentDraft
    cursor = 0
  } else if (cursor < state.entries.length - 1) {
    cursor = cursor + 1
  }
  const text = state.entries[cursor]
  return { state: { ...state, cursor, stash }, text }
}

/**
 * cursor === -1 → null（放行，↓ 正常移动光标）。
 * cursor > 0 → cursor - 1，返回 entries[cursor]。
 * cursor === 0 → cursor = -1，返回 stash ?? ''，stash 置 null（翻到底恢复草稿）。
 */
export function recallNewer(
  state: HistoryState,
): { state: HistoryState; text: string } | null {
  if (state.cursor === -1) return null
  let { cursor, stash } = state
  if (cursor > 0) {
    cursor = cursor - 1
    return { state: { ...state, cursor }, text: state.entries[cursor] }
  }
  // cursor === 0 → 恢复草稿
  cursor = -1
  const text = stash ?? ''
  stash = null
  return { state: { ...state, cursor, stash }, text }
}

/**
 * 翻历史途中用户手动编辑/退格时调用：cursor = -1，stash = null。entries/pending 不动。
 */
export function resetCursor(state: HistoryState): HistoryState {
  if (state.cursor === -1 && state.stash === null) return state
  return { ...state, cursor: -1, stash: null }
}
