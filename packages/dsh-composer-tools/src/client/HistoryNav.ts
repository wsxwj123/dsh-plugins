/**
 * HistoryNav — 串联方向键门槛（gate）× 历史状态机（history-core）× 官方回填
 * （inputActions.setDraft）× 光标复位，并做手动编辑检测（INTERFACE §3）。
 *
 * 职责边界：
 *   - 键盘命中路径：ComposerEntry 在 document capture keydown 里已判定
 *     `arrowGateAction(...) !== null` 并 preventDefault/stopPropagation，
 *     这里只负责读出历史文本、setDraft 回填、rAF 内把光标复位到末尾。
 *   - 每次 `inputActions.setDraft(text)` 写入的文本记为 lastProgrammaticText；
 *     textarea 的 `input` 事件值与之不同（或 lastProgrammaticText 为空）→
 *     用户手动编辑/退格 → resetCursor(state)，翻历史中途被打断。
 *
 * 状态机实例按 sessionId 缓存（Map）：会话切换即换用各自的 entries/cursor/
 * stash/pending，且每实例 entries 变更即持久化到 localStorage（注入 storage
 * 便于测试与配额失败降级，save 失败仅丢持久化不影响使用）。
 */
import { arrowGateAction, type ArrowGateInput, type ArrowAction } from './gate.ts'
import {
  createHistory,
  capturePending,
  commitPending,
  dropPending,
  recallOlder,
  recallNewer,
  recordSend,
  resetCursor,
  type HistoryState,
} from './history-core.ts'
import { loadHistory, saveHistory, type KeyValueStorage } from './history-storage.ts'

export interface HistoryNavController {
  /** 处理一次 document capture keydown；命中并回填返回 true，否则 false。 */
  onKeydown(e: KeyboardEvent, isComposerTarget: boolean, menuOpen: boolean): boolean
  /** 手动编辑检测入口：textarea 的 input 事件值 !== lastProgrammaticText 时 resetCursor。 */
  onInput(value: string): void
  /**
   * 快照采集写入：会话快照新落地一条 user 消息时调用（主路径，普通消息与
   * 发送按钮点击都只在这里被采到）。空白文本自动忽略。
   */
  record(text: string): void
  /** 发送采集：进入 submitting/adjudicating 时调用（draft 未清；斜杠命令路径）。 */
  capture(text: string): void
  /** 发送被受理：draft 变 '' 时调用。 */
  commit(): void
  /** 发送失败 restore：phase 回 plain 且 draft 恢复 pending 原文时调用。 */
  drop(): void
  /** 当前采集中的 pending 原文（无则 null），用于组件判断 restore。 */
  pending(): string | null
  /** 切换到指定会话：更换 state 实例并加载/复用其持久化历史。 */
  switchSession(sessionId: string | undefined): void
  /** 销毁：清理 per-session Map 缓存引用。 */
  dispose(): void
}

interface NavDeps {
  storage: KeyValueStorage
  setDraft(text: string): void
  /** 取当前聚焦的 composer textarea（rAF 光标复位用）；无则返回 null。 */
  focusTextarea(): HTMLTextAreaElement | null
}

/**
 * 工厂：为一个 composer entry 实例创建 HistoryNavController。调用方保证每个
 * entry 只实例化一个本控制器（随组件生命周期创建/销毁），per-session 状态机
 * 由此闭包内部 Map 维护，跨会话切换时自动隔离并持久化。
 */
export function createHistoryNav(deps: NavDeps): HistoryNavController {
  const stateBySession = new Map<string, HistoryState>()
  let sessionId: string | undefined
  let state: HistoryState = createHistory()
  // 最近一次经 inputActions.setDraft 写入的文本（手动编辑检测基线）。
  let lastProgrammaticText: string | null = null

  const persist = (s: HistoryState): void => {
    if (sessionId === undefined) return
    saveHistory(deps.storage, sessionId, s.entries)
  }

  const applyText = (text: string): void => {
    lastProgrammaticText = text
    deps.setDraft(text)
    requestAnimationFrame(() => {
      const ta = deps.focusTextarea()
      if (ta === null) return
      const len = ta.value.length
      try {
        ta.setSelectionRange(len, len)
      } catch {
        /* 某些宿主元素不支持 setSelectionRange 时静默。 */
      }
    })
  }

  const onKeydown = (e: KeyboardEvent, isComposerTarget: boolean, menuOpen: boolean): boolean => {
    const ta = deps.focusTextarea()
    const text = ta?.value ?? ''
    const input: ArrowGateInput = {
      isComposerTarget,
      key: e.key,
      text,
      selectionStart: ta?.selectionStart ?? 0,
      selectionEnd: ta?.selectionEnd ?? 0,
      isComposing: e.isComposing,
      shiftKey: e.shiftKey,
      ctrlKey: e.ctrlKey,
      metaKey: e.metaKey,
      altKey: e.altKey,
      menuOpen,
    }
    const action: ArrowAction | null = arrowGateAction(input)
    if (action === null) return false

    let next: HistoryState
    let textOut: string
    if (action === 'older') {
      const r = recallOlder(state, text)
      if (r === null) return false
      next = r.state
      textOut = r.text
    } else {
      const r = recallNewer(state)
      if (r === null) return false
      next = r.state
      textOut = r.text
    }
    state = next
    persist(state)
    applyText(textOut)
    return true
  }

  return {
    onKeydown,
    onInput(value: string): void {
      // 程序回填自身触发的 input 事件值 === lastProgrammaticText → 不处理；
      // 不等（或基线为空）→ 用户手动编辑/退格 → 打断翻历史。
      if (lastProgrammaticText !== null && value === lastProgrammaticText) return
      lastProgrammaticText = null
      state = resetCursor(state)
    },
    record(text: string): void {
      const before = state.entries
      state = recordSend(state, text)
      // entries 未变（空白/未写入）就不落盘，防无用写。
      if (state.entries !== before) persist(state)
    },
    capture(text: string): void {
      state = capturePending(state, text)
    },
    commit(): void {
      const before = state.pending
      state = commitPending(state)
      // entries 可能变化：仅当 pending 确实被消耗后才值得持久化（防无用写）。
      if (before !== null || state.pending !== null) persist(state)
    },
    drop(): void {
      state = dropPending(state)
    },
    pending(): string | null {
      return state.pending
    },
    switchSession(next: string | undefined): void {
      if (next === sessionId) return
      sessionId = next
      lastProgrammaticText = null
      if (next === undefined) {
        state = createHistory()
        return
      }
      let cached = stateBySession.get(next)
      if (cached === undefined) {
        cached = createHistory(loadHistory(deps.storage, next))
        stateBySession.set(next, cached)
      }
      state = cached
    },
    dispose(): void {
      stateBySession.clear()
    },
  }
}
