/**
 * Client half of dsh-session-manager.
 *
 * Responsibilities (PLAN §4 T4/T5):
 *   1. DOM-inject a hover-revealed delete button into every session row and
 *      reconcile row visibility against the module-scope deferred-delete queue.
 *   2. Mount a fixed UndoRail overlay that survives view/panel switches.
 *   3. Register a `sidebar.footer.action` entry (「归档」) and mount the archive
 *      overlay it opens.
 *   4. Clear the current selection when the selected session is deleted
 *      (INTERFACE §1.4 / A-5).
 *
 * Cordis access discipline: every service read is covered by `export const
 * inject` (sessions/workspaces/slots). No bare read of an un-declared service.
 */
import { createElement, Component, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { Context } from './context-types.ts'
import { pendingDeletes } from './pendingDeletes.ts'
import { createDeleteController } from './DeleteButton.tsx'
import { UndoRail } from './UndoRail.tsx'
import { ArchiveEntry } from './ArchiveEntry.tsx'
import { ArchiveView } from './ArchiveView.tsx'

/** Services required before mounting (provided by the client runtime). */
export const inject = ['sessions', 'workspaces', 'slots']

/** The footer action list-cell id (PLAN §9.3: additive, unique). */
const FOOTER_ACTION_ID = 'dsh-session-manager'

/**
 * Error boundary over the fixed overlays. A render crash (e.g. an archive-view
 * subscription/field mismatch) must NOT silently do nothing — it logs the
 * stack and shows a dismissible strip instead of blanking the undo rail.
 */
class OverlayBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state = { error: null as string | null }

  static getDerivedStateFromError(error: unknown): { error: string } {
    return { error: error instanceof Error ? error.message : String(error) }
  }

  componentDidCatch(error: Error, info: unknown): void {
    console.error('[dsh-session-manager] overlay render crash:', error, info)
  }

  render(): ReactNode {
    if (this.state.error !== null) {
      return createElement(
        'div',
        {
          style: {
            position: 'absolute', left: 12, bottom: 110, zIndex: 2147483000, padding: '8px 12px',
            borderRadius: 10, background: 'rgba(120,20,20,.94)', color: '#ffd9d9',
            font: '12px/1.5 ui-monospace,Menlo,monospace', pointerEvents: 'auto', maxWidth: 340,
          },
        },
        `dsh-session-manager UI 异常：${this.state.error}`,
        createElement(
          'button',
          { type: 'button', onClick: () => this.setState({ error: null }), style: { marginLeft: 8, border: 'none', background: 'none', color: '#ffd9d9', cursor: 'pointer' } },
          '重试',
        ),
      )
    }
    return this.props.children
  }
}

export function apply(ctx: Context): void {
  // ---- Archive entry in the sidebar footer (slots.register into a list slot). ---
  // The slot renders `{ wide }`; we pass the ctx so ArchiveEntry can toggle the
  // shared archive-open store. React-root mounting for the overlay happens below.
  const disposeSlot = ctx.slots.register(
    { name: 'sidebar.footer.action', id: FOOTER_ACTION_ID, order: 1000 },
    // The registrant component receives owner props `{ wide }`; we ignore wide
    // here but pass ctx via closure.
    (props: { wide: boolean }) => createElement(ArchiveEntry, { ctx, wide: props.wide }),
  )

  // ---- Delete-button injection + row visibility reconciliation. ----
  const controller = createDeleteController(
    () => ctx,
    (action, row) => {
      // Park the deferred deletion; the pendingDeletes subscription below hides
      // the row and handles the countdown/undo. Multi-entry is allowed (P9); a
      // false return only means this identical id already has a window.
      const parked = pendingDeletes.requestDelete(action.id, action.cwd, action.title)
      console.debug('[dsh-session-manager] delete click -> requestDelete=', parked, 'id=', action.id, 'cwd=', action.cwd)
    },
  )

  /** Hide/restore rows whose ids are parked vs active in the park table.
   *  `rowById` is maintained by the injection controller (each injected button
   *  records the row keyed by session id), so a row re-created after a group
   *  re-render is re-injected — and therefore re-hidden — on the next sync. */
  const reconcileVisibility = (): void => {
    for (const [id, row] of controller.rowById.entries()) {
      if (!row.isConnected) continue
      const entry = pendingDeletes.get(id)
      // Keep the row hidden while its deletion is UNDOABLE (pending) OR CONFIRMED
      // (host moved the dir; the client list still shows the id until a re-pull).
      // A failed fire (entry gone or failed) restores the row (INTERFACE §1.4).
      const hide = entry?.state === 'pending' || pendingDeletes.isDeleted(id)
      const current = row.style.display
      if (hide && current !== 'none') row.style.display = 'none'
      if (!hide && current === 'none') row.style.display = ''
    }
  }

  /** Clear selection once the CURRENT session's delete has CONFIRMED on the
   *  host (fire-success), restoring the default New-Session view. This also
   *  covers an open-but-idle session removed by a force-delete. We do NOT yank
   *  the user off the session during the undoable/confirm window — only on
   *  confirmed deletion (so an un-confirmed / undone delete keeps them on it). */
  const reconcileSelection = (): void => {
    const current = ctx.sessions.list.getSnapshot().current
    if (current === undefined) return
    if (pendingDeletes.isDeleted(current)) ctx.sessions.clear()
  }

  const offPending = pendingDeletes.subscribe(() => {
    reconcileVisibility()
    reconcileSelection()
  })

  // Re-sync injected buttons when the session list or its DOM changes.
  const offList = ctx.sessions.list.subscribe(() => controller.sync())
  const sync = (): void => {
    controller.sync()
    reconcileVisibility()
  }
  const mo = new MutationObserver(sync)
  mo.observe(document.body, { childList: true, subtree: true })

  // ---- Fixed overlays (UndoRail + ArchiveView) appended to body. ----
  const mount = document.createElement('div')
  mount.setAttribute('data-dsh-session-manager-overlays', 'true')
  mount.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:2147483000'
  document.body.appendChild(mount)
  const overlays: Root = createRoot(mount)
  overlays.render(
    createElement('div', { style: { pointerEvents: 'none' } },
      createElement(OverlayBoundary, null,
        createElement(UndoRail),
        createElement(ArchiveView, { ctx, sessionsFeed: ctx.sessions.list, workspacesFeed: ctx.workspaces.list }),
      ),
    ),
  )

  sync()

  ctx.effect(() => () => {
    disposeSlot()
    offPending()
    offList()
    mo.disconnect()
    overlays.unmount()
    mount.remove()
  }, 'dsh-session-manager: client lifecycle')
}
