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
 * Archive icon as a direct <svg> child, matching how the official Settings
 * trigger renders its icon (no extra span wrapper). A wrapper span changes the
 * inline layout and makes the icon sit visually higher than the Settings icon.
 */
const archiveIcon = createElement(
  'svg',
  {
    width: 16,
    height: 16,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
    focusable: 'false',
  },
  createElement('rect', { width: 20, height: 5, x: 2, y: 3, rx: 1 }),
  createElement('path', { d: 'M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8' }),
  createElement('path', { d: 'M10 12h4' }),
)

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
      className: wide ? css.entryButton : css.entryButtonRail,
      'aria-pressed': open,
      'aria-label': '归档',
      onClick: () => setArchiveOpen(!open),
      title: '归档',
    },
    archiveIcon,
    wide ? createElement('span', null, '归档') : null,
  )
}
