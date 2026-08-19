/**
 * panel-reset.test.mjs — INTERFACE §3.0「面板 UI 态卸载即丢」的门禁。
 *
 * UI 态存在面板工厂闭包里（不是组件 hooks），所以关面板不会自动丢；关闭路径必须显式清。
 * 这条测试在「closePanel 不清 UI 态」的实现下会红，是该契约的判据。
 * engine 不注入（modules 缺失 → engine 为 null）：本条只关心闭包态，不碰皮肤激活链路。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createDoc } from './harness.mjs'
import { createAppearanceRuntime } from '../../src/client.js'

const React = { createElement: () => null, useState: (init) => [init, () => {}], useEffect: () => {} }

function makeRuntime() {
  const map = new Map()
  const storage = {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)) },
    removeItem: (k) => { map.delete(k) },
  }
  const runtime = createAppearanceRuntime({
    React,
    doc: createDoc().document,
    storage,
    themeService: { overrideTokens: () => () => {} },
  })
  return { runtime, storage, map }
}

test('关面板清掉主题面板的搜索词/导入文本/错误文案', () => {
  const { runtime } = makeRuntime()
  const state = runtime.themePanel.state
  runtime.themePanel.setSearch('竹青')
  state.json = '{"id":"x"}'
  state.error = 'ERR_IMPORT_INVALID_JSON: bad'

  runtime.closePanel()

  assert.equal(state.search, '')
  assert.equal(state.json, '')
  assert.equal(state.error, '')
})

test('关面板清掉皮肤面板的搜索词/三件套文本/勾选删除/二次确认', () => {
  const { runtime } = makeRuntime()
  const state = runtime.skinPanel.state
  runtime.skinPanel.setSearch('miku')
  state.skinText = '{"id":"mine"}'
  state.clientText = 'window.__ModuleLoader__.load({})'
  state.a11yText = 'body {}'
  state.error = 'ERR_SKIN_BAD_META: bad'
  state.selectedForDelete = ['mine']
  state.confirming = true

  runtime.closePanel()

  assert.equal(state.search, '')
  assert.equal(state.skinText, '')
  assert.equal(state.clientText, '')
  assert.equal(state.a11yText, '')
  assert.equal(state.error, '')
  assert.deepEqual(state.selectedForDelete, [])
  assert.equal(state.confirming, false)
})

test('reset 不换 state 对象引用（外部持有者不失效）', () => {
  const { runtime } = makeRuntime()
  const before = runtime.themePanel.state
  runtime.closePanel()
  assert.equal(runtime.themePanel.state, before)
})

test('关面板不写任何 storage 键（§3.3 E3）', () => {
  const { runtime, map } = makeRuntime()
  runtime.themePanel.setSearch('x')
  const snapshot = [...map.entries()]
  runtime.closePanel()
  assert.deepEqual([...map.entries()], snapshot)
})
