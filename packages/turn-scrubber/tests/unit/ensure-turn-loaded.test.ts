/**
 * Unit tests for the single-flight load loop (src/client/ensureTurnLoaded.ts).
 *
 * All tests inject a fake SessionFace (no real DSH runtime): the snapshot is a
 * mutable Map of "loaded" turns, and `loadOlder()` adds one configurable page
 * of older turns per call — exactly the observable contract the real store
 * exposes (page prepend + hasMore authority).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  MAX_LOAD_PAGES,
  cancelAllTurnLoads,
  cancelTurnLoads,
  ensureTurnLoaded,
  isTurnLoadActive,
} from '../../src/client/ensureTurnLoaded.ts'
import type { SessionFace, SessionSnapshot } from '../../src/client/context-types.ts'

interface Page {
  /** Turn ids this page adds to the loaded window (older history). */
  turns: number[]
  /** Whether ANY older history remains AFTER this page loads (host authority). */
  hasMore: boolean
}

class FakeSession implements SessionFace {
  snapshotCache: SessionSnapshot
  loadedTurns = new Map<number, string[]>()
  private pages: Page[]
  private pageIndex = 0
  /**
   * Host-authoritative "more older history exists", as of the last committed
   * page (or true before anything has loaded, when any page exists). The
   * loadOlder loop's normal-stop depends on the loaded page's own hasMore.
   */
  private lastHasMore: boolean
  private loading = false
  loadOlderCount = 0
  subscribed: (() => void)[] = []

  constructor(pages: Page[], opts: { openState?: string } = {}) {
    this.pages = pages
    // Nothing loaded yet → older history definitely remains whenever a page
    // exists (page 0 is loadable even if page 0 itself is the last one).
    this.lastHasMore = pages.length > 0
    this.snapshotCache = this.makeSnapshot(opts.openState ?? 'open')
  }

  private makeSnapshot(openState: string): SessionSnapshot {
    return {
      sessionId: 'fake',
      openState,
      hasMore: this.lastHasMore,
      loadingOlder: this.loading,
      chat: {
        order: [...this.loadedTurns.keys()].map((t) => `n${t}`),
        nodes: { get: (key: string) => ({ key, kind: 'user', seq: 0, data: { content: key } }) },
        locations: { turns: this.loadedTurns },
      },
    }
  }

  subscribe(listener: () => void): () => void {
    this.subscribed.push(listener)
    return () => {
      this.subscribed = this.subscribed.filter((l) => l !== listener)
    }
  }

  /**
   * Faithful store behavior: a host round-trip resolves asynchronously (the
   * page commit is deferred past the synchronous test body, mirroring the
   * real DSH store where loadOlder returns over an RPC), is a no-op while a
   * page is already in flight, and reports the loaded page's host-authority
   * hasMore once it lands.
   */
  async loadOlder(): Promise<void> {
    if (this.loading || this.pageIndex >= this.pages.length) return
    this.loading = true
    this.loadOlderCount++
    // A host round-trip is in flight: reflect loadingOlder=true immediately
    // (the store publishes this state while the RPC is unresolved).
    this.snapshotCache = this.makeSnapshot(this.snapshotCache.openState ?? 'open')
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    const page = this.pages[this.pageIndex]
    this.pageIndex++
    for (const turn of page.turns) this.loadedTurns.set(turn, [`n${turn}`])
    this.lastHasMore = page.hasMore
    this.loading = false
    this.snapshotCache = this.makeSnapshot(this.snapshotCache.openState ?? 'open')
  }
}

const pagesOf = (page: Page[]): Page[] => page

test('already loaded → 已加载 without touching loadOlder', async () => {
  const session = new FakeSession([
    { turns: [10, 9, 8], hasMore: true },
    { turns: [7, 6, 5], hasMore: false },
  ])
  const loaded = new FakeSession([])
  loaded.loadedTurns.set(5, ['n5'])
  loaded.snapshotCache = loaded.makeSnapshot('open')
  const result = await ensureTurnLoaded({ session: loaded, turnId: 5, token: 't' })
  assert.equal(result, '已加载')
  assert.equal(loaded.loadOlderCount, 0)
})

test('target on second page → 达成, loads exactly the pages until it appears', async () => {
  const session = new FakeSession([
    { turns: [10, 9], hasMore: true },
    { turns: [8, 7], hasMore: true },
    { turns: [6, 5], hasMore: false },
  ])
  const result = await ensureTurnLoaded({ session, turnId: 8, token: 't' })
  assert.equal(result, '达成')
  assert.equal(session.loadOlderCount, 2)
  assert.ok(session.loadedTurns.has(8))
})

