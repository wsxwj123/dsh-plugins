// client 纯函数契约参考实现（测试替身）：按 INTERFACE §2.1/2.2/2.3/2.5 实现。
// 作用同 contractHost：让 client 纯函数测试现在能跑，且作为验收基准——
// 真实插件导出同名函数必须通过同一批断言。
// 换真实实现：把各 client-*.test.mjs 顶部的 import 源换成插件实际导出处（函数名不变）。

export const HISTORY_LIMIT = 100

// —— §2.1 方向键门槛 ——
export function arrowGateAction(input) {
  const {
    isComposerTarget,
    key,
    text,
    selectionStart,
    selectionEnd,
    isComposing,
    shiftKey,
    ctrlKey,
    metaKey,
    altKey,
    menuOpen,
  } = input

  if (isComposerTarget !== true) return null // 0
  if (key !== 'ArrowUp' && key !== 'ArrowDown') return null // 1
  if (shiftKey || ctrlKey || metaKey || altKey) return null // 2
  if (isComposing === true) return null // 3
  if (menuOpen === true) return null // 4
  if (selectionStart !== selectionEnd) return null // 5
  if (!text.includes('\n')) return key === 'ArrowUp' ? 'older' : 'newer' // 6
  // 7 多行
  const cursorLine = text.slice(0, selectionStart).split('\n').length - 1
  const lastLine = text.split('\n').length - 1
  if (key === 'ArrowUp' && cursorLine === 0) return 'older'
  if (key === 'ArrowDown' && cursorLine === lastLine) return 'newer'
  return null
}

// —— §2.2 历史状态机 ——
export function createHistory(entries = []) {
  return { entries: entries.slice(), cursor: -1, stash: null, pending: null }
}

export function capturePending(state, text) {
  const trimmed = typeof text === 'string' ? text.trim() : ''
  if (!trimmed) return state
  return { ...state, pending: trimmed }
}

export function commitPending(state) {
  if (state.pending === null) return state
  const rest = state.entries.filter((e) => e !== state.pending)
  const entries = [state.pending, ...rest].slice(0, HISTORY_LIMIT)
  return { ...state, entries, pending: null }
}

export function dropPending(state) {
  if (state.pending === null) return state
  return { ...state, pending: null }
}

export function recallOlder(state, currentDraft) {
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

export function recallNewer(state) {
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

export function resetCursor(state) {
  if (state.cursor === -1 && state.stash === null) return state
  return { ...state, cursor: -1, stash: null }
}

// —— §2.3 localStorage ——
export function historyStorageKey(sessionId) {
  return 'dsh-composer-tools:history:' + sessionId
}

export function loadHistory(storage, sessionId) {
  const raw = storage.getItem(historyStorageKey(sessionId))
  if (raw === null) return []
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  const strings = parsed.filter((x) => typeof x === 'string')
  return strings.slice(0, HISTORY_LIMIT)
}

export function saveHistory(storage, sessionId, entries) {
  try {
    storage.setItem(historyStorageKey(sessionId), JSON.stringify(entries.slice(0, HISTORY_LIMIT)))
    return true
  } catch {
    return false
  }
}

// —— §2.5 提示词追加 ——
export function appendPromptToDraft(current, prompt) {
  if (current === '') return prompt
  if (current.endsWith('\n\n')) return current + prompt
  if (current.endsWith('\n')) return current + '\n' + prompt
  return current + '\n\n' + prompt
}
