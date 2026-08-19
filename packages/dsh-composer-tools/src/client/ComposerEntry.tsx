/**
 * ComposerEntry — slot entry 组件（conversation.input.right，id: dsh-composer-tools）。
 *
 * 职责（PLAN §1.3 / INTERFACE §3 / T8）：
 *   1. 按钮：点击开关面板，标题「指令/提示词」带图标。面板在本组件内渲染（composer
 *      内 position fixed），不另开 createRoot overlay。
 *   2. 方向键历史：useEffect 挂 `document.addEventListener('keydown', fn, true)`
 *      capture 监听。isComposerTarget 判定（e.target 是本 composer textarea，DOM
 *      锚点：textarea 带 data-phase，容器有 data-input-scroll/backdrop/mirror）；
 *      menuOpen 判定（data-phase 存在且 !== 'plain'；属性读不到 → menuOpen=true
 *      fail-safe，SPIKE-T0 ③）。命中 gate → preventDefault + stopPropagation +
 *      HistoryNav 回填。cleanup 摘监听。
 *   3. 发送采集（主路径）：订阅当前会话的快照，新落地的 user 消息文本即历史条目
 *      （session-history.ts 水位线 diff）。普通消息 phase 恒为 plain、发送按钮
 *      点击没有 keydown，只有快照覆盖得全。
 *   4. 发送采集（斜杠命令路径，保留）：useInput 的 phase 进 submitting/
 *      adjudicating 时 draft 未清 → capturePending；draft 变 '' → commitPending；
 *      phase 回 plain 且 draft 恢复 pending 原文（发送失败）→ dropPending。
 *      claimed 不动。斜杠命令在快照里是 CommandNode，主路径采不到，故两条并存。
 */
import { createElement, useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { Context, InputActions, InputPhase, InputSelection } from './context-types.ts'
import { createHistoryNav, type HistoryNavController } from './HistoryNav.ts'
import { Panel } from './Panel.tsx'
import { createSnapshotCapture } from './session-history.ts'
import './panel.css'

interface EntryProps {
  ctx: Context
  /** slot standard props: conversation session-scope provide channel. */
  useInput: (selector: (s: InputSelection) => unknown) => unknown
  inputActions: InputActions
  /** owner props（ignore，仅类型留位）。 */
  wide?: boolean
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any
}

/** DOM 锚点：本 composer 的 textarea 带 data-phase 属性。 */
function isComposerTextarea(el: EventTarget | null): el is HTMLTextAreaElement {
  const ta = el as HTMLTextAreaElement | null
  return !!ta && ta.tagName === 'TEXTAREA' && ta.hasAttribute('data-phase')
}

/**
 * menuOpen 判定（INTERFACE §3，SPIKE-T0 ③）：
 * 判定 = data-phase 存在且 !== 'plain'（含 'inert' 无会话态，均非 plain）。
 * 属性读不到（不存在/空串/元素取不到）→ 一律按 menuOpen=true（fail-safe，
 * 宁可历史失效不抢命令菜单的 ↑/↓）。
 */
function readMenuOpen(ta: HTMLTextAreaElement): boolean {
  const attr = ta.getAttribute('data-phase')
  if (attr === null || attr === '') return true
  return attr !== 'plain'
}

export function ComposerEntry(props: EntryProps): ReactNode {
  const ctx = props.ctx
  const inputActions = props.inputActions

  // ---- 会话快照（sessionId + cwd） ----
  const snapshot = ctx.sessions.list.getSnapshot()
  const sessionId = snapshot.current

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
      focusTextarea: () => {
        const ta = document.activeElement as HTMLTextAreaElement | null
        return ta && isComposerTextarea(ta) ? ta : null
      },
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
      const ta = document.activeElement as HTMLTextAreaElement | null
      const isComposerTarget = isComposerTextarea(ta)
      let menuOpen = false
      if (isComposerTarget) {
        menuOpen = readMenuOpen(ta as HTMLTextAreaElement)
      }
      const hit = nav.onKeydown(e, isComposerTarget, menuOpen)
      if (hit) {
        e.preventDefault()
        e.stopPropagation()
      }
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [nav])

  // ---- 手动编辑检测：textarea 的 input 事件 ----
  useEffect(() => {
    const onInput = (e: Event): void => {
      const ta = e.target as HTMLTextAreaElement | null
      if (!isComposerTextarea(ta)) return
      nav.onInput(ta.value)
    }
    document.addEventListener('input', onInput, true)
    return () => document.removeEventListener('input', onInput, true)
  }, [nav])

  // ---- 发送采集主路径：订阅会话快照，新落地的 user 消息即历史条目 ----
  // phase 机对普通消息永远不触发（onEnter 走 default-sink，phase 恒 plain），
  // 且发送按钮点击根本没有 keydown —— 只有快照能覆盖全部已受理的发送。
  useEffect(() => {
    if (sessionId === undefined) return
    const capture = createSnapshotCapture((text) => {
      nav.record(text)
    })
    let offSession: (() => void) | null = null
    const attach = (): void => {
      if (offSession !== null) return
      const session = ctx.sessions.binding?.(sessionId)?.session
      if (session === undefined || session === null) return
      const pump = (): void => {
        capture.onSnapshot(session.getSnapshot()?.nodes)
      }
      pump() // 首帧只初始化水位线（已在窗口里的旧消息不回补）
      offSession = session.subscribe(pump)
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
