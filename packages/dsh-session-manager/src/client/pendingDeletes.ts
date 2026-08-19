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

/**
 * localStorage key holding the subset whose delete left NO recycle-bin entry
 * (M5). Separate key so the original one keeps its exact meaning/format — an
 * older build reading it sees the same list it always did.
 */
const GHOST_STORAGE_KEY = 'dsh-sm.deleted.noArtifact'

function loadIds(key: string): string[] {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null
    const arr = raw ? (JSON.parse(raw) as unknown) : []
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

function saveIds(key: string, ids: string[]): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(key, JSON.stringify(ids))
  } catch {
    /* non-fatal */
  }
}

/** Browser storage adapter over localStorage. */
const localStorageAdapter: NonNullable<PendingDeleteDeps['storage']> = {
  load: () => loadIds(DELETED_STORAGE_KEY),
  save: (ids) => saveIds(DELETED_STORAGE_KEY, ids),
  loadGhosts: () => loadIds(GHOST_STORAGE_KEY),
  saveGhosts: (ids) => saveIds(GHOST_STORAGE_KEY, ids),
}

/**
 * The module singleton the UI drives. Wired to the real host bridge; the DOM
 * ride-along (row hide/show) is applied by the injection layer via a subscribe
 * that reconciles visibility from the park table + the persisted deleted set,
 * so nothing here touches the DOM.
 */
export const pendingDeletes: PendingDeletes = createPendingDeletes({
  fire: (entry, opts) => smDelete(entry.id, entry.cwd, entry.title, opts?.force) as Promise<SmResult>,
  // The running-session confirm happens at CLICK time (src/client/index.tsx),
  // before requestDelete, and travels as the entry's `force` flag. There is
  // nothing to confirm at fire time: the host no longer returns session-running.
  onChange: () => {},
  storage: localStorageAdapter,
})

// M5: cross-tab sync. `deletedIds` lives in localStorage but nothing listened for
// changes, so tab A's delete left the row on screen in tab B — and tab B's next
// write clobbered A's set. The `storage` event fires only in OTHER tabs, so this
// never re-enters our own writes. `key === null` is a whole-store clear.
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('storage', (event: StorageEvent) => {
    if (event.key === null || event.key === DELETED_STORAGE_KEY || event.key === GHOST_STORAGE_KEY) {
      pendingDeletes.syncFromStorage()
    }
  })
}
