/**
 * registry-memo.test.mjs — G5 解析记忆化的白盒自测（主题 / 皮肤两侧各跑一遍）。
 *
 * 两侧是各写一份实现（不抽公共 helper），所以断言必须两侧都有，
 * 否则「改一边忘一边」不会被任何测试发现。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createCustomThemeApi } from '../../src/custom-theme.js'
import { createCustomSkinApi } from '../../src/custom-skin.js'

/** 计数 storage：只数 JSON.parse 次数需要一个能观测的钩子，这里用「读到的原文」间接数 */
function countingStorage(seed = {}) {
  const map = new Map(Object.entries(seed))
  const stats = { parse: 0 }
  const native = JSON.parse
  return {
    stats,
    storage: {
      getItem: (k) => (map.has(k) ? map.get(k) : null),
      setItem: (k, v) => { map.set(k, String(v)) },
      removeItem: (k) => { map.delete(k) },
    },
    /** 在回调期间把 JSON.parse 换成计数版本（只在本进程本次调用内生效） */
    measure(fn) {
      JSON.parse = (...args) => { stats.parse += 1; return native(...args) }
      try { fn() } finally { JSON.parse = native }
    },
  }
}

const themeRegistry = JSON.stringify({
  version: 1,
  items: [{ id: 'a', label: 'A', tokens: { '--dsw-bg': { light: '#fff', dark: '#000' } } }],
})
const skinRegistry = JSON.stringify({
  version: 1,
  items: [{ id: 's', name: 'S', author: 'x', license: 'MIT', bodyAttr: 'data-dsh-s', order: 100, source: 'custom', bundleText: 'x', a11yText: '' }],
})

test('主题侧_连续10次读registry只解析1次', () => {
  const box = countingStorage({ 'theme-gallery-custom-v1': themeRegistry })
  const api = createCustomThemeApi({ storage: box.storage, builtinThemes: [{ id: 'jade', label: '竹青' }] })
  api.getCustomThemes() // 预热（首解析发生在 measure 之外）
  box.measure(() => { for (let i = 0; i < 10; i += 1) api.getCustomThemes() })
  assert.equal(box.stats.parse, 0, '原文未变时不该再解析')
})

test('主题侧_写入后下一次读恰好重新解析1次', async () => {
  const box = countingStorage({ 'theme-gallery-custom-v1': themeRegistry })
  const api = createCustomThemeApi({ storage: box.storage, builtinThemes: [] })
  api.getCustomThemes()
  await api.importCustomTheme(JSON.stringify({ id: 'b', label: 'B', tokens: { '--dsw-x': { light: '1', dark: '2' } } }))
  box.measure(() => { api.getCustomThemes(); api.getCustomThemes() })
  assert.equal(box.stats.parse, 1)
})

test('皮肤侧_连续10次读registry只解析1次', () => {
  const box = countingStorage({ 'skin-gallery-custom-v1': skinRegistry })
  const api = createCustomSkinApi({ storage: box.storage, builtinSkins: [] })
  api.getCustomSkins()
  box.measure(() => { for (let i = 0; i < 10; i += 1) api.getCustomSkins() })
  assert.equal(box.stats.parse, 0)
})

test('皮肤侧_写入后下一次读恰好重新解析1次', () => {
  const box = countingStorage({ 'skin-gallery-custom-v1': skinRegistry })
  const api = createCustomSkinApi({ storage: box.storage, builtinSkins: [] })
  api.getCustomSkins()
  api.deleteCustomSkin('s')
  box.measure(() => { api.getCustomSkins(); api.getCustomSkins() })
  assert.equal(box.stats.parse, 1)
})

test('记忆化不返回被调用方改脏的数组', () => {
  const box = countingStorage({ 'skin-gallery-custom-v1': skinRegistry })
  const api = createCustomSkinApi({ storage: box.storage, builtinSkins: [] })
  const first = api.getCustomSkins()
  first.push({ id: 'ghost' }) // 调用方就地 mutate 返回值
  assert.deepEqual(api.getCustomSkins().map((s) => s.id), ['s'], '缓存被调用方污染了')
})
