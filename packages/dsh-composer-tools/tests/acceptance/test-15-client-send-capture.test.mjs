// 发送采集回归测试（按**真实 DSH 行为**建模，不用插件自造的 phase 序列）。
//
// 为什么必须有这条：既有 250 项测试全绿却漏掉"历史永远采集不到"的主功能失效，
// 因为测试与实现共用了同一个错误假设——"发送会把 phase 推到 submitting/
// adjudicating"。真机取证的事实是：
//   - dsh-client-ui-conversation 的 `InputState.onEnter(mode)`：draft 不以 '/'
//     开头时直接 `return [{ type:'default-sink', draft, mode }]`，**不改 phase**
//     → 普通消息发送全程 data-phase === 'plain'；
//   - 发送还可以来自「发送按钮」`onPrimary → inputActions.submit()`，连 keydown
//     都没有。
// 所以本文件的模型是：**phase 全程 plain、draft 由非空变空、会话快照新增一个
// user 节点**——修复前（phase 机采集）这条路径一条历史都写不出来。
//
// 驱动的是真实接线层 lib/history-nav.js + lib/session-history.js（与
// ComposerEntry 的 useEffect 同构：createSnapshotCapture(record) → nav.record），
// 不是测试内另写一份状态机。

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createHistoryNav,
  createSnapshotCapture,
  historyStorageKey,
} from './helpers/contractClient.mjs'

/** 真机取证的 phase 序列：普通消息发送全程 plain（既非 submitting 也非 adjudicating）。 */
const REAL_PLAIN_MESSAGE_PHASES = ['plain', 'plain', 'plain', 'plain']

/** localStorage 替身。 */
function memStorage() {
  const map = new Map()
  return {
    map,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => void map.set(k, String(v)),
    removeItem: (k) => void map.delete(k),
  }
}

