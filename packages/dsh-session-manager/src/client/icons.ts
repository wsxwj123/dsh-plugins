/**
 * icons — inline 16x16 stroke SVGs (Lucide-style) used instead of emoji, so the
 * delete button matches DSH's official icon footprint. `currentColor` lets the
 * button's CSS `color` drive the tint (official palette: label-tertiary resting,
 * label-primary on hover). Zero dependencies, no @deepseek-ai imports, so the
 * client-bundle purity gate is unaffected.
 */

/** Trashcan (delete). */
export const TRASH_SVG =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ' +
  'aria-hidden="true" focusable="false">' +
  '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/>' +
  '<path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>' +
  '<line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>'

