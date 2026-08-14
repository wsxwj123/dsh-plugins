/**
 * pendingDeletes — the module-scope deferred-deletion singleton browser plugins
 * drive. The pure state machine lives in `pendingDeletesCore.ts` (node-testable
 * separately); this module wires it to the real `/sm` bridge and re-exports the
 * core API + constants so the React UI imports everything from one place.
 */
import { smDelete, type SmResult } from './bridge.ts'
import { createPendingDeletes, memoryStorage, type PendingDeleteDeps, type PendingDeletes } from './pendingDeletesCore.ts'

export { createPendingDeletes, memoryStorage, UNDO_WINDOW_MS, FAILED_RETAIN_MS } from './pendingDeletesCore.ts'
export type {
  PendingEntry,
  PendingDeletes,
  PendingState,
  FireOutcome,
  PendingDeleteDeps,
} from './pendingDeletesCore.ts'

/** localStorage key holding the confirmed-deleted session ids. */
const DELETED_STORAGE_KEY = 'dsh-sm.deleted'

/** Browser storage adapter over localStorage. */
const localStorageAdapter: NonNullable<PendingDeleteDeps['storage']> = {
  load: () => {
    try {
      const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(DELETED_STORAGE_KEY) : null
      const arr = raw ? (JSON.parse(raw) as unknown) : []
      return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : []
    } catch {
      return []
    }
  },
  save: (ids) => {
    try {
      if (typeof localStorage !== 'undefined') localStorage.setItem(DELETED_STORAGE_KEY, JSON.stringify(ids))
    } catch {
      /* non-fatal */
    }
  },
}

/**
 * The module singleton the UI drives. Wired to the real host bridge; the DOM
 * ride-along (row hide/show) is applied by the injection layer via a subscribe
 * that reconciles visibility from the park table + the persisted deleted set,
 * so nothing here touches the DOM.
 */
export const pendingDeletes: PendingDeletes = createPendingDeletes({
  fire: (entry, opts) => smDelete(entry.id, entry.cwd, entry.title, opts?.force) as Promise<SmResult>,
  // The host returns session-running for a live session unless force:true.
  // Ask the user before force-deleting (directory still goes to the recycle bin).
  confirmForceDelete: (id, title) =>
    window.confirm(`「${title}」该会话当前正在使用中，强制删除？（文件将移入回收站，可恢复）`),
  onChange: () => {},
  storage: localStorageAdapter,
})
