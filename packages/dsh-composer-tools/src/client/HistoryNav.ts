/**
 * HistoryNav — 串联方向键门槛（gate）× 历史状态机（history-core）× 官方回填
 * （inputActions.setDraft）× 光标复位，并做手动编辑检测（INTERFACE §3）。
 *
 * 职责边界：
 *   - 键盘命中路径：ComposerEntry 在 document capture keydown 里已判定
 *     `arrowGateAction(...) !== null` 并 preventDefault/stopPropagation，
 *     这里只负责读出历史文本、setDraft 回填、rAF 内把光标复位到末尾。
 *   - composer 类型不在这里判定：调用方注入 `composer()` 适配器（textarea 或
 *     0.2.2 Lexical contenteditable 的统一读写面，见 composer-target.ts）。
 *   - 每次 `inputActions.setDraft(text)` 写入的文本记为 lastProgrammaticText；
 *     composer 的 `input` 事件文本与之不同（或 lastProgrammaticText 为空）→
 *     用户手动编辑/退格 → resetCursor(state)，翻历史中途被打断。
 *   - 回填后光标复位要容错：Lexical 的 setDraft 是 discrete update（通常同帧
 *     渲染完），但 React 发布链路可能晚一帧；文本还没同步时最多重试 3 帧，
 *     避免一次 rAF 落空导致光标停在旧位置、下一次 ↑ 的行号判据读到旧文本。
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
  seedHistory,
  type HistoryState,
} from './history-core.ts'
import { loadHistory, saveHistory, type KeyValueStorage } from './history-storage.ts'

/** 回填后光标复位最多等几帧（Lexical/React 异步渲染兜底）。 */
const CARET_RETRY_FRAMES = 3

/**
 * HistoryNav 需要的 composer 读写面（ComposerAdapter 的结构子集）：
 * textarea 与 contenteditable 差异全部收敛在适配层。
 */
export interface ComposerHandle {
  /** 当前全文。 */
  getText(): string
  /** 选区字符偏移；拿不到 → null（调用方按"光标在末尾"兜底）。 */
  getSelection(): { start: number; end: number } | null
  /** 把光标放到末尾；不再持有焦点时返回 false。 */
  setCaretToEnd(): boolean
}

export interface HistoryNavController {
  /** 处理一次 document capture keydown；命中并回填返回 true，否则 false。 */
  onKeydown(e: KeyboardEvent, isComposerTarget: boolean, menuOpen: boolean): boolean
  /** 手动编辑检测入口：composer 的 input 事件全文 !== lastProgrammaticText 时 resetCursor。 */
  onInput(value: string): void
  /**
   * 手动编辑检测（contenteditable 主路径）：Lexical 会 preventDefault 掉
   * beforeinput 再自己改 DOM，浏览器原生 `input` 事件因此可能不派发；在
   * document capture 的 beforeinput 上无条件 resetCursor（程序化 setDraft
   * 不产生 beforeinput，不会误伤）。
   */
  onManualEdit(): void
  /**
   * 快照/事件流采集写入：会话确认受理一条 user 消息时调用（主路径）。
   * 空白文本自动忽略。
   */
  record(text: string): void
  /** 当前会话的历史是否为空（回填路径据此判断"只在本地历史为空时回填"）。 */
  isEmpty(): boolean
  /**
   * 用会话里已有消息回填历史（从旧到新的 texts）；仅当当前历史为空时生效，
   * 否则原样返回。回填结果立即持久化，保证刷新/重开不重复累积。
   */
  seed(texts: readonly string[]): void
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
  /** 取当前聚焦的 composer 适配器；无则返回 null。 */
  composer(): ComposerHandle | null
}

/** 下一帧执行；node 测试环境没有 rAF 时退化为 setTimeout（同 rAF 语义：异步）。 */
function nextFrame(fn: () => void): void {
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() => { fn() })
    return
  }
  setTimeout(fn, 0)
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
  // 控制器销毁后不再落光标，避免组件卸载后仍触碰 DOM。
  let disposed = false

  const persist = (s: HistoryState): void => {
    if (sessionId === undefined) return
    saveHistory(deps.storage, sessionId, s.entries)
  }

  /** 回填后把光标放到末尾；文本还没渲染出来就再等一帧（最多 CARET_RETRY_FRAMES 帧）。 */
  const placeCaret = (text: string, attempt: number): void => {
    nextFrame(() => {
      if (disposed) return
      const composer = deps.composer()
      if (composer === null) return
      if (composer.getText() !== text && attempt < CARET_RETRY_FRAMES) {
        placeCaret(text, attempt + 1)
        return
      }
      composer.setCaretToEnd()
    })
  }

  const applyText = (text: string): void => {
    lastProgrammaticText = text
    deps.setDraft(text)
    placeCaret(text, 0)
  }

  /** 用户手动输入/删除/粘贴：打断翻历史，游标回到未翻状态。 */
  const resetForManualEdit = (): void => {
    lastProgrammaticText = null
    state = resetCursor(state)
  }

  const onKeydown = (e: KeyboardEvent, isComposerTarget: boolean, menuOpen: boolean): boolean => {
    const composer = deps.composer()
    const text = composer?.getText() ?? ''
    const selection = composer?.getSelection() ?? null
    // 拿不到选区时按"光标在末尾"处理：单行仍可翻历史，多行不会误判首行。
    const collapsedAtEnd = { start: text.length, end: text.length }
    const input: ArrowGateInput = {
      isComposerTarget,
      key: e.key,
      text,
      selectionStart: selection?.start ?? collapsedAtEnd.start,
      selectionEnd: selection?.end ?? collapsedAtEnd.end,
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
      resetForManualEdit()
    },
    onManualEdit(): void {
      resetForManualEdit()
    },
    record(text: string): void {
      const before = state.entries
      state = recordSend(state, text)
      // entries 未变（空白/未写入）就不落盘，防无用写。
      if (state.entries !== before) persist(state)
    },
    isEmpty(): boolean {
      return state.entries.length === 0
    },
    seed(texts: readonly string[]): void {
      // 只在持久化历史为空时回填；已有历史（用户发过消息/之前回填过）不动。
      if (state.entries.length > 0) return
      const before = state.entries
      state = seedHistory(state, texts)
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
      disposed = true
      stateBySession.clear()
    },
  }
}
