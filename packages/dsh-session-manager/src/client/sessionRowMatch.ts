/**
 * sessionRowMatch — the pure, DOM-free core of row→session resolution.
 *
 * The official session row's ⋮ menu button carries
 * `aria-label = t("actions.session.aria", { name: title })`. That is a TEMPLATE
 * with the title interpolated — 「会话“{name}”的操作」 (zh) /
 * "Session actions for {name}" (en), the only two locales
 * dsh-client-ui-workspace ships. `resolveRows` therefore REBUILDS the label from
 * each candidate title and requires an exact match (F2c): the old
 * "longest title contained in the label" heuristic let a session literally
 * titled 「会话」/"Session" — the template's own words — hijack every row with a
 * shorter title.
 *
 * The byId summary has BOTH a raw `title` (present only when the session has
 * one) and a derived `displayTitle` (always present, equals `title` for a
 * titled session; it is the value the official row actually renders). Both are
 * registered as candidates so either field resolves the row.
 *
 * Same-title ties: DSH does not guarantee unique titles (an unnamed session's
 * displayTitle is its cwd basename, so siblings in one directory collide), and
 * DOM row order is NOT the `ids` order — the flat view sorts by recency and
 * both views then apply the user's draggable persisted order. So an ambiguous
 * label CANNOT be disambiguated by index: `resolveRows` binds a row only on a
 * UNIQUE hit and otherwise injects no button. A missing button is an
 * inconvenience; a button bound to another session deletes the wrong one (F2b).
 *
 * Visibility (F2a): the tie set is filtered exactly like the official renderer's
 * `sessionVisible` (`origin !== 'subagent' && !archived.has(id) && !blank`), so
 * an archived or subagent session sharing a title can never take the visible
 * row's slot.
 *
 * Kept in its own module so a node unit test can drive it directly (mirrors
 * pendingDeletesCore): no DOM, no react.
 */
import { MAX_TITLE_LEN } from '../constants.ts'

export interface SessionRowCandidate {
  title?: string
  displayTitle?: string
  running?: boolean
  blank?: boolean
  /** Working-directory path used to locate the session dir on the host. */
  cwd?: string
  /** `'subagent'` children render under their parent, never as sidebar rows. */
  origin?: string
}

/**
 * The official `actions.session.aria` templates (dsh-client-ui-workspace ships
 * zh + en only). A locale added upstream simply stops resolving rows — the
 * failure mode is "no delete button", never "wrong session".
 */
const ARIA_TEMPLATES = ['会话“{name}”的操作', 'Session actions for {name}']

/** Every aria-label the official renderer could produce for this title. */
function ariaLabelsFor(title: string): string[] {
  return ARIA_TEMPLATES.map((tpl) => tpl.replace('{name}', title))
}

/** A title usable as a match key (non-empty, within the shared length bound). */
function isUsableTitle(t: string | undefined): t is string {
  return typeof t === 'string' && t.length > 0 && t.length <= MAX_TITLE_LEN
}

/**
 * Archived-id input normalizer: accepts the id list / a Set / the raw
 * `workspaces.list` snapshot shape, so the caller cannot pass the wrong face by
 * accident.
 */
function toIdSet(archived: ArchivedInput): Set<string> {
  if (archived === undefined || archived === null) return new Set()
  if (typeof (archived as Iterable<string>)[Symbol.iterator] === 'function') {
    return new Set(archived as Iterable<string>)
  }
  const ids = (archived as { archivedSessionIds?: unknown }).archivedSessionIds
  return new Set(Array.isArray(ids) ? (ids as string[]) : [])
}

/** Archived session ids, in any of the shapes the client runtime hands out. */
export type ArchivedInput = Iterable<string> | { archivedSessionIds?: string[] } | null | undefined

export interface MatchedSession {
  id: string
  /** Undefined when the session has no recorded cwd (host uses `_no-cwd`). */
  cwd: string | undefined
  title: string
  running: boolean
}

/** The longest non-blank title contained in the label (per-row primitive). */
function bestTitleIn(label: string, byId: Record<string, SessionRowCandidate | undefined>): string | null {
  let best: string | null = null
  for (const id of Object.keys(byId)) {
    const s = byId[id]
    if (!s || s.blank) continue
    const candidate = s.title ?? s.displayTitle ?? ''
    if (!candidate) continue
    if (candidate.length === 0 || candidate.length > MAX_TITLE_LEN) continue
    // The aria-label interpolates the title; containment is locale-agnostic.
    if (!label.includes(candidate)) continue
    if (best === null || candidate.length > best.length) best = candidate
  }
  return best
}

/**
 * LEGACY per-row containment matcher. NOT used for delete binding: containment
 * lets a session titled with the template's own words hijack other rows, and a
 * tie silently picks the first byId key (F2). `resolveRows` is the only safe
 * entry point — keep new callers on it.
 */
export function matchSessionFromLabel(
  label: string,
  byId: Record<string, SessionRowCandidate | undefined>,
): MatchedSession | null {
  const title = bestTitleIn(label, byId)
  if (title === null) return null
  for (const id of Object.keys(byId)) {
    const s = byId[id]
    if (!s || s.blank) continue
    if ((s.title ?? s.displayTitle ?? '') === title) {
      return { id, cwd: s.cwd, title, running: s.running === true }
    }
  }
  return null
}

/**
 * Resolve ids for a WHOLE container's rows in DOM order.
 *
 * One pass over `ids` builds a label→candidates index (L4: no per-row rescan of
 * `byId`, so the cost is O(rows + sessions) instead of O(rows × sessions)),
 * skipping sessions the official renderer does not show (F2a). Each row then
 * looks its exact label up (F2c) and binds ONLY on a unique hit (F2b).
 *
 * @param labels - one aria-label per row, in DOM order (null → unmatchable row).
 * @param byId - session summary map.
 * @param ids - session id list (the candidate universe; order is NOT trusted).
 * @param archived - archived session ids (`workspaces.list.archivedSessionIds`).
 * @returns one MatchedSession per row; null when the row cannot be matched
 *   (no label / blank / not visible / ambiguous label).
 */
export function resolveRows(
  labels: Array<string | null>,
  byId: Record<string, SessionRowCandidate | undefined>,
  ids: string[],
  archived?: ArchivedInput,
): Array<MatchedSession | null> {
  const hidden = toIdSet(archived)
  // label → every VISIBLE session that would render exactly that label.
  const byLabel = new Map<string, Array<{ id: string; title: string }>>()
  for (const id of ids) {
    const s = byId[id]
    // Official `sessionVisible`: subagent children and archived sessions are not
    // rendered here, so they must not compete for a row. Blank rows carry no ⋮
    // button and have no session file — never a delete target.
    if (!s || s.blank === true || s.origin === 'subagent' || hidden.has(id)) continue
    const titles = new Set<string>()
    if (isUsableTitle(s.title)) titles.add(s.title)
    if (isUsableTitle(s.displayTitle)) titles.add(s.displayTitle)
    for (const title of titles) {
      for (const label of ariaLabelsFor(title)) {
        const group = byLabel.get(label)
        if (group) group.push({ id, title })
        else byLabel.set(label, [{ id, title }])
      }
    }
  }
  return labels.map((label) => {
    if (label === null) return null
    const group = byLabel.get(label)
    // Ambiguous (two visible sessions render this exact label) → no button.
    // DOM row order is not the ids order, so index alignment would be a guess
    // whose failure mode is deleting the wrong session.
    if (group === undefined || group.length !== 1) return null
    const { id, title } = group[0]
    const s = byId[id]
    if (!s) return null
    return { id, cwd: s.cwd, title, running: s.running === true }
  })
}