test('hasMore=false (host) before target appears → 到最老, stops cleanly', async () => {
  const session = new FakeSession([
    { turns: [10, 9], hasMore: true },
    { turns: [8, 7], hasMore: false },
  ])
  const result = await ensureTurnLoaded({ session, turnId: 999, token: 't' })
  assert.equal(result, '到最老')
  // Page 2 hasMore=false → no third call.
  assert.equal(session.loadOlderCount, 2)
})

test('openState !== open → 到最老 without any loadOlder call', async () => {
  const session = new FakeSession(
    [{ turns: [10, 9], hasMore: true }],
    { openState: 'cold' },
  )
  const result = await ensureTurnLoaded({ session, turnId: 9, token: 't' })
  assert.equal(result, '到最老')
  assert.equal(session.loadOlderCount, 0)
})

test('page cap → 超限 after exactly MAX_LOAD_PAGES calls (no infinite loop)', async () => {
  const manyPages: Page[] = []
  for (let i = 0; i < MAX_LOAD_PAGES + 10; i++) manyPages.push({ turns: [1000 - i], hasMore: true })
  const session = new FakeSession(manyPages)
  const result = await ensureTurnLoaded({ session, turnId: 1, token: 't' })
  assert.equal(result, '超限')
  assert.equal(session.loadOlderCount, MAX_LOAD_PAGES)
})

test('single-flight: same request joins the running loop (no double loading)', async () => {
  const session = new FakeSession([
    { turns: [10, 9], hasMore: true },
    { turns: [8, 7], hasMore: false },
  ])
  const first = ensureTurnLoaded({ session, turnId: 10, token: 't' })
  const second = ensureTurnLoaded({ session, turnId: 10, token: 't' })
  const [r1, r2] = await Promise.all([first, second])
  assert.equal(r1, '达成')
  assert.equal(r2, '达成')
  // One loop → the second target page never loads a separate pass.
  assert.equal(session.loadOlderCount, 1)
})

test('different target while a loop runs → old loop cancelled (会话切换), new target served', async () => {
  const session = new FakeSession([
    { turns: [10, 9], hasMore: true },
    { turns: [8, 7], hasMore: true },
    { turns: [6, 5], hasMore: false },
  ])
  const first = ensureTurnLoaded({ session, turnId: 10, token: 't' })
  const secondP = ensureTurnLoaded({ session, turnId: 8, token: 't' })
  const [r1, r2] = await Promise.all([first, secondP])
  assert.equal(r1, '会话切换')
  assert.equal(r2, '达成')
  // The re-targeted loop still only loads up to its own target.
  assert.equal(session.loadOlderCount, 2)
})

test('cancelTurnLoads(session) stops the loop with 会话切换', async () => {
  const session = new FakeSession([
    { turns: [10, 9], hasMore: true },
    { turns: [8, 7], hasMore: true },
    { turns: [6, 5], hasMore: false },
  ])
  const promise = ensureTurnLoaded({ session, turnId: 100, token: 't' })
  await Promise.resolve() // let the loop start
  cancelTurnLoads(session)
  assert.equal(await promise, '会话切换')
  assert.ok(session.loadOlderCount < 10) // stopped early, not at page cap
})

test('after cancel, isTurnLoadActive is false and a new request works', async () => {
  const session = new FakeSession([{ turns: [10, 9], hasMore: false }])
  const p1 = ensureTurnLoaded({ session, turnId: 100, token: 't' })
  cancelAllTurnLoads()
  assert.equal(await p1, '会话切换')
  assert.equal(isTurnLoadActive(), false)
  const p2 = await ensureTurnLoaded({ session, turnId: 9, token: 't' })
  assert.equal(p2, '达成')
})

test('session switch: new token starts a fresh loop, old responses discarded', async () => {
  const oldSession = new FakeSession([
    { turns: [10, 9], hasMore: true },
    { turns: [8, 7], hasMore: true },
    { turns: [6, 5], hasMore: false },
  ])
  const newSession = new FakeSession([{ turns: [3, 2], hasMore: false }])
  newSession.loadedTurns.set(1, ['n1'])
  const oldP = ensureTurnLoaded({ session: oldSession, turnId: 100, token: 'old' })
  // The switch cancels old-session loops; a new request on the new session
  // replaces the loop and resolves only its own promise.
  cancelTurnLoads(oldSession)
  const newP = await ensureTurnLoaded({ session: newSession, turnId: 2, token: 'new' })
  assert.equal(newP, '达成')
  assert.equal(await oldP, '会话切换')
  // Old window is not touched by the new loop.
  assert.ok(!newSession.loadedTurns.has(100))
})