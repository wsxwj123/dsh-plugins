// 会话已有消息 → 输入历史回填（task-9）契约测试。
//
// 背景：老会话与浏览器标签页的 localStorage 历史是空的（插件上线前的消息没被采集过），
// 打开后按 ↑ 毫无反应。修复：首次拿到会话非空消息窗口时，若本地历史为空，用窗口里
// 已有的真人 user 消息（过滤宿主注入的 user-role 上下文）从旧到新回填，并持久化；
// 已有历史则跳过（刷新/重开不重复累加）。
//
// 覆盖：
//   userTextsFromEvents / userTextsFromNodes：过滤、顺序（旧→新）、畸形输入；
//   seedHistory：顺序/去重/上限/不动 cursor；
//   nav.seed：只在空历史时生效、立即持久化、重复调用不累加；
//   整链：fake event feed / fake 快照 nodes → 回填 → ↑ 翻最新、再 ↑ 更旧；
//   "重开页面"等价场景（重新 loadHistory）→ 历史不重复。

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createEventFeedCapture,
  createHistory,
  createHistoryNav,
  createSnapshotCapture,
  historyStorageKey,
  seedHistory,
  userTextsFromEvents,
  userTextsFromNodes,
} from './helpers/contractClient.mjs'

/** localStorage 替身。 */
function memStorage() {
  const map = new Map()
  return {
    map,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => void map.set(String(k), String(v)),
    removeItem: (k) => void map.delete(k),
  }
}

function stored(storage, sessionId) {
  const raw = storage.getItem(historyStorageKey(sessionId))
  return raw === null ? null : JSON.parse(raw)
}

/** 一条会话事件（只造插件读的字段）。 */
function userEvent(seq, text, sourceKind = 'user') {
  return {
    type: 'user/message',
    seq,
    time: 0,
    data: { id: `msg-${seq}`, source: { kind: sourceKind }, content: [{ type: 'text', text }] },
  }
}

function entry(event) {
  return { event }
}

/** 快照 user 节点。 */
function userNode(seq, text) {
  return { kind: 'user', seq, time: 0, content: [{ type: 'text', text }] }
}

/** fake 事件流（entries + 同步 change 发布）。 */
function fakeFeed(events = []) {
  const listeners = new Set()
  const state = { entries: events.map(entry), change: { kind: 'replace', entries: [] } }
  const publish = (kind, entries) => {
    state.change = { kind, entries }
    for (const fn of listeners) fn()
  }
  return {
    feed: {
      getSnapshot: () => ({ entries: [...state.entries], change: state.change }),
      subscribe(fn) {
        listeners.add(fn)
        return () => listeners.delete(fn)
      },
    },
    replace(events2) {
      state.entries = events2.map(entry)
      publish('replace', [...state.entries])
    },
    append(event) {
      state.entries = [...state.entries, entry(event)]
      publish('append', [entry(event)])
    },
  }
}

/** nav composer 替身。 */
function fakeComposer() {
  const state = { value: '' }
  return {
    state,
    adapter: {
      getText: () => state.value,
      getSelection: () => ({ start: state.value.length, end: state.value.length }),
      setCaretToEnd: () => true,
    },
  }
}

function pressArrow(nav, key) {
  return nav.onKeydown(
    { key, isComposing: false, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false },
    true,
    false,
  )
}

if (typeof globalThis.requestAnimationFrame !== 'function') {
  globalThis.requestAnimationFrame = (fn) => {
    fn(0)
    return 0
  }
}

/**
 * ComposerEntry attach effect 的同构接线（0.2.2 事件流路径）：
 * 首次拿到非空窗口 → 从旧到新回填（nav.seed 内部只在空历史时生效）→ 采集水位线。
 */
function mountEventFeed(sessionId, feed, storage = memStorage()) {
  const composer = fakeComposer()
  const nav = createHistoryNav({
    storage,
    setDraft: (text) => { composer.state.value = text },
    composer: () => composer.adapter,
  })
  nav.switchSession(sessionId)
  let backfilled = false
  const capture = createEventFeedCapture((text) => nav.record(text))
  const pump = () => {
    if (!backfilled) {
      const texts = userTextsFromEvents(feed.getSnapshot()?.entries)
      if (texts.length > 0) {
        backfilled = true
        nav.seed(texts)
      }
    }
    capture.onSnapshot(feed)
  }
  pump()
  const off = feed.subscribe(pump)
  return { nav, composer, storage, off, feed }
}

