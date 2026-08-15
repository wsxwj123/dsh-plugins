// client localStorage 读写（history-storage.ts / INTERFACE §2.3）契约测试
// 覆盖：key 格式、loadHistory 容错（key 不存在/坏 JSON/非数组/非 string 过滤/超限裁剪）、
// saveHistory 配额满返回 false 不抛出、sessionId 隔离。
//
// 接入：函数从 helpers/contractClient 导入；用内存替身实现 KeyValueStorage。

import test from 'node:test'
import assert from 'node:assert/strict'
import { historyStorageKey, loadHistory, saveHistory, HISTORY_LIMIT } from './helpers/contractClient.mjs'

// 内存版 localStorage 替身
function memStorage() {
  const map = new Map()
  return {
    _map: map,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, v),
    removeItem: (k) => map.delete(k),
  }
}

test.describe('history-storage localStorage 读写', () => {
  test('key 格式恰为 dsh-composer-tools:history:<sessionId>', () => {
    assert.equal(historyStorageKey('abc'), 'dsh-composer-tools:history:abc')
    assert.equal(historyStorageKey('s-123'), 'dsh-composer-tools:history:s-123')
  })

  test('不同 sessionId 用不同 key（会话隔离）', () => {
    assert.notEqual(historyStorageKey('a'), historyStorageKey('b'))
  })

  // —— loadHistory 容错 ——
  test('loadHistory：key 不存在 → []', () => {
    const st = memStorage()
    assert.deepEqual(loadHistory(st, 'nope'), [])
  })
  test('loadHistory：坏 JSON → []', () => {
    const st = memStorage()
    st.setItem(historyStorageKey('s'), '{broken')
    assert.deepEqual(loadHistory(st, 's'), [])
  })
  test('loadHistory：解析结果非数组 → []', () => {
    const st = memStorage()
    st.setItem(historyStorageKey('s'), JSON.stringify({ a: 1 }))
    assert.deepEqual(loadHistory(st, 's'), [])
    st.setItem(historyStorageKey('s'), JSON.stringify('str'))
    assert.deepEqual(loadHistory(st, 's'), [])
    st.setItem(historyStorageKey('s'), JSON.stringify(42))
    assert.deepEqual(loadHistory(st, 's'), [])
  })
  test('loadHistory：过滤非 string 项', () => {
    const st = memStorage()
    st.setItem(historyStorageKey('s'), JSON.stringify(['a', 1, null, true, 'b']))
    assert.deepEqual(loadHistory(st, 's'), ['a', 'b'])
  })
  test('loadHistory：超限裁剪到 100 条（保留前 100）', () => {
    const st = memStorage()
    const many = Array.from({ length: HISTORY_LIMIT + 50 }, (_, i) => `x${i}`)
    st.setItem(historyStorageKey('s'), JSON.stringify(many))
    const out = loadHistory(st, 's')
    assert.equal(out.length, HISTORY_LIMIT)
    assert.equal(out[0], 'x0')
  })
  test('loadHistory：100 条内不动', () => {
    const st = memStorage()
    const arr = ['a', 'b', 'c']
    st.setItem(historyStorageKey('s'), JSON.stringify(arr))
    assert.deepEqual(loadHistory(st, 's'), arr)
  })

  // —— saveHistory ——
  test('saveHistory：写入前 100，成功返回 true，可被 loadHistory 读回', () => {
    const st = memStorage()
    const entries = ['c', 'b', 'a']
    assert.equal(saveHistory(st, 's', entries), true)
    assert.deepEqual(loadHistory(st, 's'), entries)
  })
  test('saveHistory：裁剪到前 100（只写前 100）', () => {
    const st = memStorage()
    const many = Array.from({ length: HISTORY_LIMIT + 10 }, (_, i) => `e${i}`)
    saveHistory(st, 's', many)
    const stored = JSON.parse(st._map.get(historyStorageKey('s')))
    assert.equal(stored.length, HISTORY_LIMIT)
  })
  test('saveHistory：setItem 抛错（配额满）→ 返回 false 不抛出', () => {
    const st = memStorage()
    st.setItem = () => {
      throw new Error('quota exceeded')
    }
    assert.doesNotThrow(() => saveHistory(st, 's', ['a']))
    assert.equal(saveHistory(st, 's', ['a']), false)
  })
  test('saveHistory：sessionId 隔离——不同会话互不覆盖', () => {
    const st = memStorage()
    saveHistory(st, 's1', ['one'])
    saveHistory(st, 's2', ['two'])
    assert.deepEqual(loadHistory(st, 's1'), ['one'])
    assert.deepEqual(loadHistory(st, 's2'), ['two'])
  })
})
