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
import { createElement, Fragment, type ReactNode } from 'react'
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

  // Recycle-bin entry count for the 「清空回收站」 control. Refreshed on open AND
  // whenever the pending-delete table changes while open (a fired delete moves a
  // session into the recycle bin → count grows; undo/failure leave it unchanged
  // but re-reading keeps it honest). The error banner (`error`) surfaces EVERY
  // host failure visibly — read, empty, unarchive — never silently (review
  // I-5), and any read SUCCESS clears a previous banner (S-11).
  const [trashCount, setTrashCount] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!open) return
    let cancelled = false
    void smTrash()
      .then((res) => {
        if (cancelled) return
        if (res.ok) {
          setTrashCount(Array.isArray(res.items) ? res.items.length : 0)
          // S-11: a previous read failure must not stick — the first success
          // after any failure clears the banner.
          setError(null)
          // S-10: re-align the hidden-rows set with the host trash every time
          // we re-read it (open / re-open). A restored or cleared session must
          // not stay hidden forever (ghost row).
          if (Array.isArray(res.items)) {
            pendingDeletes.reconcileWithTrash(
              (res.items as Array<{ id?: unknown }>)
                .map((i) => i.id)
                .filter((id): id is string => typeof id === 'string'),
            )
          }
        } else setError(`读取回收站失败：${res.code ?? res.message ?? 'unknown'}`)
      })
      .catch((err) => {
        // I-5 belt-and-suspenders: even if the bridge ever rejects again, the
        // failure stays visible instead of an unhandled rejection.
        if (!cancelled) setError(`读取回收站失败：${err instanceof Error ? err.message : String(err)}`)
      })
    return () => {
      cancelled = true
    }
  }, [open, pending])

  if (!open) return null

  /** Confirm-then-empty the recycle bin (unrecoverable) — defined in-component
   *  so it captures the trash state setters. `window.confirm` is a genuine
   *  modal; we call /sm/emptyTrash with confirm:true on confirmation. Failures
   *  are surfaced, never swallowed; the count is re-read so the UI re-syncs.
   *  The try/catch guarantees no await-site rejection escapes as unhandled
   *  (I-5). */
  const onEmptyTrash = async (count: number): Promise<void> => {
    const ok = window.confirm(`将永久删除回收站中的 ${count} 个会话，此操作不可撤销。确定继续？`)
    if (!ok) return
    try {
      const res = await smEmptyTrash(true)
      if (!res.ok) {
        setError(`清空回收站失败：${res.code ?? res.message ?? 'unknown'}`)
        return
      }
      setError(null)
      const t = await smTrash()
      if (t.ok) {
        setTrashCount(Array.isArray(t.items) ? t.items.length : 0)
        // S-10: after emptying, the host trash holds nothing — any id still
        // flagged deleted has no backing record and must stop hiding its row
        // (the next list re-pull drops the now-gone session entirely).
        if (Array.isArray(t.items)) {
          pendingDeletes.reconcileWithTrash(
            (t.items as Array<{ id?: unknown }>)
              .map((i) => i.id)
              .filter((id): id is string => typeof id === 'string'),
          )
        }
      } else {
        setError(`读取回收站失败：${t.code ?? t.message ?? 'unknown'}`)
      }
    } catch (err) {
      setError(`清空回收站失败：${err instanceof Error ? err.message : String(err)}`)
    }
  }

  /** Remove a session id from the archive set via /sm/unarchive. Failures are
   *  surfaced on the error banner (never silently logged away — I-5) and we
   *  fall back to a host re-pull (PLAN §5.1 risk 4 sub-state B) so a missed
   *  broadcast still converges. The row stays visible. */
  const onUnarchive = async (id: string): Promise<void> => {
    try {
      const res = await smUnarchive(id)
      if (!res.ok) {
        setError(`取消归档失败：${res.code ?? res.message ?? 'unknown'}`)
        void ctx.workspaces.refresh()
      }
    } catch (err) {
      setError(`取消归档失败：${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const byId = sessionsSnap.byId
  // Hide rows only while their deferred-delete window is UNDOABLE (pending). A
  // failed fire leaves row hidden neither here nor in the main list — the
  // session reappears (INTERFACE §2.4). CONFIRMED deletions stay hidden too.
  const parked = new Set(pending.filter((e) => e.state === 'pending').map((e) => e.id))
  const rows: ArchivedRow[] = []
  for (const id of workspacesSnap.archivedSessionIds) {
    const s = byId[id]
    if (!s || s.blank) continue
    if (parked.has(id) || pendingDeletes.isDeleted(id)) continue
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
          createElement('div', { className: css.rowTitle }, row.title ?? row.displayTitle),
          createElement(
            'button',
            { type: 'button', className: css.action, onClick: () => void onUnarchive(row.id) },
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
    Fragment,
    null,
    // Backdrop: click outside the panel closes the archive view (P5). It is a
    // full-viewport transparent layer BELOW the panel; panel clicks never reach
    // it because the panel (higher z-index) sits on top.
    createElement('div', {
      className: css.backdrop,
      'aria-hidden': true,
      onClick: () => setArchiveOpen(false),
    }),
    createElement(
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
      error && createElement('div', { className: css.errorBanner, role: 'alert' }, error),
      body,
      trashBar,
    ),
  )
}

/** Park a deferred delete for an archived session (host two-step on fire).
 *  Multi-entry allowed (P9); a false return only means the id is already parked. */
function requestArchivedDelete(_ctx: Context, row: ArchivedRow): void {
  const label = row.title ?? row.displayTitle
  pendingDeletes.requestDelete(row.id, row.cwd, label)
}
