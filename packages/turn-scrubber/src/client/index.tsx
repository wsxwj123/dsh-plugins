/**
 * Client half of dsh-turn-scrubber: mounts the waveform turn rail onto the
 * right edge of the active conversation view.
 *
 * The rail reads the runtime session store (`ctx.sessions.list` for the
 * active session id, `ctx.sessions.binding(id).session` for the live chat
 * snapshot) and anchors its bars to the conversation's native
 * `[data-chat-anchor-key]` rows inside the `[data-conversation-scroll]`
 * scrollport. It re-mounts when the active session changes and when the
 * conversation DOM is replaced.
 */
import { Component, createElement, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { Context } from './context-types.ts'
import { TurnRail } from './TurnRail.tsx'

/** Services required before mounting (provided by the client runtime). */
export const inject = ['sessions']

/** Minimum delay between DOM-recovery attach attempts (cheap guard). */
const ATTACH_COOLDOWN_MS = 300

/**
 * Error boundary over the rail: a render failure must never blank silently —
 * it shows a dismissible strip and logs the stack.
 */
class RailBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state = { error: null as string | null }

  static getDerivedStateFromError(error: unknown): { error: string } {
    return { error: error instanceof Error ? error.message : String(error) }
  }

  componentDidCatch(error: Error, info: unknown): void {
    console.error('[dsh-turn-scrubber] rail render crash:', error, info)
  }

  render(): ReactNode {
    if (this.state.error !== null) {
      return (
        <div style={{
          position: 'absolute', right: 4, top: 8, zIndex: 2147483000,
          maxWidth: 220, padding: '6px 10px', borderRadius: 8,
          background: 'rgba(120,20,20,.92)', color: '#ffd9d9',
          font: '11px/1.5 ui-monospace,Menlo,monospace',
        }}>
          dsh-turn-scrubber: {this.state.error}
        </div>
      )
    }
    return this.props.children
  }
}

export function apply(ctx: Context): void {
  const sessions = ctx.sessions

  let root: Root | null = null
  let mountEl: HTMLDivElement | null = null
  let scrollport: HTMLElement | null = null
  let boundSessionId: string | undefined
  let lastAttachAttempt = 0

  const teardown = (reason: string): void => {
    console.warn(`[dsh-turn-scrubber] teardown: ${reason}`)
    root?.unmount()
    root = null
    mountEl?.remove()
    mountEl = null
    scrollport = null
    boundSessionId = undefined
  }

  /** Attach (or re-attach) the rail for the given session. Returns false if the DOM/session is not ready. */
  const attach = (sessionId: string): boolean => {
    if (root !== null && scrollport?.isConnected && boundSessionId === sessionId) return true
    teardown(`re-attach for session "${sessionId}"`)
    const sp = document.querySelector<HTMLElement>('[data-conversation-scroll]')
    if (!sp) {
      console.warn('[dsh-turn-scrubber] attach skipped: no [data-conversation-scroll] yet')
      return false
    }
    const session = sessions.binding(sessionId)?.session
    if (!session) {
      console.warn(`[dsh-turn-scrubber] attach skipped: no session binding for "${sessionId}"`)
      return false
    }
    const parent = sp.parentElement
    if (!parent) return false
    // The rail must be positioned against the conversation root: make sure
    // it is a containing block (static → relative changes nothing visually).
    if (getComputedStyle(parent).position === 'static') {
      parent.style.position = 'relative'
    }
    mountEl = document.createElement('div')
    mountEl.style.cssText =
      'position:absolute;right:0;top:0;bottom:0;width:18px;z-index:45;pointer-events:none'
    parent.appendChild(mountEl)
    scrollport = sp
    boundSessionId = sessionId
    root = createRoot(mountEl)
    root.render(createElement(RailBoundary, null, createElement(TurnRail, { session, scrollport: sp })))
    console.log(`[dsh-turn-scrubber] mounted for session "${sessionId}"`)
    return true
  }

  const sync = (): void => {
    const current = sessions.list.getSnapshot().current
    if (current === undefined) return
    const now = Date.now()
    if (now - lastAttachAttempt < ATTACH_COOLDOWN_MS) return
    lastAttachAttempt = now
    attach(current)
  }

  // Re-attach when the active session switches.
  const offList = sessions.list.subscribe(sync)

  // Re-attach when the conversation DOM appears/disappears (view mount,
  // session switch, details panel changes). The check is O(1) per mutation.
  const mo = new MutationObserver(() => {
    if (scrollport !== null && !scrollport.isConnected) {
      teardown('scrollport detached')
      sync()
      return
    }
    if (root === null) sync()
  })
  mo.observe(document.body, { childList: true, subtree: true })

  sync()

  ctx.effect(() => () => {
    teardown('fiber dispose')
    offList()
    mo.disconnect()
  }, 'dsh-turn-scrubber: rail lifecycle')
}
