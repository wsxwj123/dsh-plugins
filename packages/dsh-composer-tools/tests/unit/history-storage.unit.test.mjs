// 白盒单测：history-storage.ts（lib/history-storage.js 真实实现）
//
// 分工：验收测（test-08）用契约替身覆盖 key/load/save 常规矩阵；
// 本文件用真实实现补白盒边界：空 sessionId、getItem 返回 ''、数组含
// undefined 的 JSON 序列化变形、load 对含非终结元素的裁剪、saveHistory
// 写 JSON.stringify 的具体内容、removeItem 语义（本实现不使用）。

import test from 'node:test'
import assert from 'node:assert/strict'
import { historyStorageKey, loadHistory, saveHistory } from '../../lib/history-storage.js'
import { HISTORY_LIMIT } from '../../lib/history-core.js'

function memStorage(initial = {}) {
  const map = new Map(Object.entries(initial))
  return {
    _map: map,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, v),
    removeItem: (k) => map.delete(k),
  }
}

test.describe('history-storage.unit', () => {
  test.describe('historyStorageKey', () => {
    test('空 sessionId 也合法（key 恰为前缀本身）', () => {
      assert.equal(historyStorageKey(''), 'dsh-composer-tools:history:')
    })
    test('含特殊字符的 sessionId 不被转义，原样拼接', () => {
      assert.equal(historyStorageKey('s:1/2?x=y'), 'dsh-composer-tools:history:s:1/2?x=y')
    })
  })

  test.describe('loadHistory 白盒边界', () => {
    test("getItem 返回空串（不是 null）→ JSON.parse('') 抛错 → []", () => {
      const st = memStorage({ 'dsh-composer-tools:history:s': '' })
      assert.deepEqual(loadHistory(st, 's'), [])
    })
    test('数组内混入 undefined（JSON.stringify 后为 null）→ 过滤后只留 string', () => {
      const st = memStorage({ 'dsh-composer-tools:history:s': JSON.stringify(['a', 'b']) })
      assert.deepEqual(loadHistory(st, 's'), ['a', 'b'])
    })
    test('数组含对象/数组/null 全被过滤，string 保序', () => {
      const st = memStorage({ 'dsh-composer-tools:history:s': JSON.stringify(['x', { a: 1 }, ['y'], 7, false, 'z']) })
      assert.deepEqual(loadHistory(st, 's'), ['x', 'z'])
    })
    test('非字符串数值数组 → 全过滤为空数组', () => {
      const st = memStorage({ 'dsh-composer-tools:history:s': JSON.stringify([1, 2, 3]) })
      assert.deepEqual(loadHistory(st, 's'), [])
    })
    test('超 100 条裁剪保留前 100', () => {
      const many = Array.from({ length: HISTORY_LIMIT + 30 }, (_, i) => `v${i}`)
      const st = memStorage({ 'dsh-composer-tools:history:s': JSON.stringify(many) })
      const out = loadHistory(st, 's')
      assert.equal(out.length, HISTORY_LIMIT)
      assert.equal(out[0], 'v0')
      assert.equal(out[HISTORY_LIMIT - 1], `v${HISTORY_LIMIT - 1}`)
    })
  })

  test.describe('saveHistory 白盒', () => {
    test('写入内容恰为 JSON.stringify(前 100 条)＋可 loadHistory 读回', () => {
      const st = memStorage()
      const entries = ['a', 'b', 'c']
      assert.equal(saveHistory(st, 's', entries), true)
      assert.equal(st._map.get('dsh-composer-tools:history:s'), JSON.stringify(entries))
    })
    test('数组含 undefined：undefined 项在 JSON 中变 null，可写回后再 load 过滤', () => {
      const st = memStorage()
      assert.doesNotThrow(() => saveHistory(st, 's', ['a', undefined, 'b']))
      // JSON.stringify(['a', undefined, 'b']) -> '["a",null,"b"]'；load 过滤 null → ['a','b']
      assert.deepEqual(loadHistory(st, 's'), ['a', 'b'])
    })
    test('超过 100 条只写前 100', () => {
      const st = memStorage()
      const many = Array.from({ length: HISTORY_LIMIT + 5 }, (_, i) => `e${i}`)
      saveHistory(st, 's', many)
      const stored = JSON.parse(st._map.get('dsh-composer-tools:history:s'))
      assert.equal(stored.length, HISTORY_LIMIT)
      assert.equal(stored[0], 'e0')
    })
    test('setItem 抛错 → 返回 false 且不抛', () => {
      const st = memStorage()
      st.setItem = () => {
        throw new Error('QuotaExceededError')
      }
      assert.equal(saveHistory(st, 's', ['a']), false)
    })
    test('removeItem 存在但本实现不调用（保存不删 key）', () => {
      const st = memStorage({ 'dsh-composer-tools:history:s': '["old"]' })
      saveHistory(st, 's', ['new'])
      // key 被覆盖而非被删除，removeItem 未被使用
      assert.equal(st._map.has('dsh-composer-tools:history:s'), true)
      assert.deepEqual(loadHistory(st, 's'), ['new'])
    })
  })
})
