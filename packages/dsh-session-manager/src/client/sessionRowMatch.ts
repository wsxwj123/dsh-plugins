/**
 * sessionRowMatch — the pure, DOM-free core of row→session resolution.
 *
 * The official session row's ⋮ menu button carries
 * `aria-label = t("actions.session.aria", { name: title })`, i.e. a localized
 * string that contains the session's title verbatim (Chinese 「会话"X"的操作」 /
 * English "Session actions for X"). Given one such label and the `byId` map, we
 * find the session whose title is contained in the label, preferring the
 * LONGEST contained title (most specific — avoids a short title matching a
 * longer one by accident).
 *
 * The byId summary has BOTH a raw `title` (present only when the session has
 * one) and a derived `displayTitle` (always present, equals `title` for a
 * titled session). We match against `title ?? displayTitle` so either field
 * works regardless of which the runtime carries.
 *
 * Kept in its own module so a node unit test can drive it directly (mirrors
 * pendingDeletesCore): no DOM, no react.
 */
export interface SessionRowCandidate {
  title?: string
  displayTitle?: string
  running?: boolean
  blank?: boolean
}

export interface MatchedSession {
  id: string
  cwd: string
  title: string
  running: boolean
}

/** Resolve one session id from a single row-actions aria-label. */
export function matchSessionFromLabel(
  label: string,
  byId: Record<string, SessionRowCandidate | undefined>,
): MatchedSession | null {
  let best: string | null = null
  let bestId: string | undefined
  let bestRunning = false
  let bestCwd = ''
  for (const id of Object.keys(byId)) {
    const s = byId[id]
    if (!s || s.blank) continue
    const candidate = s.title ?? s.displayTitle ?? ''
    if (!candidate) continue
    if (candidate.length === 0 || candidate.length > 256) continue
    // The aria-label interpolates the title; containment is locale-agnostic.
    if (!label.includes(candidate)) continue
    if (best === null || candidate.length > best.length) {
      best = candidate
      bestId = id
      bestRunning = s.running === true
      bestCwd = String((s as Record<string, unknown>).cwd ?? '')
    }
  }
  if (best === null || bestId === undefined) return null
  return { id: bestId, cwd: bestCwd, title: best, running: bestRunning }
}
