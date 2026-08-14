/**
 * UndoRail — the fixed bottom overlay that surfaces deferred deletions.
 *
 * Reads the module-scope `pendingDeletes` park table through
 * `useSyncExternalStore`, so the rail re-mounts anywhere (it is appended to
 * `document.body`, never unmounted on view switch) and always reflects the
 * same module state the countdown timers live in — switching panels neither
 * resets nor drops a countdown (INTERFACE §1.2 step 3).
 *
 * Three entry kinds:
 *   - pending (undoable): title + seconds remaining, with an Undo button.
 *   - failed (retain window): an error readout; the session is already
 *     re-shown. Failed entries are auto-cleared by the state machine after
 *     a short window, so no manual dismissal is needed here.
 *   - cleanup (partial failure, review I-3): the file was moved but archive
 *     cleanup is incomplete — the row stays hidden and a Retry button
 *     re-invokes the host delete to complete it (INTERFACE §2.4).
 */
import { createElement, type CSSProperties, type ReactNode } from 'react'
import { useEffect, useState, useSyncExternalStore } from 'react'
import { pendingDeletes, type PendingEntry } from './pendingDeletes.ts'
import css from './rail.module.css'

const getSnapshot = (): PendingEntry[] => pendingDeletes.snapshot()
const subscribe = (listener: () => void): (() => void) => pendingDeletes.subscribe(listener)

/** Countdown tick cadence: re-renders the rail so `Date.now()`-derived seconds refresh. */
const TICK_MS = 500

/** One entry row. `now` is passed by the parent tick so all rows share a clock. */
function EntryRow({ entry, now }: { entry: PendingEntry; now: number }): ReactNode {
  if (entry.state === 'failed') {
    return createElement(
      'div',
      { className: css.item },
      createElement(
        'span',
        {
          className: css.failed,
          title: entry.error ? `删除失败：${entry.error}` : '删除失败',
        },
        `「${entry.title}」删除失败，已恢复`,
      ),
    )
  }
  if (entry.state === 'cleanup') {
    // Partial failure (review I-3): the file was moved but the archive-set
    // cleanup is incomplete. The row stays hidden; the retry re-invokes the
    // host delete, which completes the cleanup idempotently (INTERFACE §2.4).
    return createElement(
      'div',
      { className: css.item },
      createElement(
        'span',
        {
          className: css.failed,
          title: entry.error ? `清理未完成：${entry.error}` : '清理未完成',
        },
        `「${entry.title}」清理未完成，可重试补齐`,
      ),
      createElement(
        'button',
        {
          type: 'button',
          className: css.undo,
          disabled: entry.retrying === true,
          onClick: () => {
            void pendingDeletes.retry(entry.id)
          },
        },
        entry.retrying === true ? '重试中…' : '重试',
      ),
    )
  }
  const remaining = Math.max(0, Math.ceil((entry.deadline - now) / 1000))
  return createElement(
    'div',
    {
      className: css.item,
      style: { gap: 10 } as CSSProperties,
    },
    createElement(
      'div',
      { className: css.label },
      createElement('div', { className: css.title }, entry.title),
      createElement('div', { className: css.countdown }, `撤销删除（${remaining}秒）`),
    ),
    createElement(
      'button',
      {
        type: 'button',
        className: css.undo,
        onClick: () => {
          // P6: a failed undo (entry already fired) is surfaced instead of
          // silently ignored; the rail will also have already removed the entry.
          if (!pendingDeletes.undo(entry.id)) {
            window.alert('该删除已生效，无法撤销')
          }
        },
      },
      '撤销',
    ),
  )
}

export function UndoRail(): ReactNode {
  const entries = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

  // A 500ms tick drives the countdown text: `now` is read fresh each render,
  // and without a time-based re-render the rail would sit frozen at the number
  // captured when it mounted. Ticking while entries exist keeps the seconds
  // counting down to the fire moment (when the entry leaves the table and the
  // rail disappears). With no entries the effect schedules nothing.
  const [, setTick] = useState(0)
  useEffect(() => {
    if (entries.length === 0) return
    const id: ReturnType<typeof setInterval> = setInterval(() => setTick((n) => n + 1), TICK_MS)
    return () => clearInterval(id)
  }, [entries.length])

  if (entries.length === 0) return null

  const now = Date.now()
  // Build the stacked rows: each entry is a full-width row; a horizontal divider
  // sits above every row after the first (vertical stack, not overlapping).
  const items: ReactNode[] = entries.flatMap((entry, i) => {
    const row = createElement(EntryRow, { entry, now, key: 'row-' + entry.id })
    if (i === 0) return [row]
    return [createElement('div', { key: 'div-' + entry.id, className: css.divider }), row]
  })

  return createElement('div', { className: css.rail, role: 'status' }, items)
}
