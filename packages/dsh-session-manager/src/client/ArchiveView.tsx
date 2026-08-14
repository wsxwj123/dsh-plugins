/**
 * ArchiveView — the overlay listing archived sessions, opened by the footer
 * 「归档」 entry. Each row offers 「取消归档」 and 「删除」.
 *
 * Data (INTERFACE §2.2/§2.5): archived rows = `workspaces.list.archivedSessionIds`
 * ∩ `sessions.list.byId` (metadata persists in byId even though the official
 * list filters them out visually). Dangling ids (byId gone) are hidden, never
 * rendered as ghosts.
 *
 * Delete of an archived session rides the same recycle-bin/undo flow as a
 * normal-list deletion (host does the two-step move + archive-set cleanup).
 * Rows whose id is currently parked for deletion are hidden from this list;
 * a failed fire un-parks them and they reappear.
 */
import { createElement, type ReactNode } from 'react'
import { useSyncExternalStore } from 'react'
import {
  type Context,
  type SessionListFeed,
  type WorkspacesListFeed,
  type SessionSummary,
} from './context-types.ts'
import { pendingDeletes, type PendingEntry } from './pendingDeletes.ts'
import { setArchiveOpen, getArchiveOpen, subscribeArchive } from './archiveState.ts'
import { smUnarchive } from './bridge.ts'
import css from './rail.module.css'

type ArchivedRow = SessionSummary & { id: string }

const selectPending = (): PendingEntry[] => pendingDeletes.snapshot()
const subscribePending = (l: () => void): (() => void) => pendingDeletes.subscribe(l)
const selectOpen = (): boolean => getArchiveOpen()
const subscribeOpen = (l: () => void): (() => void) => subscribeArchive(l)

export function ArchiveView({
  ctx,
  sessionsFeed,
  workspacesFeed,
}: {
  ctx: Context
  sessionsFeed: SessionListFeed
  workspacesFeed: WorkspacesListFeed
}): ReactNode {
  const open = useSyncExternalStore(subscribeOpen, selectOpen, selectOpen)
  const pending = useSyncExternalStore(subscribePending, selectPending, selectPending)
  const sessionsSnap = useSyncExternalStore(
    (l) => sessionsFeed.subscribe(l),
    () => sessionsFeed.getSnapshot(),
    () => sessionsFeed.getSnapshot(),
  )
  const workspacesSnap = useSyncExternalStore(
    (l) => workspacesFeed.subscribe(l),
    () => workspacesFeed.getSnapshot(),
    () => workspacesFeed.getSnapshot(),
  )

  if (!open) return null

  const byId = sessionsSnap.byId
  // Hide rows only while their deferred-delete window is UNDOABLE (pending). A
  // failed fire leaves row hidden neither here nor in the main list — the
  // session reappears (INTERFACE §2.4).
  const parked = new Set(pending.filter((e) => e.state === 'pending').map((e) => e.id))
  const rows: ArchivedRow[] = []
  for (const id of workspacesSnap.archivedSessionIds) {
    const s = byId[id]
    if (!s || s.blank || parked.has(id)) continue
    rows.push({ ...s, id })
  }

  let body: ReactNode
  if (rows.length === 0) {
    body = createElement('div', { className: css.empty }, '暂无归档会话')
  } else {
    body = createElement(
      'div',
      { className: css.list },
      rows.map((row) =>
        createElement(
          'div',
          { key: row.id, className: css.row },
          createElement('div', { className: css.rowTitle }, row.displayTitle),
          createElement(
            'button',
            { type: 'button', className: css.action, onClick: () => void unarchive(ctx, row.id) },
            '取消归档',
          ),
          createElement(
            'button',
            {
              type: 'button',
              className: css.danger,
              // Same deferred-delete flow as a normal-list deletion.
              onClick: () => requestArchivedDelete(ctx, row),
            },
            '删除',
          ),
        ),
      ),
    )
  }

  return createElement(
    'div',
    { className: css.overlay, role: 'dialog', 'aria-label': '归档会话' },
    createElement(
      'div',
      { className: css.head },
      createElement('span', null, '归档'),
      createElement(
        'button',
        { type: 'button', className: css.close, 'aria-label': '关闭归档视图', onClick: () => setArchiveOpen(false) },
        '✕',
      ),
    ),
    body,
  )
}

/** Remove a session id from the archive set via /sm/unarchive. */
async function unarchive(ctx: Context, id: string): Promise<void> {
  const res = await smUnarchive(id)
  if (!res.ok) {
    // Do not swallow the failure: surface it and fall back to a host re-pull
    // (PLAN §5.1 risk 4 sub-state B) so a missed broadcast still converges.
    // The row stays visible; the error is clearly logged for the user.
    void ctx.workspaces.refresh()
    console.error('[dsh-session-manager] 取消归档失败：', res.code ?? res.message)
  }
  // On success the host broadcasts or the workspace feed re-pulls; either path
  // updates archivedSessionIds and this list re-renders.
}

/** Park a deferred delete for an archived session (host two-step on fire). */
function requestArchivedDelete(_ctx: Context, row: ArchivedRow): void {
  pendingDeletes.requestDelete(row.id, row.cwd, row.displayTitle)
}
