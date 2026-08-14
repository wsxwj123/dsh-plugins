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
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { Context } from './context-types.ts'
import { pendingDeletes } from './pendingDeletes.ts'
import { createDeleteController, reconcileFromDom, SESSIONS_LIST_SEL } from './DeleteButton.tsx'
import { UndoRail } from './UndoRail.tsx'
import { ArchiveEntry } from './ArchiveEntry.tsx'
import { ArchiveView } from './ArchiveView.tsx'

/** Services required before mounting (provided by the client runtime). */
export const inject = ['sessions', 'workspaces', 'slots']

/** The footer action list-cell id (PLAN §9.3: additive, unique). */
const FOOTER_ACTION_ID = 'dsh-session-manager'

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
      // the row and handles the countdown/undo.
      pendingDeletes.requestDelete(action.id, action.cwd, action.title)
    },
  )

  /** Hide/restore rows whose ids are parked vs active in the park table. The
   *  DOM is reconciled fresh so a row re-created after a group collapse stays
   *  hidden for its remaining window. */
  const reconcileVisibility = (): void => {
    for (const [id, row] of controller.rowById.entries()) {
      if (!row.isConnected) continue
      const entry = pendingDeletes.get(id)
      // Hidden only while an UNDOABLE pending window is open; a failed fire
      // (entry gone or failed) restores the row (INTERFACE §1.4).
      const hide = entry?.state === 'pending'
      const current = row.style.display
      if (hide && current !== 'none') row.style.display = 'none'
      if (!hide && current === 'none') row.style.display = ''
    }
    // Catch rows created after a collapse/re-expand that are not in rowById yet.
    const container = document.querySelector<HTMLElement>(SESSIONS_LIST_SEL)
    if (container) {
      reconcileFromDom(container, ctx.sessions.list.getSnapshot().byId, (row, action) => {
        const entry = pendingDeletes.get(action.id)
        const shouldHide = entry?.state === 'pending'
        if (shouldHide && row.style.display !== 'none') row.style.display = 'none'
        if (!shouldHide && row.style.display === 'none') row.style.display = ''
      })
    }
  }

  /** Clear selection if the deleted session was the current one (A-5). */
  const reconcileSelection = (): void => {
    const current = ctx.sessions.list.getSnapshot().current
    if (current === undefined) return
    if (pendingDeletes.isPending(current)) ctx.sessions.clear()
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
      createElement(UndoRail),
      createElement(ArchiveView, { ctx, sessionsFeed: ctx.sessions.list, workspacesFeed: ctx.workspaces.list }),
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
