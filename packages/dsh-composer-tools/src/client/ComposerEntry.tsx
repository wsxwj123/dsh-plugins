/**
 * ComposerEntry — slot entry 组件（conversation.input.left，id: dsh-composer-tools）。
 *
 * 职责（PLAN §1.3 / INTERFACE §3 / T8）：
 *   1. 按钮：点击开关面板，标题「指令/提示词」带图标。面板在本组件内渲染（composer
 *      内 position fixed），不另开 createRoot overlay。
 *   2. 方向键历史：useEffect 挂 `document.addEventListener('keydown', fn, true)`
 *      capture 监听。isComposerTarget / menuOpen 判定全部交给 composer 适配层
 *      （composer-target.ts）：0.2.1 textarea（`textarea[data-phase]`）与 0.2.2
 *      Lexical contenteditable（`[contenteditable="true"][data-phase]`）同一判据；
 *      菜单以 `[data-trigger-menu]` DOM 为准（0.2.2 菜单打开时 data-phase 仍是
 *      plain，实测）。命中 gate → preventDefault + stopPropagation + HistoryNav
 *      回填。cleanup 摘监听。
 *   3. 发送采集（主路径）：会话确认受理 user 消息 → 历史条目。
 *      · 0.1.5–0.2.0：`session.getSnapshot().nodes` 水位线 diff（session-history.ts）。
 *      · 0.2.2+：SessionSnapshot 不再有 nodes，改读 `binding.eventSource` 事件流的
 *        `user/message`（source.kind === 'user'）append 事件（event-capture.ts）。
 *   4. 发送采集（斜杠命令路径，保留）：useInput 的 phase 进 submitting/
 *      adjudicating 时 draft 未清 → capturePending；draft 变 '' → commitPending；
 *      phase 回 plain 且 draft 恢复 pending 原文（发送失败）→ dropPending。
 *      claimed 不动。斜杠命令在快照/事件流里是 CommandNode/command 事件，主路径
 *      采不到，故两条并存。
 */
