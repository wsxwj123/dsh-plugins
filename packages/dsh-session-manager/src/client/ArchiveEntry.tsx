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
import { ARCHIVE_SVG } from './icons.ts'
import css from './rail.module.css'

const getOpen = (): boolean => getArchiveOpen()
const sub = (l: () => void): (() => void) => subscribeArchive(l)

/**
 * Toggle the archive overlay. The icon is a static, trusted inline SVG (no user
 * input concatenated), tinted via currentColor so it matches the footer action
 * palette.
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
    createElement('span', { 'aria-hidden': true, dangerouslySetInnerHTML: { __html: ARCHIVE_SVG } }),
    wide ? createElement('span', null, '归档') : null,
  )
}
