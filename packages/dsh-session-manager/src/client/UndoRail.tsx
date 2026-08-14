/**
 * UndoRail — the fixed bottom overlay that surfaces deferred deletions.
 *
 * Reads the module-scope `pendingDeletes` park table through
 * `useSyncExternalStore`, so the rail re-mounts anywhere (it is appended to
 * `document.body`, never unmounted on view switch) and always reflects the
 * same module state the countdown timers live in — switching panels neither
 * resets nor drops a countdown (INTERFACE §1.2 step 3).
 *
 * Two entry kinds:
 *   - pending (undoable): title + seconds remaining, with an Undo button.
 *   - failed (retain window): an error readout; the session is already
 *     re-shown. Failed entries are auto-cleared by the state machine after
 *     a short window, so no manual dismissal is needed here.
 */
import { createElement, type CSSProperties, type ReactNode } from 'react'
import { useSyncExternalStore } from 'react'
import { pendingDeletes, type PendingEntry } from './pendingDeletes.ts'
import css from './rail.module.css'

const getSnapshot = (): PendingEntry[] => pendingDeletes.snapshot()
const subscribe = (listener: () => void): (() => void) => pendingDeletes.subscribe(listener)

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
          pendingDeletes.undo(entry.id)
        },
      },
      '撤销',
    ),
  )
}

export function UndoRail(): ReactNode {
  const entries = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  if (entries.length === 0) return null

  const now = Date.now()
  const items: ReactNode[] = entries.map((entry, i) => {
    const row = createElement(EntryRow, { entry, now, key: entry.id })
    if (i === 0) return row
    return createElement(
      // A keyed wrapper keeps sibling divs stable as entries come and go.
      'div',
      { key: entry.id + '-wrap', className: css.item, style: { gap: 12 } as CSSProperties },
      createElement('div', { className: css.divider }),
      row,
    )
  })

  return createElement('div', { className: css.rail, role: 'status' }, items)
}
