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
import { useEffect, useState, useSyncExternalStore } from 'react'
import {
  type Context,
  type SessionListFeed,
  type WorkspacesListFeed,
  type SessionSummary,
} from './context-types.ts'
import { pendingDeletes, type PendingEntry } from './pendingDeletes.ts'
import { setArchiveOpen, getArchiveOpen, subscribeArchive } from './archiveState.ts'
import { smTrash, smUnarchive, smEmptyTrash } from './bridge.ts'
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

  // Recycle-bin entry count for the 「清空回收站」 control. Refreshed on open and
  // after each empty so the count/disabled state tracks the host truth.
  const [trashCount, setTrashCount] = useState<number | null>(null)
  const [trashError, setTrashError] = useState<string | null>(null)
  useEffect(() => {
    if (!open) return
    let cancelled = false
    void smTrash().then((res) => {
      if (cancelled) return
      if (res.ok) setTrashCount(Array.isArray(res.items) ? res.items.length : 0)
      else setTrashError(`读取回收站失败：${res.code ?? res.message ?? 'unknown'}`)
    })
    return () => {
      cancelled = true
    }
  }, [open])

  if (!open) return null

  /** Confirm-then-empty the recycle bin (unrecoverable) — defined in-component
   *  so it captures the trash state setters. `window.confirm` is a genuine
   *  modal; we call /sm/emptyTrash with confirm:true on confirmation. Failures
   *  are surfaced, never swallowed; the count is re-read so the UI re-syncs. */
  const onEmptyTrash = async (count: number): Promise<void> => {
    const ok = window.confirm(`将永久删除回收站中的 ${count} 个会话，此操作不可撤销。确定继续？`)
    if (!ok) return
    const res = await smEmptyTrash(true)
    if (!res.ok) {
      setTrashError(`清空回收站失败：${res.code ?? res.message ?? 'unknown'}`)
      return
    }
    setTrashError(null)
    const t = await smTrash()
    if (t.ok) {
      setTrashCount(Array.isArray(t.items) ? t.items.length : 0)
    }
  }

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

  // The empty-trash control is enabled only when the recycle bin actually holds
  // entries (count known non-zero); a disabled button avoids misleading a user
  // into a confirm-with-nothing flow (TEST-PLAN B6).
  const canEmpty = trashCount !== null && trashCount > 0
  const countLabel = trashCount === null
    ? '回收站：未知'
    : trashCount > 0
      ? `${trashCount} 个已删除会话`
      : '回收站为空'
  const trashBar = createElement(
    'div',
    { className: css.trashBar },
    createElement(
      'button',
      {
        type: 'button',
        className: css.trashButton,
        disabled: !canEmpty,
        title: canEmpty ? `永久删除回收站中的 ${trashCount} 个会话` : '回收站为空',
        onClick: () => {
          void onEmptyTrash(canEmpty ? trashCount as number : 0)
        },
      },
      '清空回收站',
    ),
    createElement('span', { className: css.trashCount }, countLabel),
  )

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
    trashError && createElement('div', { className: css.errorBanner, role: 'alert' }, trashError),
    body,
    trashBar,
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
