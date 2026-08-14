/**
 * ArchiveEntry — the 「归档」 button contributed to the `sidebar.footer.action`
 * list slot, beside Settings at the sidebar foot. Toggles the archive overlay.
 *
 * Props: `{ wide: boolean }` (the owner share declared by ui-sidebar). In the
 * 56px rail the label is dropped and only the icon shows — behavior identical.
 */
import { createElement, type ReactNode } from 'react'
import { useSyncExternalStore } from 'react'
import type { Context } from './context-types.ts'
import { getArchiveOpen, setArchiveOpen, subscribeArchive } from './archiveState.ts'
import css from './rail.module.css'

const getOpen = (): boolean => getArchiveOpen()
const sub = (l: () => void): (() => void) => subscribeArchive(l)

/**
 * Close the overlay via the injected workspaces/sessions ambient context (kept
 * a parameter so the component stays purely presentational). The host already
 * broadcasts changes; this is only the local toggle entry point.
 */
export function ArchiveEntry({ ctx, wide }: { ctx: Context; wide: boolean }): ReactNode {
  const open = useSyncExternalStore(sub, getOpen, getOpen)
  return createElement(
    'button',
    {
      type: 'button',
      className: css.entryButton,
      'aria-pressed': open,
      'aria-label': '归档',
      onClick: () => setArchiveOpen(!open),
      title: '归档',
    },
    createElement('span', { 'aria-hidden': true }, '🗂'),
    wide ? createElement('span', null, '归档') : null,
  )
}