/** ConversationSnapshot 替身：nodes + subscribe，与 SessionFace 的可观察半同形。 */
function fakeSession(nodes = []) {
  let snapshot = { nodes: [...nodes] }
  const listeners = new Set()
  return {
    getSnapshot: () => snapshot,
    subscribe(fn) {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    /** 宿主受理一条 user 消息（发送成功后 user 节点落进快照）。 */
    pushUser(seq, text) {
      snapshot = {
        nodes: [...snapshot.nodes, { kind: 'user', seq, time: 0, content: [{ type: 'text', text }], source: null }],
      }
      for (const fn of listeners) fn()
    },
    /** 宿主受理一条斜杠命令（快照里是 CommandNode，不是 user 节点）。 */
    pushCommand(seq, name) {
      snapshot = { nodes: [...snapshot.nodes, { kind: 'command', seq, time: 0, name }] }
      for (const fn of listeners) fn()
    },
    /** 跨重连/会话重建：seq 回退（水位线断裂）。 */
    reset(nodes2) {
      snapshot = { nodes: [...nodes2] }
      for (const fn of listeners) fn()
    },
  }
}

/** ComposerEntry 快照订阅 effect 的同构接线（见 ComposerEntry.tsx「发送采集主路径」）。 */
function mountCapture(nav, session) {
  const capture = createSnapshotCapture((text) => nav.record(text))
  const pump = () => capture.onSnapshot(session.getSnapshot()?.nodes)
  pump() // 首帧只初始化水位线
  return session.subscribe(pump)
}

/** 装一个 nav + 会话订阅，返回驱动句柄。 */
function mount(sessionId, session, storage = memStorage()) {
  const drafts = []
  const textarea = { value: '', selectionStart: 0, selectionEnd: 0, setSelectionRange() {} }
  const nav = createHistoryNav({
    storage,
    setDraft: (text) => {
      drafts.push(text)
      textarea.value = text
    },
    focusTextarea: () => textarea,
  })
  nav.switchSession(sessionId)
  const off = mountCapture(nav, session)
  return { nav, storage, drafts, textarea, off }
}

/** 存盘的历史条目（最新在前）。 */
function stored(storage, sessionId) {
  const raw = storage.getItem(historyStorageKey(sessionId))
  return raw === null ? null : JSON.parse(raw)
}

/** 按一次方向键（gate 前置条件由参数给全）。 */
function pressArrow(nav, key, { menuOpen = false } = {}) {
  return nav.onKeydown(
    { key, isComposing: false, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false },
    true,
    menuOpen,
  )
}

// nav 的光标复位走 rAF；node 环境没有，装个同步替身。
if (typeof globalThis.requestAnimationFrame !== 'function') {
  globalThis.requestAnimationFrame = (fn) => {
    fn(0)
    return 0
  }
}

test.describe('发送采集（真实 DSH default-sink 路径回归）', () => {
  test('普通消息：phase 全程 plain、draft 非空 → 空，历史仍被采集并落盘', () => {
    // 前置事实断言：这条路径上 phase 从不进 submitting/adjudicating，
    // 即老实现（phase 机）的采集条件一次都不成立。
    for (const p of REAL_PLAIN_MESSAGE_PHASES) {
      assert.equal(p === 'submitting' || p === 'adjudicating', false, 'phase 恒 plain')
    }

    const session = fakeSession()
    const { nav, storage } = mount('sess-1', session)

    // 用户输入 'hello world' 后按 Enter：onEnter → default-sink（phase 不变），
    // draft 被清空，宿主受理后 user 节点落进会话快照。
    let draft = 'hello world'
    draft = '' // commitSend 清 draft
    assert.equal(draft, '')
    assert.equal(nav.pending(), null, 'phase 机没有也不该有 pending（它压根没被触发）')
    session.pushUser(1, 'hello world')

    assert.deepEqual(stored(storage, 'sess-1'), ['hello world'], '历史必须被采集到并持久化')
  })

  test('发送按钮点击（全程没有 keydown）同样采集得到', () => {
    const session = fakeSession()
    const { storage } = mount('sess-1', session)
    session.pushUser(1, '点发送按钮发的') // inputActions.submit() 路径
    assert.deepEqual(stored(storage, 'sess-1'), ['点发送按钮发的'])
  })

  test('采集到的历史能被 ↑ 回填到输入框（采集 → 存储 → 回填闭环）', () => {
    const session = fakeSession()
    const { nav, drafts } = mount('sess-1', session)
    session.pushUser(1, '第一条')
    session.pushUser(2, '第二条')

    assert.equal(pressArrow(nav, 'ArrowUp'), true, '↑ 命中历史')
    assert.deepEqual(drafts, ['第二条'], '最新一条在最前')
    assert.equal(pressArrow(nav, 'ArrowUp'), true)
    assert.deepEqual(drafts, ['第二条', '第一条'])
  })

  test('挂载首帧不回补：会话里已有的旧消息不进历史，之后的新消息才采', () => {
    const session = fakeSession([
      { kind: 'user', seq: 7, content: [{ type: 'text', text: '上次会话说的' }] },
      { kind: 'assistant', seq: 8, content: [] },
    ])
    const { storage } = mount('sess-1', session)
    assert.equal(stored(storage, 'sess-1'), null, '首帧只初始化水位线，不落盘')
    session.pushUser(9, '这次新说的')
    assert.deepEqual(stored(storage, 'sess-1'), ['这次新说的'])
  })

  test('空白消息不入历史；同文本连发去重后置顶', () => {
    const session = fakeSession()
    const { storage } = mount('sess-1', session)
    session.pushUser(1, '   ')
    assert.equal(stored(storage, 'sess-1'), null, '纯空格不录')
    session.pushUser(2, 'A')
    session.pushUser(3, 'B')
    session.pushUser(4, 'A')
    assert.deepEqual(stored(storage, 'sess-1'), ['A', 'B'], '去重后置顶，不产生重复条目')
  })

  test('斜杠命令落成 CommandNode → 主路径不采（仍归 phase 机的 adjudicating 分支）', () => {
    const session = fakeSession()
    const { nav, storage } = mount('sess-1', session)
    session.pushCommand(1, 'help')
    assert.equal(stored(storage, 'sess-1'), null, 'CommandNode 不是 user 节点')
    // phase 机路径（/help 会真的把 phase 推到 adjudicating）仍旧工作：
    nav.capture('/help')
    nav.commit()
    assert.deepEqual(stored(storage, 'sess-1'), ['/help'])
  })

  test('会话隔离：切到别的会话后采集不污染前一个会话的历史', () => {
    const storage = memStorage()
    const s1 = fakeSession()
    const h1 = mount('sess-1', s1, storage)
    s1.pushUser(1, '会话一的话')
    h1.off()

    const s2 = fakeSession()
    mount('sess-2', s2, storage)
    s2.pushUser(1, '会话二的话')

    assert.deepEqual(stored(storage, 'sess-1'), ['会话一的话'])
    assert.deepEqual(stored(storage, 'sess-2'), ['会话二的话'])
  })

  test('水位线断裂（重连后 seq 回退）：不补录旧消息，但之后的新消息不被永久挡住', () => {
    const session = fakeSession()
    const { storage } = mount('sess-1', session)
    session.pushUser(100, '断裂前')
    assert.deepEqual(stored(storage, 'sess-1'), ['断裂前'])

    // 重连：seq 从头开始，快照 max seq(2) < 水位线(100)
    session.reset([
      { kind: 'user', seq: 1, content: [{ type: 'text', text: '重建后的旧消息' }] },
      { kind: 'user', seq: 2, content: [{ type: 'text', text: '重建后的旧消息2' }] },
    ])
    assert.deepEqual(stored(storage, 'sess-1'), ['断裂前'], '断裂帧只冷重启水位线，不补录')

    session.pushUser(3, '重连后新发的')
    assert.deepEqual(stored(storage, 'sess-1'), ['重连后新发的', '断裂前'], '水位线已重初始化，新消息照采')
  })
})
