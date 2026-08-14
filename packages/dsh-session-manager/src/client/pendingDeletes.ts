/**
 * pendingDeletes — the module-scope deferred-deletion singleton browser plugins
 * drive. The pure state machine lives in `pendingDeletesCore.ts` (node-testable
 * separately); this module wires it to the real `/sm` bridge and re-exports the
 * core API + constants so the React UI imports everything from one place.
 */
import { smDelete, type SmResult } from './bridge.ts'
import { createPendingDeletes, type PendingDeletes } from './pendingDeletesCore.ts'

export { createPendingDeletes, UNDO_WINDOW_MS, FAILED_RETAIN_MS } from './pendingDeletesCore.ts'
export type {
  PendingEntry,
  PendingDeletes,
  PendingState,
  FireOutcome,
  PendingDeleteDeps,
} from './pendingDeletesCore.ts'

/**
 * The module singleton the UI drives. Wired to the real host bridge; the DOM
 * ride-along (row hide/show) is applied by the injection layer via a subscribe
 * that reconciles visibility from the park table, so nothing here touches the
 * DOM.
 */
export const pendingDeletes: PendingDeletes = createPendingDeletes({
  fire: (entry) => smDelete(entry.id, entry.cwd, entry.title) as Promise<SmResult>,
  onChange: () => {},
})
