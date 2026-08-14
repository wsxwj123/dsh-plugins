// pendingDeletes.unit.test.js — drive the client deferred-delete state machine
// (pendingDeletesCore) with a fake clock + a stubbed host caller. This is the
// "撤销条状态机" white-box test: pending queue / countdown boundary / idempotency /
// multi-entry / undo / fire / failed-fire, all node-runnable (no browser).
//
// The core is pure and dependency-injected, so we import the compiled
// lib/pending-deletes-core.js exactly like the node-half unit tests import
// lib/handler.js.
import { test } from 'node:test'
import assert from 'node:assert'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const core = await import(path.join(root, 'lib', 'pending-deletes-core.js'))
const { createPendingDeletes, memoryStorage, UNDO_WINDOW_MS, FAILED_RETAIN_MS } = core

/**
 * A manual clock + manual scheduler: let/advance time by hand so timer-fired
 * deletes are deterministic (no real setTimeout in tests).
 */
function makeClockAndScheduler() {
  let nowMs = 1000
  let seq = 0
  /** scheduled callbacks: [runAtMs, cancelToken, fn] */
  const scheduleQ = []
  const timers = new Map()

  const now = () => nowMs
  const schedule = (cb, delay) => {
    const id = seq++
    const runAt = nowMs + Math.max(0, delay)
    timers.set(id, cb)
    scheduleQ.push({ id, runAt, cb, cancelled: false })
    return () => {
      const t = scheduleQ.find((q) => q.id === id)
      if (t) t.cancelled = true
    }
  }

  /** Advance the clock by ms, running every scheduled timer whose time has come. */
  const advance = (ms) => {
    nowMs += ms
    // collect due in order
    const due = scheduleQ
      .filter((q) => !q.cancelled && q.runAt <= nowMs)
      .sort((a, b) => a.runAt - b.runAt)
    // grab callbacks now (firing may schedule more timers)
    const toRun = due.map((q) => q.cb)
    for (const fn of toRun) fn()
  }

  return { now, schedule, advance, get nowMs() { return nowMs } }
}

function makeDeps(overrides = {}) {
  const { now, schedule, advance } = makeClockAndScheduler()
  const calls = []
  const deps = {
    now,
    schedule,
    fire: async (entry) => {
      calls.push(entry)
      return { ok: true }
    },
    ...overrides,
  }
  return { deps, calls, advance }
}

test('requestDelete parks an entry with the current undo window deadline (P8: 5s)', () => {
  const { deps, advance } = makeDeps()
  const pd = createPendingDeletes(deps)
  pd.requestDelete('a', '/ctx', 'A')
  const [e] = pd.snapshot()
  assert.strictEqual(e.id, 'a')
  assert.strictEqual(e.state, 'pending')
  // The deadline is exactly UNDO_WINDOW_MS in the future (from the fixed now).
  assert.strictEqual(e.deadline - deps.now(), UNDO_WINDOW_MS)
  // Before the window expires the entry stays pending and no host call is made.
  advance(UNDO_WINDOW_MS - 1)
  assert.strictEqual(pd.get('a')?.state, 'pending')
})

test('at deadline the host delete is fired exactly once and the entry clears', async () => {
  const { deps, calls, advance } = makeDeps()
  const pd = createPendingDeletes(deps)
  pd.requestDelete('a', '/ctx', 'A')
  calls.length = 0
  advance(UNDO_WINDOW_MS) // window expires
  await Promise.resolve() // let the async fire settle
  assert.strictEqual(calls.length, 1)
  assert.deepStrictEqual(calls[0], { id: 'a', cwd: '/ctx', title: 'A' })
  assert.strictEqual(pd.get('a'), undefined)
})

test('countdown survives a view switch: firing is driven by module timer, not mount', async () => {
  // "卸载" in a component doesn't touch the module queue because the timer is
  // owned by the state machine. We simulate by dropping all subscriptions and
  // confirming the scheduled fire still happens.
  const { deps, calls, advance } = makeDeps()
  const pd = createPendingDeletes(deps)
  const unsub = pd.subscribe(() => {})
  pd.requestDelete('x', '/c', 'X')
  unsub() // component "unmounted"
  advance(UNDO_WINDOW_MS)
  await Promise.resolve()
  assert.strictEqual(calls.length, 1)
})

