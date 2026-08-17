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
 *
 * Host index wiring (this feature): on attach and whenever the snapshot's
 * turn fingerprint grows, the full turn index is fetched through
 * `ctx.connection.rpc` (`loadTurnIndex`) and handed to the rail as the render
 * skeleton. A fetched index is only applied when its `sessionId` still matches
 * the currently bound session (重要 3), so a stale cross-session response can
 * never paint the wrong rail. Teardown cancels in-flight load loops and drops
 * the session's cached index.
 */
import { Component, createElement, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { Context, SessionFace, TurnIndexResult } from './context-types.ts'
import { TurnRail } from './TurnRail.tsx'
import { cancelTurnLoads, cancelAllTurnLoads } from './ensureTurnLoaded.ts'
import { clearTurnIndexCache, indexFingerprint, loadTurnIndex, resetTurnIndexCache } from './hostIndex.ts'

/** Services required before mounting (provided by the client runtime). */
export const inject = ['sessions', 'connection']

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
  const connection = ctx.connection

  let root: Root | null = null
  let mountEl: HTMLDivElement | null = null
  let scrollport: HTMLElement | null = null
  let boundSessionId: string | undefined
  /** The session face currently bound (for cancel/teardown of load loops). */
  let boundSession: SessionFace | undefined
  /** Latest host index applied to the rail (null = degrade to loaded-only). */
  let hostIndex: TurnIndexResult | null = null
  /** Last fingerprint we fetched the index for (skip identical refetches). */
  let fetchedFingerprint = ''
  /** Opaque token tied to the bound session — passed to ensureTurnLoaded. */
  let sessionToken: unknown = undefined
  /** Session snapshot subscription (fingerprint growth → refresh index). */
  let offSnapshot: (() => void) | null = null
  let lastAttachAttempt = 0

  const renderRail = (): void => {
    if (root === null || mountEl === null || scrollport === null || boundSession === undefined) return
    root.render(
      createElement(RailBoundary, null,
        createElement(TurnRail, { session: boundSession, scrollport, hostIndex, token: sessionToken })),
    )
  }

  /**
   * Fetch the host index for the bound session and apply it only when it still
   * matches the current binding (重要 3). Failures leave `hostIndex = null`
   * (rail degrades to loaded-only, INTERFACE §2.5).
   */
  const refreshHostIndex = async (): Promise<void> => {
    if (boundSessionId === undefined || boundSession === undefined) return
    const fingerprint = indexFingerprint(boundSession.snapshotCache.chat)
    if (fingerprint === fetchedFingerprint) return
    fetchedFingerprint = fingerprint
    const sessionId = boundSessionId
    const result = await loadTurnIndex(connection, sessionId, boundSession.snapshotCache.chat)
    // Only apply if the session did not switch while we were fetching.
    if (boundSessionId !== sessionId) return
    hostIndex = result
    console.log(`[dsh-turn-scrubber] hostIndex applied: ${hostIndex === null ? 'null (degrade)' : `total=${hostIndex.value.total}`}`)
    renderRail()
  }

  /** Subscribe to snapshot changes: new turns grow the fingerprint → refresh. */
  const watchSnapshot = (session: SessionFace): void => {
    offSnapshot?.()
    offSnapshot = session.subscribe(() => {
      // Cheap fingerprint check; loadTurnIndex is cached per fingerprint, so
      // window growth (loadOlder) re-fetches the same stable host index.
      void refreshHostIndex()
    })
  }

  const teardown = (reason: string): void => {
    if (boundSession !== undefined) cancelTurnLoads(boundSession)
    if (boundSessionId !== undefined) clearTurnIndexCache(boundSessionId)
    offSnapshot?.()
    offSnapshot = null
    root?.unmount()
    root = null
    mountEl?.remove()
    mountEl = null
    scrollport = null
    boundSession = undefined
    boundSessionId = undefined
    hostIndex = null
    fetchedFingerprint = ''
    sessionToken = undefined
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
    boundSession = session
    sessionToken = {} // fresh per binding: session switch invalidates loops
    root = createRoot(mountEl)
    renderRail()
    watchSnapshot(session)
    void refreshHostIndex()
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
    cancelAllTurnLoads()
    resetTurnIndexCache()
    offList()
    mo.disconnect()
  }, 'dsh-turn-scrubber: rail lifecycle')
}