import { createElement, useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { Context, InputActions, InputPhase, InputSelection } from './context-types.ts'
import { createHistoryNav, type HistoryNavController } from './HistoryNav.ts'
import { resolveComposerAdapter, isComposerMenuOpen } from './composer-target.ts'
import { createEventFeedCapture } from './event-capture.ts'
import { Panel } from './Panel.tsx'
import { createSnapshotCapture } from './session-history.ts'
import './panel.css'

/** compositionend 后等 Lexical 完成最终文本 reconciliation 的收尾窗口（毫秒）。 */
const COMPOSITION_SETTLE_MS = 120

interface EntryProps {
  ctx: Context
  /**
   * slot standard prop: the session this composer is scoped to (provided by
   * dsh-client-ui-session on both 0.1.5 and 0.2). 0.2 dropped `current` from
   * the sessions.list snapshot, so this is the only source of the current id.
   */
  sessionId?: string
  /** slot standard props: conversation session-scope provide channel. */
  useInput: (selector: (s: InputSelection) => unknown) => unknown
  inputActions: InputActions
  /** owner props（ignore，仅类型留位）。 */
  wide?: boolean
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any
}

export function ComposerEntry(props: EntryProps): ReactNode {
  const ctx = props.ctx
  const inputActions = props.inputActions

  // ---- 会话快照（sessionId + cwd） ----
  const snapshot = ctx.sessions.list.getSnapshot()
  // 当前会话 id：标准 slot prop 优先；snapshot.current 仅作 0.1.5 兜底。
  // TODO(0.3): drop snapshot.current fallback — dead on 0.1.5/0.2 since
  // sessionId prop is always provided.
  const sessionId = props.sessionId ?? snapshot.current

  // ---- useInput selector 采集（draft + phase） ----
  const draft = (props.useInput((s: InputSelection) => s?.draft ?? '') as string) ?? ''
  const phase = (props.useInput((s: InputSelection) => s?.phase) as InputPhase) ?? 'plain'

  // ---- 面板开关 ----
  const [open, setOpen] = useState(false)

  // ---- HistoryNav 控制器（单一实例，随组件生命周期） ----
  const histRef = useRef<HistoryNavController | null>(null)
  if (histRef.current === null) {
    histRef.current = createHistoryNav({
      storage: localStorage,
      setDraft: (text) => {
        inputActions.setDraft(text)
      },
      composer: () => resolveComposerAdapter(document.activeElement),
    })
  }
  const nav = histRef.current

  // ---- session 切换：状态机换会话实例 ----
  useEffect(() => {
    nav.switchSession(sessionId)
  }, [sessionId, nav])

  // ---- document capture keydown：方向键历史 ----
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      // e.target 优先；focus 判定兜底用 activeElement（contenteditable 的
      // keydown target 就是可编辑根，两者一致）。适配层不认目标 → 放行。
      const element = resolveComposerAdapter(e.target) ?? resolveComposerAdapter(document.activeElement)
      const isComposerTarget = element !== null
      const menuOpen = element === null ? false : isComposerMenuOpen(element.element)
      const hit = nav.onKeydown(e, isComposerTarget, menuOpen)
      if (hit) {
        e.preventDefault()
        e.stopPropagation()
      }
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [nav])

  // ---- 手动编辑检测：input/beforeinput（textarea/0.2.1）+ MutationObserver（Lexical 0.2.2） ----
  // 0.2.2 真机取证：
  //   · Lexical 对打字会 preventDefault beforeinput 自己改 DOM，原生 input 可能不派发；
  //   · Lexical 对 Backspace/Delete/选区删除/剪切只发 keydown + DOM mutation，
  //     不派发 beforeinput/input；
  //   · IME 取消合成时浏览器会先发一个 isComposing=false 的
  //     `input deleteContentBackward`（此时 DOM 还残留合成占位零宽字符），
  //     若立即比对会把"取消合成"误判成手动编辑。
  // 因此三路合一：DOM mutation 兜底删除类编辑；input/beforeinput 走旧路径；
  // 合成期整体跳过，compositionend 后给一个短收尾窗口，等 Lexical 的最终
  // reconciliation 完成再读全文比对（取消合成 → 文本恢复原值 → 不 reset；
  // 提交合成 → 文本不同 → reset）。纯光标移动不产生 mutation。
  useEffect(() => {
    let composing = false
    let settleDeadline = 0
    let settleTimer: ReturnType<typeof setTimeout> | null = null

    /** 当前聚焦 composer 的全文（contenteditable 或 textarea；无则 null）。 */
    const currentComposerText = (): string | null => {
      const composer = resolveComposerAdapter(document.activeElement)
      return composer === null ? null : composer.getText()
    }
    /** 与 lastProgrammaticText 比对：不同 → resetCursor（nav.onInput 内部判定）。 */
    const applyCheck = (): void => {
      const text = currentComposerText()
      if (text !== null) nav.onInput(text)
    }
    /** 非合成、非收尾窗口才立即判定；否则等 compositionend 的收尾定时器统一判。 */
    const requestCheck = (): void => {
      if (composing) return
      if (Date.now() < settleDeadline) return
      applyCheck()
    }
    const onInput = (e: Event): void => {
      const inputEvent = e as InputEvent
      if (composing || inputEvent.isComposing === true) return
      const composer = resolveComposerAdapter(e.target)
      if (composer === null) return
      requestCheck()
    }
    const onBeforeInput = (e: Event): void => {
      const inputEvent = e as InputEvent
      if (composing || inputEvent.isComposing === true) return
      if (typeof inputEvent.inputType === 'string' && inputEvent.inputType.startsWith('insertComposition')) return
      if (Date.now() < settleDeadline) return
      if (resolveComposerAdapter(e.target) === null) return
      nav.onManualEdit()
    }
    const finishSettling = (): void => {
      settleTimer = null
      settleDeadline = 0
      applyCheck()
    }
    const onCompositionStart = (): void => {
      composing = true
      if (settleTimer !== null) {
        clearTimeout(settleTimer)
        settleTimer = null
      }
      settleDeadline = 0
    }
    const onCompositionEnd = (): void => {
      composing = false
      settleDeadline = Date.now() + COMPOSITION_SETTLE_MS
      if (settleTimer !== null) clearTimeout(settleTimer)
      settleTimer = setTimeout(finishSettling, COMPOSITION_SETTLE_MS)
    }

    let observer: MutationObserver | null = null
    if (typeof MutationObserver === 'function') {
      observer = new MutationObserver(requestCheck)
      observer.observe(document.body, { characterData: true, childList: true, subtree: true })
    }
    document.addEventListener('input', onInput, true)
    document.addEventListener('beforeinput', onBeforeInput, true)
    document.addEventListener('compositionstart', onCompositionStart, true)
    document.addEventListener('compositionend', onCompositionEnd, true)
    return () => {
      observer?.disconnect()
      document.removeEventListener('input', onInput, true)
      document.removeEventListener('beforeinput', onBeforeInput, true)
      document.removeEventListener('compositionstart', onCompositionStart, true)
      document.removeEventListener('compositionend', onCompositionEnd, true)
      if (settleTimer !== null) clearTimeout(settleTimer)
    }
  }, [nav])

  // ---- 发送采集主路径：订阅会话（快照 nodes / 事件流），新落地的 user 消息即历史条目 ----
  // phase 机对普通消息永远不触发（onEnter 走 default-sink，phase 恒 plain），
  // 且发送按钮点击根本没有 keydown —— 只有会话侧信号能覆盖全部已受理的发送。
  useEffect(() => {
    if (sessionId === undefined) return
    let offSession: (() => void) | null = null
    const attach = (): void => {
      if (offSession !== null) return
      const binding = ctx.sessions.binding?.(sessionId)
      const session = binding?.session
      if (session === undefined || session === null) return
      const snapshotFace = session.getSnapshot()
      if (snapshotFace !== undefined && Array.isArray(snapshotFace.nodes)) {
        // 0.1.5–0.2.0：会话快照 nodes 路径（旧行为原样保留）。
        const capture = createSnapshotCapture((text) => nav.record(text))
        const pump = (): void => {
          capture.onSnapshot(session.getSnapshot()?.nodes)
        }
        pump() // 首帧只初始化水位线（已在窗口里的旧消息不回补）
        offSession = session.subscribe(pump)
        return
      }
      const feed = binding?.eventSource
      if (feed === undefined || feed === null) return
      // 0.2.2+：SessionSnapshot 不再有 nodes，改读事件流 user/message append。
      const capture = createEventFeedCapture((text) => nav.record(text))
      const pump = (): void => {
        capture.onSnapshot(feed)
      }
      pump() // 首帧只初始化 seq 水位线（窗口里已有的事件不回补）
      offSession = feed.subscribe(pump)
    }
    attach()
    // binding 暂缺（会话未打开/未 staged）时不能只试一次就放弃：会话列表变化即补挂。
    const offList = ctx.sessions.list.subscribe(attach)
    return () => {
      offList()
      if (offSession !== null) offSession()
    }
  }, [ctx, sessionId, nav])

  // ---- 发送采集（phase 机两段式，INTERFACE §3；斜杠命令路径；claimed 不动） ----
  const prevPhase = useRef<InputPhase>('plain')
  useEffect(() => {
    const p = phase
    const d = draft
    const prevP = prevPhase.current
    // 进入 submitting/adjudicating（从非当前态迁移）：draft 未清则采集。
    if ((p === 'submitting' || p === 'adjudicating') && p !== prevP) {
      if (d !== '') nav.capture(d)
    }
    // 从 submitting/adjudicating 回到 plain：
    //   - draft 被清（commitSend 已清，发送被受理）→ commitPending
    //   - draft 恢复为采集时的 pending 原文（发送失败 restore）→ dropPending
    if (p === 'plain' && prevP !== 'plain') {
      const pending = nav.pending()
      if (d === '') {
        nav.commit()
      } else if (pending !== null && d === pending) {
        nav.drop()
      }
    }
    // claimed / 停滞：capture/commit/drop 都不动（菜单仲裁中间态，已省略）。
    prevPhase.current = p
  }, [phase, draft, nav])

  // ---- panel 打开时聚焦落在面板内 → isComposerTarget 为 false，方向键放行 ----

  // ---- cwd（指令发现用）：从会话快照 byId 取 ----
  const cwd = sessionId === undefined ? undefined : snapshot.byId[sessionId]?.cwd

  // ---- 渲染：按钮 +（面板） ----
  return createElement(
    'div',
    { className: 'dsh-ct-entry', style: { display: 'inline-flex', alignItems: 'center' } },
    createElement(
      'button',
      {
        type: 'button',
        className: 'dsh-ct-entry-btn',
        title: '指令 / 提示词',
        onClick: () => setOpen((o) => !o),
      },
      createElement('span', { children: '指令/提示词' }),
    ),
    open
      ? createPortal(
          createElement(Panel, {
            cwd,
            currentDraft: draft,
            setDraft: (text) => inputActions.setDraft(text),
            onClose: () => setOpen(false),
          }),
          // Portal 到 body：面板必须脱离 composerStack（其祖先 z-index:1 创建了
          // stacking context，会把面板的 2147483100 限制在上下文内部，导致被
          // explorer 侧栏的 fixed+z:50 盖住）。挂 body 后面板在根 stacking
          // context，z-index 直接与侧栏竞争。
          document.body,
        )
      : null,
  )
}
