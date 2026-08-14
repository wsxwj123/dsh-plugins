/**
 * DeleteButton — the hover-revealed delete control injected into each session
 * row, plus the DOM-injection controller that keeps those buttons in sync with
 * the session list.
 *
 * Why DOM injection (PLAN §2.2 / risk 8): the sidebar session list is rendered
 * exclusively by ui-workspace (`sidebar.workspaces` is a single slot we cannot
 * co-occupy). We therefore splice into the list imperatively, anchored ONLY on
 * stable `role` attributes — never on CSS-Module class names (which are hashed
 * per build, e.g. `.YDXeBa_title`, `.YDXeBa_rowActions`) and never on the tree
 * container's `aria-label`, which is a localized translation key (rendered as
 * "会话" in Chinese, "sessions" in English).
 *
 * Anchors used:
 *   - container  : `[role="tree"]`
 *   - row        : `[role="treeitem"]` (a child of the container)
 *   - title      : the per-row ⋮ menu button's `aria-label`, which the official
 *     renderer puts at `t("actions.session.aria", { name: title })` — i.e. the
 *     localized string contains the session's title verbatim (Chinese
 *     「会话"X"的操作」/ English "Session actions for X"). We find which byId
 *     session's title is contained in that label (longest match wins) to
 *     recover the (otherwise absent) session id.
 *
 * Rows with no such actions button — blank (New Session) rows and project rows —
 * simply fail title resolution and are skipped, so we never inject there.
 *
 * The delete button is appended as a DIRECT child of the row, shown only on row
 * hover via an injected global rule (official rows have no stable action-cell
 * selector to piggyback on reliably across versions).
 */
import type { Context } from './context-types.ts'
import { matchSessionFromLabel } from './sessionRowMatch.ts'
import { TRASH_SVG } from './icons.ts'
import css from './rail.module.css'

export type { MatchedSession } from './sessionRowMatch.ts'

/** Any tree role (the sidebar session list); we scan all present to be safe.
 *  No aria-label — that attribute is a localized label, not a stable marker. */
export const SESSIONS_LIST_SEL = '[role="tree"]'

/** Global hover rule injected once; targets official rows by role, not hashed classes. */
const HOVER_CSS = `[role="treeitem"]:hover > [data-dsh-sm-delete] { display: inline-flex !important; }`

/**
 * Resolve the row→session id via the DOM. A SESSION row has exactly ONE button
 * with an aria-label — the ⋮ actions menu `t("actions.session.aria", {name:
 * title})`, whose text contains the title. PROJECT rows carry TWO labeled
 * buttons (workspace menu + new-session) and blank (New Session) rows carry
 * none, so both are skipped by requiring exactly one — a locale-independent
 * discriminator that also keeps us off the hashed class names.
 */
export function resolveRowSession(
  row: Element,
  byId: Record<string, { title?: string; displayTitle?: string; running?: boolean; blank?: boolean; cwd?: string } | undefined>,
): { id: string; cwd: string | undefined; title: string; running: boolean } | null {
  const buttons = row.querySelectorAll<HTMLElement>('button[aria-label]')
  // A session row exposes exactly one labeled action button (the ⋮ menu);
  // project rows expose two (workspace menu + new-session) — skip those.
  if (buttons.length !== 1) return null
  const label = buttons[0].getAttribute('aria-label')
  if (!label || label.trim().length === 0) return null
  return matchSessionFromLabel(label, byId)
}

export interface DeleteController {
  /** (Re)sync the injected delete buttons with the current rows. */
  sync(): void
  /** Associated row elements per session id, for hide/show reconciliation. */
  rowById: Map<string, HTMLElement>
  dispose(): void
}

/**
 * Build the injection controller bound to one client `apply(ctx)`.
 * @param getContext - provides the client context (sessions list snapshot).
 * @param onDelete - called when a delete button is clicked; the caller hides
 *   the row and parks the deferred deletion.
 */
export function createDeleteController(
  getContext: () => Context,
  onDelete: (action: { id: string; cwd: string | undefined; title: string; running: boolean }, row: HTMLElement) => void,
): DeleteController {
  const rowById = new Map<string, HTMLElement>()

  // Inject the global hover rule once.
  if (!document.head.querySelector('#dsh-session-manager-delete-hover')) {
    const style = document.createElement('style')
    style.id = 'dsh-session-manager-delete-hover'
    style.textContent = HOVER_CSS
    document.head.appendChild(style)
  }

  const injectIntoRow = (row: HTMLElement): void => {
    // Skip rows already carrying our button (React may reuse a row DOM node).
    if (row.querySelector('[data-dsh-sm-delete]') !== null) return
    const ctx = getContext()
    const byId = ctx.sessions.list.getSnapshot().byId
    const action = resolveRowSession(row, byId)
    if (!action) {
      // Diagnostic for the "ungrouped not deletable" report: a row that IS a
      // session row (exactly one aria-labelled button) but failed title
      // resolution. Logs what would have been needed so the cause is visible in
      // Console without a browser-side debugger.
      const ariaButtons = row.querySelectorAll<HTMLElement>('button[aria-label]')
      if (ariaButtons.length === 1) {
        const lbl = ariaButtons[0].getAttribute('aria-label') ?? ''
        console.debug('[dsh-session-manager] session row not resolvable:',
          { ariaLabel: lbl, byIdCount: Object.keys(byId).length, byIdTitles: Object.keys(byId).map((i) => byId[i]?.title ?? byId[i]?.displayTitle) })
      }
      return
    }

    rowById.set(action.id, row)
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.dataset.dshSmDelete = 'true'
    btn.className = css.deleteBtn
    btn.title = action.running ? '删除会话（当前正在使用中，将提示强制删除）' : '删除会话'
    btn.setAttribute('aria-label', `删除会话 ${action.title}`)
    // Static, trusted SVG (no user input) — do not concatenate anything here.
    btn.innerHTML = TRASH_SVG
    // Hidden until the official row is hovered (deep-linked visibility via the
    // injected [role=treeitem]:hover rule above).
    btn.style.display = 'none'
    btn.addEventListener('click', (e) => {
      e.preventDefault()
      e.stopPropagation()
      // Re-resolve against the LIVE byId so a rename between injection and
      // click yields current metadata. RUNNING sessions are NOT hard-blocked
      // here: the delete is parked and, at fire, the host returns session-running
      // which the state machine confirms then force-retries (unified UX).
      const fresh = resolveRowSession(row, getContext().sessions.list.getSnapshot().byId) ?? action
      onDelete({ ...fresh, cwd: fresh.cwd }, row)
    })
    // Append as a direct child of the row so the :hover > child rule applies.
    row.appendChild(btn)
  }

  const sync = (): void => {
    // Drop mappings whose rows have been removed by React.
    for (const [id, el] of Array.from(rowById.entries())) {
      if (!el.isConnected) rowById.delete(id)
    }
    for (const container of document.querySelectorAll<HTMLElement>(SESSIONS_LIST_SEL)) {
      for (const row of container.querySelectorAll<HTMLElement>(':scope [role="treeitem"]')) {
        injectIntoRow(row)
      }
    }
  }

  return { sync, rowById, dispose: () => {} }
}