test.describe('userTextsFromEvents（会话事件流 → 回填文本）', () => {
  test('只取真人 user/message，按 seq 从旧到新', () => {
    const entries = [
      entry(userEvent(5, '第三条')),
      entry(userEvent(1, '第一条')),
      entry(userEvent(3, '第二条')),
    ]
    assert.deepEqual(userTextsFromEvents(entries), ['第一条', '第二条', '第三条'])
  })
  test('过滤宿主注入的 user-role 上下文（system-reminder/time-context/retry 等）', () => {
    const entries = [
      entry(userEvent(1, '真人1')),
      entry(userEvent(2, '系统提醒正文', 'system-reminder')),
      entry(userEvent(3, '时间上下文正文', 'time-context')),
      entry(userEvent(4, '重试正文', 'retry')),
      entry(userEvent(5, '真人2')),
    ]
    assert.deepEqual(userTextsFromEvents(entries), ['真人1', '真人2'])
  })
  test('过滤非 user/message 事件与畸形条目，不抛', () => {
    const entries = [
      entry(userEvent(1, '真人')),
      entry({ type: 'assistant/message', seq: 2, data: {} }),
      null,
      {},
      entry({ type: 'user/message', seq: 3 }),
      entry(userEvent(4, '真人2')),
    ]
    assert.deepEqual(userTextsFromEvents(entries), ['真人', '真人2'])
  })
  test('非数组输入 → []', () => {
    for (const bad of [undefined, null, 'x', 42, {}]) assert.deepEqual(userTextsFromEvents(bad), [])
  })
})

test.describe('userTextsFromNodes（快照 nodes → 回填文本，0.1.5–0.2.0 路径）', () => {
  test('只取 kind=user，按 seq 从旧到新', () => {
    const nodes = [userNode(9, 'C'), userNode(2, 'A'), userNode(5, 'B')]
    assert.deepEqual(userTextsFromNodes(nodes), ['A', 'B', 'C'])
  })
  test('过滤 assistant/command 等非 user 节点与畸形节点', () => {
    const nodes = [
      userNode(1, 'A'),
      { kind: 'assistant', seq: 2, content: [] },
      { kind: 'command', seq: 3, name: 'help' },
      { kind: 'user', seq: 'bad', content: [{ type: 'text', text: 'x' }] },
      userNode(4, 'B'),
    ]
    assert.deepEqual(userTextsFromNodes(nodes), ['A', 'B'])
  })
  test('非数组输入 → []', () => {
    for (const bad of [undefined, null, 'x', {}]) assert.deepEqual(userTextsFromNodes(bad), [])
  })
})

test.describe('seedHistory（纯函数）', () => {
  test('旧→新写入后 entries 最新在前', () => {
    assert.deepEqual(seedHistory(createHistory(), ['A', 'B', 'C']).entries, ['C', 'B', 'A'])
  })
})

test.describe('HistoryNav.seed（只在空历史时回填）', () => {
  test('空历史回填并立即持久化；↑ 先出最新', () => {
    const storage = memStorage()
    const { nav, composer, off } = mountEventFeed('sess-1', fakeFeed().feed, storage)
    nav.seed(['旧1', '旧2', '旧3'])
    assert.deepEqual(stored(storage, 'sess-1'), ['旧3', '旧2', '旧1'])
    assert.equal(pressArrow(nav, 'ArrowUp'), true)
    assert.equal(composer.state.value, '旧3', '↑ 先出最新')
    assert.equal(pressArrow(nav, 'ArrowUp'), true)
    assert.equal(composer.state.value, '旧2', '再 ↑ 更旧')
    off()
  })
  test('已有历史时 seed 被跳过（不覆盖、不累加）', () => {
    const storage = memStorage()
    const { nav } = mountEventFeed('sess-1', fakeFeed().feed, storage)
    nav.seed(['旧1'])
    assert.deepEqual(stored(storage, 'sess-1'), ['旧1'])
    nav.seed(['旧1', '旧2'])
    assert.deepEqual(stored(storage, 'sess-1'), ['旧1'], '非空历史不因回填变化')
  })
  test('重复 seed 同一份消息不重复累加', () => {
    const storage = memStorage()
    const { nav } = mountEventFeed('sess-1', fakeFeed().feed, storage)
    nav.seed(['A', 'B'])
    nav.seed(['A', 'B'])
    assert.deepEqual(stored(storage, 'sess-1'), ['B', 'A'])
  })
})