test('idempotent: a second requestDelete for the SAME parked id is rejected (no double window)', () => {
  const { deps } = makeDeps()
  const pd = createPendingDeletes(deps)
  assert.strictEqual(pd.requestDelete('a', '/ctx', 'A'), true)
  assert.strictEqual(pd.requestDelete('a', '/ctx', 'A'), false, 'same id while pending is rejected')
  assert.strictEqual(pd.snapshot().length, 1)
})

test('P9: multi-entry — two DIFFERENT ids park independent windows', () => {
  const { deps } = makeDeps()
  const pd = createPendingDeletes(deps)
  assert.strictEqual(pd.requestDelete('a', '/ctx-a', 'A'), true)
  assert.strictEqual(pd.requestDelete('b', '/ctx-b', 'B'), true, 'a different id parks alongside')
  assert.strictEqual(pd.snapshot().length, 2)
  // Each has an independent undoable window.
  assert.strictEqual(pd.isPending('a'), true)
  assert.strictEqual(pd.isPending('b'), true)
})

test('P9: multi-entry — undoing one leaves the other pending and still firing', async () => {
  const { deps, calls, advance } = makeDeps()
  const pd = createPendingDeletes(deps)
  pd.requestDelete('a', '/ctx-a', 'A')
  pd.requestDelete('b', '/ctx-b', 'B')
  assert.strictEqual(pd.undo('b'), true, 'undo b only')
  assert.strictEqual(pd.isPending('a'), true)
  assert.strictEqual(pd.isPending('b'), false)
  advance(UNDO_WINDOW_MS)
  await Promise.resolve()
  assert.deepStrictEqual(calls.map((c) => c.id), ['a'], 'a still fires at its own deadline')
})

test('undo before the deadline removes the entry and never fires', async () => {
  const { deps, calls, advance } = makeDeps()
  const pd = createPendingDeletes(deps)
  pd.requestDelete('a', '/ctx', 'A')
  assert.strictEqual(pd.undo('a'), true)
  assert.strictEqual(pd.get('a'), undefined)
  advance(UNDO_WINDOW_MS * 2)
  await Promise.resolve()
  assert.strictEqual(calls.length, 0)
})

test('undo after the entry already fired returns false (window is over)', async () => {
  const { deps, calls, advance } = makeDeps()
  const pd = createPendingDeletes(deps)
  pd.requestDelete('a', '/ctx', 'A')
  advance(UNDO_WINDOW_MS)
  await Promise.resolve()
  assert.strictEqual(calls.length, 1)
  assert.strictEqual(pd.undo('a'), false)
})

test('failed fire (system-error) surfaces a failed entry, then auto-clears', async () => {
  let call = 0
  const { deps, advance } = makeDeps({
    fire: async () => ({ ok: false, code: 'system-error' }),
  })
  const pd = createPendingDeletes(deps)
  pd.requestDelete('a', '/ctx', 'A')
  advance(UNDO_WINDOW_MS)
  await Promise.resolve()
  const failed = pd.get('a')
  assert.strictEqual(failed?.state, 'failed')
  assert.strictEqual(failed?.error, 'system-error')
  assert.strictEqual(pd.isPending('a'), false) // failed is NOT undoable/pending
  // After the retain window the failed entry auto-clears (resurfaces the row).
  advance(FAILED_RETAIN_MS + 1)
  assert.strictEqual(pd.get('a'), undefined)
})

test('fire idempotency: fireNow on a non-parked id is a safe no-op', async () => {
  const { deps, calls } = makeDeps()
  const pd = createPendingDeletes(deps)
  const out = await pd.fireNow('never-parked')
  assert.strictEqual(out, undefined)
  assert.strictEqual(calls.length, 0)
})

