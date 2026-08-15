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
 * Row→id binding is resolved per CONTAINER, not per row (review I-6): the
 * official list renders rows in `sessions.list.ids` order, so when several rows
 * share a title (DSH does not guarantee unique titles) the k-th such row binds
 * the k-th same-title id. This keeps every row on its OWN session — a tie must
 * never leave both rows' delete buttons bound to the first matching id
 * (删错目录 prevention, F3).
 *
 * Rows with no such actions button — blank (New Session) rows and project rows —
 * simply fail title resolution and are skipped, so we never inject there.
 *
 * The delete button is appended as a DIRECT child of the row, shown only on row
 * hover via an injected global rule (official rows have no stable action-cell
 * selector to piggyback on reliably across versions).
 */
import type { Context } from './context-types.ts'
import { resolveRows, type MatchedSession } from './sessionRowMatch.ts'
import { TRASH_SVG } from './icons.ts'
import css from './rail.module.css'

export type { MatchedSession } from './sessionRowMatch.ts'

/** Any tree role (the sidebar session list); we scan all present to be safe.
 *  No aria-label — that attribute is a localized label, not a stable marker. */
export const SESSIONS_LIST_SEL = '[role="tree"]'

/** Global hover rule injected once; targets official rows by role, not hashed classes. */
const HOVER_CSS = `[role="treeitem"]:hover > [data-dsh-sm-delete] { display: inline-flex !important; }`

/** The injected delete button's attribute (also its skip/injection marker). */
const DELETE_BTN_SEL = '[data-dsh-sm-delete]'

/**
 * The row's official ⋮-menu aria-label: the ONE labelled button that is NOT
 * our injected delete control. Project rows carry TWO other labelled buttons
 * (workspace menu + new-session) and blank (New Session) rows carry none, so
 * both return null and are skipped — a locale-independent discriminator that
 * also keeps us off the hashed class names. Excluding `[data-dsh-sm-delete]`
 * keeps re-syncs (React node reuse) resolvable.
 */
function rowLabel(row: HTMLElement): string | null {
  const buttons = Array.from(row.querySelectorAll<HTMLElement>('button[aria-label]'))
    .filter((b) => !b.hasAttribute('data-dsh-sm-delete'))
  if (buttons.length !== 1) return null
  const label = buttons[0].getAttribute('aria-label')
  return label && label.trim().length > 0 ? label : null
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

  const injectIntoRow = (row: HTMLElement, action: MatchedSession): void => {
    // Skip rows already carrying our button (React may reuse a row DOM node).
    if (row.querySelector(DELETE_BTN_SEL) !== null) return
    rowById.set(action.id, row)
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.dataset.dshSmDelete = 'true'
    btn.className = css.deleteBtn
    btn.title = action.running ? '删除会话（会话正在运行任务，将提示确认）' : '删除会话'
    btn.setAttribute('aria-label', `删除会话 ${action.title}`)
    // Static, trusted SVG (no user input) — do not concatenate anything here.
    btn.innerHTML = TRASH_SVG
    // Hidden until the official row is hovered (deep-linked visibility via the
    // injected [role=treeitem]:hover rule above).
    btn.style.display = 'none'
    btn.addEventListener('click', (e) => {
      e.preventDefault()
      e.stopPropagation()
      // The id bound at injection time is authoritative: a per-row re-resolve
      // at click time could not see the container tie-context that produced it
      // (and our own aria-labelled button would break the "exactly one" rule).
      // Only the volatile metadata (running/cwd) is refreshed from the LIVE
      // snapshot for the SAME id, so a rename/start between injection and
      // click still yields current state while the binding stays correct.
      const s = getContext().sessions.list.getSnapshot().byId[action.id]
      const running = s ? s.running === true : action.running
      onDelete({ id: action.id, cwd: s?.cwd ?? action.cwd, title: action.title, running }, row)
    })
    // Append as a direct child of the row so the :hover > child rule applies.
    row.appendChild(btn)
  }

  const sync = (): void => {
    // Drop mappings whose rows have been removed by React.
    for (const [id, el] of Array.from(rowById.entries())) {
      if (!el.isConnected) rowById.delete(id)
    }
    const snapshot = getContext().sessions.list.getSnapshot()
    const byId = snapshot.byId
    // Row order = `ids` order in the official renderer, which is exactly the
    // tie-alignment the matcher needs (review I-6).
    const ids = snapshot.ids
    for (const container of document.querySelectorAll<HTMLElement>(SESSIONS_LIST_SEL)) {
      const rows = Array.from(container.querySelectorAll<HTMLElement>(':scope [role="treeitem"]'))
      const labels = rows.map(rowLabel)
      const actions = resolveRows(labels, byId, ids)
      rows.forEach((row, i) => {
        const action = actions[i]
        if (!action) {
          // Diagnostic for the "ungrouped not deletable" report: a row that IS
          // a session row (single non-ours labelled button) but failed title
          // resolution. S-13 / SECURITY S4: only the row index and the byId
          // count are logged — never the aria-label (it embeds the session
          // title) nor the title list, which could carry sensitive wording.
          if (labels[i] !== null) {
            console.debug('[dsh-session-manager] session row not resolvable:', { rowIndex: i, byIdCount: Object.keys(byId).length })
          }
          return
        }
        injectIntoRow(row, action)
      })
    }
  }

  /**
   * Release everything this controller injected (review I-7): every delete
   * button (removing the node also drops its click listener — no dangling
   * closures over the old ctx), the injected hover `<style>`, and the row map.
   * Called from the client effect cleanup AFTER the MutationObserver and list
   * subscription are disconnected, so the removals cannot re-trigger sync().
   * A later re-apply recreates the style and buttons from scratch.
   */
  const dispose = (): void => {
    document.querySelectorAll(DELETE_BTN_SEL).forEach((el) => el.remove())
    document.querySelectorAll('#dsh-session-manager-delete-hover').forEach((el) => el.remove())
    rowById.clear()
  }

  return { sync, rowById, dispose }
}