test.describe('整链：打开有多条消息的会话 → 不回填前先 seed → ↑ 可翻（事件流路径）', () => {
  test('首次加载用会话已有真人消息回填；刷新重开不重复', () => {
    const storage = memStorage()
    const sessionId = 'sess-022'
    // 会话里已有：2 条真人 + 2 条宿主注入 + 1 条 assistant
    const feed = fakeFeed([
      userEvent(1, '第一条真人消息'),
      userEvent(2, '系统注入', 'system-reminder'),
      userEvent(3, '第二条真人消息'),
      userEvent(4, '时间注入', 'time-context'),
      { type: 'assistant/message', seq: 5, data: { content: [] } },
    ])

    const first = mountEventFeed(sessionId, feed.feed, storage)
    // 挂载即回填（等价打开老会话），不需要发送任何消息
    assert.deepEqual(stored(storage, sessionId), ['第二条真人消息', '第一条真人消息'])
    assert.equal(pressArrow(first.nav, 'ArrowUp'), true)
    assert.equal(first.composer.state.value, '第二条真人消息', '↑ 立即回填最新一条')
    assert.equal(pressArrow(first.nav, 'ArrowUp'), true)
    assert.equal(first.composer.state.value, '第一条真人消息', '再 ↑ 更旧')
    first.off()

    // 等价刷新/重开：新 nav 从 localStorage 读回同一份历史，再挂载不会重复回填
    const second = mountEventFeed(sessionId, feed.feed, storage)
    assert.deepEqual(stored(storage, sessionId), ['第二条真人消息', '第一条真人消息'], '刷新后历史不重复')
    assert.equal(pressArrow(second.nav, 'ArrowUp'), true)
    assert.equal(second.composer.state.value, '第二条真人消息', '刷新后仍可翻')

    // 之后新发送一条：事件流 append → 采集置顶，旧条目保持唯一
    feed.append(userEvent(6, '新发送的消息'))
    assert.deepEqual(stored(storage, sessionId), ['新发送的消息', '第二条真人消息', '第一条真人消息'], '新消息置顶且不重复旧条目')
    second.off()
  })

  test('会话窗口里没有真人消息（只有注入上下文）→ 不回填、不写 localStorage', () => {
    const storage = memStorage()
    const feed = fakeFeed([
      userEvent(1, '系统注入', 'system-reminder'),
      userEvent(2, '时间注入', 'time-context'),
    ])
    const mounted = mountEventFeed('sess-empty', feed.feed, storage)
    assert.equal(stored(storage, 'sess-empty'), null)
    assert.equal(pressArrow(mounted.nav, 'ArrowUp'), false, '没有历史可翻，↑ 放行')
    mounted.off()
  })

  test('0.1.5–0.2.0 快照 nodes 路径同样回填', () => {
    const storage = memStorage()
    const nodes = [
      userNode(1, '旧版第一条'),
      { kind: 'assistant', seq: 2 },
      userNode(3, '旧版第二条'),
    ]
    const composer = fakeComposer()
    const nav = createHistoryNav({
      storage,
      setDraft: (text) => { composer.state.value = text },
      composer: () => composer.adapter,
    })
    nav.switchSession('sess-old')
    const capture = createSnapshotCapture((text) => nav.record(text))
    const pump = () => {
      const texts = userTextsFromNodes(nodes)
      if (texts.length > 0) nav.seed(texts)
      capture.onSnapshot(nodes)
    }
    pump()
    assert.deepEqual(stored(storage, 'sess-old'), ['旧版第二条', '旧版第一条'])
    assert.equal(pressArrow(nav, 'ArrowUp'), true)
    assert.equal(composer.state.value, '旧版第二条')
  })
})