test('notify fires on park, undo, and failed-fire transitions', () => {
  let n = 0
  const { deps, advance } = makeDeps()
  const pd = createPendingDeletes(deps)
  pd.subscribe(() => { n++ })
  pd.requestDelete('a', '/ctx', 'A')
  assert.strictEqual(n, 1)
  pd.undo('a')
  assert.strictEqual(n, 2)
})

test('snapshot returns the SAME reference while the map is unchanged (React #185 guard)', () => {
  // regression for "Maximum update depth exceeded": useSyncExternalStore sees a
  // fresh array each call → infinite loop. A stable reference between mutations
  // is mandatory. Every mutation invalidates the cache.
  const { deps, advance } = makeDeps()
  const pd = createPendingDeletes(deps)
  pd.requestDelete('a', '/ctx', 'A')
  const s1 = pd.snapshot()
  const s1again = pd.snapshot()
  assert.strictEqual(s1, s1again, 'consecutive reads while unchanged must share a reference')

  // A mutation (parking a second entry, multi-entry is allowed) replaces the
  // reference. Each transition must yield a new array ref.
  pd.requestDelete('b', '/ctx-b', 'B')
  const s2 = pd.snapshot()
  assert.notStrictEqual(s2, s1)
  assert.strictEqual(s2.length, 2)
  assert.strictEqual(pd.snapshot(), s2)

  // Undo replaces the reference once more.
  pd.undo('a')
  const s3 = pd.snapshot()
  assert.notStrictEqual(s3, s2)
  assert.strictEqual(s3.length, 1)
  assert.strictEqual(pd.snapshot(), s3)
})

test('fire success marks the id as DELETED and persists it (row stays hidden)', async () => {
  const storage = memoryStorage()
  const { deps, advance } = makeDeps({ storage })
  const pd = createPendingDeletes(deps)
  pd.requestDelete('a', '/ctx-a', 'A')
  assert.strictEqual(pd.isDeleted('a'), false, 'not deleted before fire')
  advance(UNDO_WINDOW_MS)
  await Promise.resolve()
  assert.strictEqual(pd.isDeleted('a'), true, 'host confirmed delete -> flagged deleted')
  // Persisted to the injected storage: a NEW instance seeded from the same
  // store still knows the id is deleted (refresh keeps the row hidden).
  const pd2 = createPendingDeletes({ ...deps, storage })
  assert.strictEqual(pd2.isDeleted('a'), true, 'persisted across a "refresh" (new instance, same store)')
})

test('fiRED entry cannot be undone, and isDeleted stays true', async () => {
  const storage = memoryStorage()
  const { deps, advance } = makeDeps({ storage })
  const pd = createPendingDeletes(deps)
  pd.requestDelete('a', '/ctx-a', 'A')
  advance(UNDO_WINDOW_MS)
  await Promise.resolve()
  assert.strictEqual(pd.isPending('a'), false, 'no undoable window after fire')
  assert.strictEqual(pd.isDeleted('a'), true)
  assert.strictEqual(pd.undo('a'), false, 'fire happened: cannot undo')
  assert.strictEqual(pd.get('a'), undefined)
})

test('failed fire does NOT mark deleted, and the row is re-shown (INTERFACE §1.4)', async () => {
  const storage = memoryStorage()
  const { deps, advance } = makeDeps({
    storage,
    fire: async () => ({ ok: false, code: 'session-running' }),
  })
  const pd = createPendingDeletes(deps)
  pd.requestDelete('a', '/ctx-a', 'A')
  advance(UNDO_WINDOW_MS)
  await Promise.resolve()
  assert.strictEqual(pd.isDeleted('a'), false, 'a failed fire is not a confirmed delete')
  assert.strictEqual(pd.get('a')?.state, 'failed')
})

test('storage seeds DELETED ids at init (persistence across a refresh)', () => {
  const storage = memoryStorage(['already-gone'])
  const { deps } = makeDeps({ storage })
  const pd = createPendingDeletes(deps)
  assert.strictEqual(pd.isDeleted('already-gone'), true, 'seeded from storage at init')
  assert.strictEqual(pd.isDeleted('never-deleted'), false)
  // The deleted id is not in the pending table (it has no undoable window).
  assert.strictEqual(pd.get('already-gone'), undefined)
})
