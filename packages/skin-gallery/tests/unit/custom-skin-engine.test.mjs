/**
 * custom-skin-engine.test.mjs — 自定义 bundle 动态注册走真实激活链路（INTERFACE §3.6 / §8.1）。
 * 用 skin-harness 的假模块系统 + 假 DOM：registerCustomBundle 后 getSkins 含自定义项，
 * activateSkin 能加载并应用该动态 bundle，卸载可逆。
 */
import { test, describe, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { createSkinEngine } from '../../src/skin-engine.js'
import { makeWindow, executeOnWindow } from './harness.mjs'

/** 合规自定义 client：load(id) + factory 导出 apply(ctx)，只消费 ctx.effect。 */
const OK_CLIENT = (id) => `window.__ModuleLoader__.load({
  id: ${JSON.stringify(id)},
  factory: function() {
    return {
      apply: function(ctx) {
        document.body.setAttribute('data-dsh-' + ${JSON.stringify(id)}, '')
        ctx.effect(function() { return function() { document.body.removeAttribute('data-dsh-' + ${JSON.stringify(id)}) } }, 'custom-' + ${JSON.stringify(id)})
      }
    };
  }
})`

describe('skin-engine 动态注册自定义 bundle', () => {
  let win
  afterEach(() => {
    if (win) { globalThis.document = win._prevDoc }
  })

  test('registerCustomBundle 后 getSkins 含自定义项（source=custom）', () => {
    win = makeWindow()
    const engine = createSkinEngine({ modules: win.__DSH_MODULES__, manifest: [], bundles: {}, executeScript: (code) => executeOnWindow(win, code) })
    const entry = engine.registerCustomBundle({
      id: 'my-custom', name: 'My Skin', bundleText: OK_CLIENT('my-custom'), package: 'my-custom', bodyAttr: 'data-dsh-my-custom',
    })
    assert.equal(entry.source, 'custom')
    assert.ok(engine.getSkins().some((s) => s.id === 'my-custom' && s.source === 'custom'))
  })

  test('registerCustomBundle 后 activateSkin 全链路：body 属性出现、可逆卸载', async () => {
    win = makeWindow()
    win._prevDoc = globalThis.document
    globalThis.document = win.document
    const engine = createSkinEngine({ modules: win.__DSH_MODULES__, manifest: [], bundles: {}, executeScript: (code) => executeOnWindow(win, code) })
    engine.registerCustomBundle({ id: 'my-custom', name: 'My', bundleText: OK_CLIENT('my-custom'), package: 'my-custom', bodyAttr: 'data-dsh-my-custom' })
    const entry = engine.getSkins().find((s) => s.id === 'my-custom')
    await engine.activateSkin(entry)
    assert.equal(win.document.body.hasAttribute('data-dsh-my-custom'), true, '自定义皮肤 body 属性生效')
    assert.equal(engine.currentSkinState().active, true)
    engine.deactivateSkin()
    assert.equal(win.document.body.hasAttribute('data-dsh-my-custom'), false, '卸载后 body 属性清除')
    assert.equal(engine.currentSkinState().active, false)
  })

  test('registerCustomBundle 重新注册同 id 不移除原 bundle（invalidate 后重新加载）', () => {
    win = makeWindow()
    const engine = createSkinEngine({ modules: win.__DSH_MODULES__, manifest: [], bundles: {}, executeScript: (code) => executeOnWindow(win, code) })
    engine.registerCustomBundle({ id: 'dup', name: 'A', bundleText: OK_CLIENT('dup') })
    engine.registerCustomBundle({ id: 'dup', name: 'B', bundleText: OK_CLIENT('dup') })
    const matches = engine.getSkins().filter((s) => s.id === 'dup')
    assert.equal(matches.length, 1, '同 id 覆盖而非重复')
    assert.equal(matches[0].name, 'B')
  })
})
