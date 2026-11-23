// 0.2.2 发送采集（会话事件流）契约测试。
//
// 背景（0.2.2-rc.5 反编译源码 + 真机取证）：
//   - Session.buildSnapshot() 不再返回 nodes（只有 running/promptError/...），
//     旧的主采集路径 `session.getSnapshot().nodes` 在 0.2.2 恒空 → 发送历史
//     静默失效。
//   - 会话事件流仍在 SessionBinding 上（binding.eventSource，同步 change），
//     `user/message` 且 `data.source.kind === 'user'` 才是真人输入；其余同类型
//     事件（system-reminder / time-context / retry / compact-checkpoint）是宿主
//     注入的 user-role 上下文，必须过滤，否则历史里会混进提示词正文。
//
// 覆盖：userTextFromEvent 判别、createEventFeedCapture 水位线（首帧不回补、
// append 增量、seq 重复去重、replace 重置不补录、prepend/settle-assistant 放行），
// 以及与 HistoryNav 的整链（append → 落盘 → ↑ 回填）。

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createEventFeedCapture,
  createHistoryNav,
  historyStorageKey,
  userTextFromEvent,
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

/** 一条会话事件（只造本插件读的字段）。 */
function userEvent(seq, text, sourceKind = 'user') {
  return {
    type: 'user/message',
    seq,
    time: 0,
    data: {
      id: `msg-${seq}`,
      source: { kind: sourceKind },
      content: [{ type: 'text', text }],
    },
  }
}

/** 事件流条目。 */
function entry(event) {
  return { event }
}

/**
 * MutableSessionEventSource 替身：entries + change 同步发布。
 * 与 0.2.2 真实实现同形（append 的 change.entries 只含新条目）。
 */
function fakeFeed() {
  const listeners = new Set()
  const state = {
    entries: [],
    change: { kind: 'replace', entries: [] },
  }
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
    replace(events) {
      state.entries = events.map(entry)
      publish('replace', [...state.entries])
    },
    prepend(events) {
      state.entries = [...events.map(entry), ...state.entries]
      publish('prepend', events.map(entry))
    },
    append(event) {
      state.entries = [...state.entries, entry(event)]
      publish('append', [entry(event)])
    },
    settle() {
      publish('settle-assistant', [])
    },
  }
}

test.describe('userTextFromEvent（0.2.2 事件流 user/message 提取）', () => {
  test('真人用户消息：source.kind === user → content 的 text 块', () => {
    assert.equal(userTextFromEvent(userEvent(1, 'hello')), 'hello')
  })
  test('多 text 块以 \\n 连接（与快照路径口径一致）', () => {
    const event = {
      type: 'user/message',
      seq: 2,
      data: {
        source: { kind: 'user' },
        content: [
          { type: 'text', text: '第一段' },
          { type: 'image', url: 'x' },
          { type: 'text', text: '第二段' },
        ],
      },
    }
    assert.equal(userTextFromEvent(event), '第一段\n第二段')
  })
  test('宿主注入的 user-role 上下文（source.kind 非 user）→ null', () => {
    for (const kind of ['system-reminder', 'time-context', 'retry', 'compact-checkpoint', 'context']) {
      assert.equal(userTextFromEvent(userEvent(3, '注入内容', kind)), null, `source.kind=${kind}`)
    }
  })
  test('非 user/message 事件（assistant/command/turn 等）→ null', () => {
    for (const type of ['assistant/message', 'command/message', 'turn/start', 'user/files']) {
      assert.equal(userTextFromEvent({ type, seq: 4, data: { source: { kind: 'user' }, content: [] } }), null, `type=${type}`)
    }
  })
  test('数据畸形（null/非对象/无 data/无 source）→ null，不抛', () => {
    for (const bad of [null, undefined, 'x', 42, {}, { type: 'user/message' }, { type: 'user/message', data: {} }]) {
      assert.equal(userTextFromEvent(bad), null, String(bad))
    }
  })
})

