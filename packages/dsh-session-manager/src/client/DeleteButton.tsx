/**
 * DeleteButton — the hover-revealed delete control injected into each official
 * session row, plus the DOM-injection controller that keeps those buttons in
 * sync with the session list.
 *
 * Why DOM injection (PLAN §2.2 / risk 8): the sidebar session list is rendered
 * exclusively by ui-workspace (`sidebar.workspaces` is a single slot we cannot
 * co-occupy). We therefore locate the list via the stable `role`/`aria`
 * attributes (NOT the hashed CSS-Module class names, which change per build)
 * and imperatively append a delete button into each row's official `.rowActions`
 * cell — the same hover-reveal surface the built-in menu uses, so the button
 * appears "on hover" exactly as the INTERFACE requires.
 *
 * Row→session-id: rows carry no `data-session-id`; we reverse-map the row's
 * title text against `sessions.list.byId` (PLAN §2.2). Blank rows have no
 * `.rowActions` cell (no button — correct), and project rows have a `.projectText`
 * child (filtered out) rather than a direct `.title` child.
 */
import type { Context } from './context-types.ts'

const SESSIONS_LIST_SEL = 'div[role="tree"][aria-label="sessions"]'

/** The selector for the official sessions tree container. */
export { SESSIONS_LIST_SEL }

/**
 * Passed to a delete action so the caller can hide/restore the row. The row
 * element is captured so a pending hide survives until undone or the host
 * removes it for real.
 */
export interface DeleteAction {
  id: string
  cwd: string
  title: string
  /** True when the session currently has a running host instance. */
  running: boolean
}

/** Resolve the session id a tree row maps to (title reverse-lookup + blank). */
export function resolveRowSession(row: Element, byId: Record<string, { displayTitle?: string; running?: boolean; blank?: boolean } | undefined>): DeleteAction | null {
  // A session row's title is a DIRECT child; a project row nests it under
  // `.projectText`. Distinguish by structural shape, not class names.
  if (row.querySelector(':scope > .projectText') !== null) return null
  const titleEl = row.querySelector(':scope > .title')
  if (!titleEl || !titleEl.textContent) return null
  const titleText = titleEl.textContent.trim()
  // Reverse-map the title against non-blank sessions (blank rows have no
  // delete button anywhere). Running rows still resolve — their click is
  // guarded at the handler with the front-end prompt.
  for (const id of Object.keys(byId)) {
    const s = byId[id]
    if (!s) continue
    if (s.blank) continue
    if (s.displayTitle === titleText) {
      return {
        id,
        cwd: String((s as Record<string, unknown>).cwd ?? ''),
        title: titleText,
        running: s.running === true,
      }
    }
  }
  return null
}

/** Whether a `[role=treeitem]` row belongs to a deletable (non-blank) session. */
function isDeletableRow(row: Element): boolean {
  // A blank session row has no `.rowActions` cell (no menu) — nothing to hang
  // the button on, and the INTERFACE forbids it anyway. Project rows are
  // filtered structurally in resolveRowSession.
  return row.querySelector(':scope > .rowActions') !== null
}

export interface DeleteController {
  /** (Re)sync the injected delete buttons with the current rows. */
  sync(): void
  /** Associated row elements per session id, for hide/show reconciliation. */
  rowById: Map<string, HTMLElement>
  dispose(): void
}

/**
 * Enumerate the deletable session rows currently in the tree container, with
 * their resolved session identity. Used by the visibility reconciler so a fresh
 * row created after a group collapse/re-expand is matched and hidden correctly
 * within the 10s window.
 */
export function reconcileFromDom(
  container: ParentNode,
  byId: Record<string, { displayTitle?: string; running?: boolean; blank?: boolean } | undefined>,
  fn: (row: HTMLElement, action: DeleteAction) => void,
): void {
  for (const row of container.querySelectorAll<HTMLElement>('[role="treeitem"]')) {
    if (row.querySelector(':scope > .rowActions') === null) continue
    const action = resolveRowSession(row, byId)
    if (action) fn(row, action)
  }
}

/**
 * Build the injection controller bound to one client `apply(ctx)`.
 * @param getById - snapshot of `sessions.list.byId` (re-read on each sync).
 * @param onDelete - called when a delete button is clicked; the caller hides
 *   the row and parks the deferred deletion.
 */
export function createDeleteController(
  getContext: () => Context,
  onDelete: (action: DeleteAction, row: HTMLElement) => void,
): DeleteController {
  const rowById = new Map<string, HTMLElement>()

  const injectIntoRow = (row: HTMLElement): void => {
    if (!isDeletableRow(row)) return
    const ctx = getContext()
    const byId = ctx.sessions.list.getSnapshot().byId
    const action = resolveRowSession(row, byId)
    if (!action) return

    const actions = row.querySelector(':scope > .rowActions')
    if (!(actions instanceof HTMLElement)) return
    // Skip rows that already carry our button (avoids duplicate injection when
    // React reuses a row DOM node across re-renders).
    if (actions.querySelector('[data-dsh-sm-delete]') !== null) return

    rowById.set(action.id, row)
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.dataset.dshSmDelete = 'true'
    btn.title = action.running ? '请先结束运行中的会话' : '删除会话'
    btn.setAttribute('aria-label', `删除会话 ${action.title}`)
    btn.textContent = '🗑'
    btn.addEventListener('click', (e) => {
      e.preventDefault()
      e.stopPropagation()
      // Re-resolve the row against the LIVE byId so a rename between injection
      // and click yields the current title/cwd (the id is stable; metadata may
      // have changed). No temporary bound-guard: a row can be clicked repeatedly
      // across delete→undo cycles.
      const fresh = resolveRowSession(row, getContext().sessions.list.getSnapshot().byId) ?? action
      if (fresh.running) {
        // Front-end running guard (INTERFACE §1.4): a running session is not
        // deletable here. The host half independently rejects with
        // `session-running`, so this prompt is UX, not the only line of defense.
        window.alert('请先结束运行中的会话，再进行删除')
        return
      }
      onDelete(fresh, row)
    })
    actions.appendChild(btn)
  }

  const sync = (): void => {
    const container = document.querySelector<HTMLElement>(SESSIONS_LIST_SEL)
    if (!container) return
    // Drop mappings whose rows have been removed by React.
    for (const [id, el] of Array.from(rowById.entries())) {
      if (!el.isConnected) rowById.delete(id)
    }
    for (const row of container.querySelectorAll<HTMLElement>(':scope [role="treeitem"]')) {
      injectIntoRow(row)
    }
  }

  return { sync, rowById, dispose: () => {} }
}