test.describe('createEventFeedCapture（事件流水位线）', () => {
  /** 装一个 capture；返回记录数组与 pump。 */
  function mountCapture(feed) {
    const recorded = []
    const capture = createEventFeedCapture((text) => recorded.push(text))
    const pump = () => capture.onSnapshot(feed)
    return { recorded, pump }
  }

  test('首帧只建水位线、不回补窗口里已有事件', () => {
    const f = fakeFeed()
    f.replace([userEvent(1, '旧消息')])
    const { recorded, pump } = mountCapture(f.feed)
    pump()
    f.append(userEvent(2, '新消息'))
    pump()
    assert.deepEqual(recorded, ['新消息'])
  })

  test('append 的人类 user/message 采集；宿主注入的 user-role 事件跳过', () => {
    const f = fakeFeed()
    const { recorded, pump } = mountCapture(f.feed)
    pump()
    f.append(userEvent(1, '真消息'))
    pump()
    f.append(userEvent(2, '提示词注入', 'system-reminder'))
    pump()
    f.append(userEvent(3, '时间注入', 'time-context'))
    pump()
    f.append(userEvent(4, '第二条真消息'))
    pump()
    assert.deepEqual(recorded, ['真消息', '第二条真消息'])
  })

  test('seq 水位线：同一事件重复 append 不重复采集', () => {
    const f = fakeFeed()
    const { recorded, pump } = mountCapture(f.feed)
    pump()
    f.append(userEvent(5, 'A'))
    pump()
    // 模拟重放/重复发布：同一 seq 的事件被再次 append
    f.append(userEvent(5, 'A'))
    pump()
    assert.deepEqual(recorded, ['A'])
  })

  test('replace（历史重载）：只重置水位线，不补录旧消息；之后 append 照采', () => {
    const f = fakeFeed()
    const { recorded, pump } = mountCapture(f.feed)
    pump()
    f.append(userEvent(10, 'A'))
    pump()
    f.replace([userEvent(1, '重建窗口1'), userEvent(2, '重建窗口2')])
    pump()
    assert.deepEqual(recorded, ['A'], 'replace 不补录')
    f.append(userEvent(3, '重载后的新消息'))
    pump()
    assert.deepEqual(recorded, ['A', '重载后的新消息'])
  })

  test('prepend（翻页回填旧页）/ settle-assistant（流式结算）不采集', () => {
    const f = fakeFeed()
    const { recorded, pump } = mountCapture(f.feed)
    pump()
    f.prepend([userEvent(1, '更早的旧消息')])
    pump()
    f.settle()
    pump()
    assert.deepEqual(recorded, [])
  })

  test('entries/change 缺失或畸形 → 不抛、不采集', () => {
    const recorded = []
    const capture = createEventFeedCapture((text) => recorded.push(text))
    for (const bad of [undefined, {}, { getSnapshot: () => undefined }, { getSnapshot: () => ({}) }, { getSnapshot: () => ({ entries: 'x' }) }]) {
      capture.onSnapshot(bad)
    }
    assert.deepEqual(recorded, [])
  })
})

test.describe('事件流采集 → 落盘 → ↑ 回填（整链，模拟 ComposerEntry 接线）', () => {
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

  test('0.2.2 路径：append user/message → localStorage → ↑ 回填', () => {
    const storage = memStorage()
    const f = fakeFeed()
    const composer = fakeComposer()
    const nav = createHistoryNav({
      storage,
      setDraft: (text) => { composer.state.value = text },
      composer: () => composer.adapter,
    })
    nav.switchSession('sess-022')
    const capture = createEventFeedCapture((text) => nav.record(text))
    const pump = () => capture.onSnapshot(f.feed)
    pump() // 首帧水位线

    f.append(userEvent(1, '0.2.2 的第一条'))
    pump()
    f.append(userEvent(2, '0.2.2 的第二条'))
    pump()

    const raw = storage.getItem(historyStorageKey('sess-022'))
    assert.deepEqual(JSON.parse(raw), ['0.2.2 的第二条', '0.2.2 的第一条'])

    const press = (key) => nav.onKeydown(
      { key, isComposing: false, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false },
      true,
      false,
    )
    assert.equal(press('ArrowUp'), true)
    assert.equal(composer.state.value, '0.2.2 的第二条', '↑ 回填最新')
    assert.equal(press('ArrowUp'), true)
    assert.equal(composer.state.value, '0.2.2 的第一条', '再 ↑ 更旧')
    assert.equal(press('ArrowDown'), true)
    assert.equal(composer.state.value, '0.2.2 的第二条', '↓ 回填较新')
    assert.equal(press('ArrowDown'), true)
    assert.equal(composer.state.value, '', '↓ 到底恢复原草稿')
  })
})
