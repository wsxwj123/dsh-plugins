/**
 * skin-engine.test.mjs — 皮肤引擎白盒单元测试（node:test，无外部依赖）。
 *
 * 覆盖（对照 INTERFACE §2/§4）：
 *   - 引擎只读方法 getSkins / currentSkinState 数据契约
 *   - activateSkin 全链路：加载(bundle 注册)→ materialize(apply)→ body 属性出现
 *   - deactivateSkin 幂等：第二次 no-op、无 body 残留
 *   - 切换互斥：从 A 切到 B，A 全部清退、B 生效
 *   - unknown-skin（无 bundle）拒绝、不产生副作用
 *   - 同一皮肤重复激活 no-op，不重复注入 style
 *   - 皮肤自带 disposer 在引擎驱动下真实可逆（卸载后注入 DOM / chrome 移除）
 *   - miniCtx.effect 语义：立即执行 fn 并收集返回 disposer，卸载时按注册逆序执行
 */
import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createSkinEngine } from '../../src/skin-engine.js'
import { makeWindow, executeOnWindow } from './harness.mjs'

const buildManifest = async (ids) => {
  const out = []
  for (const id of ids) {
    const meta = JSON.parse(await readFile(new URL(`../../skins/${id}/skin.json`, import.meta.url), 'utf8'))
    out.push({
      id: meta.id, name: meta.name, nameEn: meta.nameEn, author: meta.author,
      tagline: meta.tagline, accent: meta.accent, bodyAttr: meta.bodyAttr,
      order: meta.order, package: meta.package,
      bundleFile: `skins/${id}/client.js`, a11yFile: `skins/${id}/a11y.css`, license: 'BSD-3-Clause',
    })
  }
  return out.sort((a, b) => a.order - b.order)
}

let win
let prevDoc

beforeEach(async () => {
  win = makeWindow()
  prevDoc = globalThis.document
  globalThis.document = win.document
})

afterEach(() => {
  if (prevDoc !== undefined) globalThis.document = prevDoc
  else delete globalThis.document
})

const makeEngine = async (ids) => {
  const manifest = await buildManifest(ids)
  const bundles = {}
  for (const id of ids) bundles[id] = await readFile(new URL(`../../skins/${id}/client.js`, import.meta.url), 'utf8')
  return createSkinEngine({
    modules: win.__DSH_MODULES__,
    manifest,
    bundles,
    executeScript: (code) => executeOnWindow(win, code),
  })
}

// 一个低依赖「假皮肤」bundle：factory 注册一个 apply，apply 消费 ctx.effect 收集
// disposer，并设置一个 body 属性 + 注入一个 style（复刻真实皮肤的副作用形态）。
const FAKE_PKG = '@test/skin-fake'
function registerFakeSkin(id, bodyAttr, kind = 'collect') {
  const factory = () => {
    // materialize 时自注入一个 style（真实 bundle 行为）：
    const st = document.createElement('style')
    st.setAttribute('data-plugin', FAKE_PKG + '/' + id)
    st.textContent = `body[${bodyAttr}] { color: red }`
    document.head.appendChild(st)
    return {
      apply(ctx) {
        document.body.dataset[id] = ''
        if (kind === 'collect') {
          ctx.effect(() => () => {
            delete document.body.dataset[id]
            for (const el of Array.from(document.querySelectorAll(`style[data-plugin="${FAKE_PKG}/${id}"]`))) el.remove()
          }, `fake-${id}`)
        }
      },
    }
  }
  win.__ModuleLoader__.load({ id: FAKE_PKG + '/' + id, factory })
}

describe('皮肤引擎（真实 qq98 / ths bundle）', () => {
  test('getSkins 返回清单且与皮肤资产一致', async () => {
    const engine = await makeEngine(['qq98', 'ths', 'xp'])
    const skins = engine.getSkins()
    assert.equal(skins.length, 3)
    assert.equal(skins[0].id, 'qq98')
    assert.equal(skins[0].license, 'BSD-3-Clause')
    assert.equal(skins[0].bodyAttr, 'data-dsh-retro')
    assert.ok(skins.every((s) => s.author && s.package && s.order))
  })

  test('activateSkin 全链路：body 属性出现、内置 style 注入、状态正确', async () => {
    const engine = await makeEngine(['qq98'])
    const entry = engine.getSkins()[0]
    await engine.activateSkin(entry)
    assert.equal(win.document.body.hasAttribute('data-dsh-retro'), true, 'body 属性应出现')
    const skinStyles = win.document.querySelectorAll(`style[data-plugin="${entry.package}"]`)
    assert.ok(skinStyles.length > 0, '皮肤内置 style 已注入')
    const state = engine.currentSkinState()
    assert.equal(state.active, true)
    assert.equal(state.skinId, 'qq98')
  })

  test('deactivateSkin 幂等：第二次 no-op、body 无残留', async () => {
    const engine = await makeEngine(['qq98'])
    const entry = engine.getSkins()[0]
    await engine.activateSkin(entry)
    assert.equal(win.document.body.hasAttribute('data-dsh-retro'), true)
    engine.deactivateSkin()
    assert.equal(win.document.body.hasAttribute('data-dsh-retro'), false, 'body 属性已清')
    engine.deactivateSkin()
    assert.equal(engine.currentSkinState().active, false)
  })

  test('切换互斥：从 A 切到 B，A 消失、B 生效', async () => {
    const engine = await makeEngine(['qq98', 'ths'])
    const [a, b] = engine.getSkins()
    await engine.activateSkin(a)
    assert.equal(win.document.body.hasAttribute('data-dsh-retro'), true)
    await engine.activateSkin(b)
    assert.equal(win.document.body.hasAttribute('data-dsh-ths'), true, 'B body 属性生效')
    assert.equal(win.document.body.hasAttribute('data-dsh-retro'), false, 'A body 属性已清退')
  })

  test('同一皮肤重复激活 no-op，不重复注入 style', async () => {
    const engine = await makeEngine(['qq98'])
    const entry = engine.getSkins()[0]
    await engine.activateSkin(entry)
    const stylesBefore = win.document.querySelectorAll(`style[data-plugin="${entry.package}"]`).length
    await engine.activateSkin(entry)
    const stylesAfter = win.document.querySelectorAll(`style[data-plugin="${entry.package}"]`).length
    assert.equal(stylesAfter, stylesBefore, '重复激活不重复注入 style')
  })

  test('unknown-skin（无 bundle）拒绝且无副作用', async () => {
    const engine = await makeEngine(['qq98'])
    const bad = { id: 'nope', package: '@linxin666/dsh-client-ui-skin-nope', bodyAttr: 'data-dsh-nope' }
    await assert.rejects(() => engine.activateSkin(bad), /unknown-skin/)
    assert.equal(engine.currentSkinState().active, false)
    assert.equal(win.document.body.hasAttribute('data-dsh-nope'), false)
  })

  test('皮肤自带 disposer 在引擎驱动下真实可逆（ths chrome 卸载后清除）', async () => {
    const engine = await makeEngine(['ths'])
    const entry = engine.getSkins()[0]
    await engine.activateSkin(entry)
    const chromeBefore = Array.from(win.document.body.children).filter((el) => el.hasAttribute('data-skin-chrome'))
    assert.ok(chromeBefore.length > 0, 'ths 应注入 chrome 元素')
    engine.deactivateSkin()
    const chromeAfter = Array.from(win.document.body.children).filter((el) => el.hasAttribute('data-skin-chrome'))
    assert.equal(chromeAfter.length, 0, 'chrome 已清除')
    assert.equal(win.document.body.getAttribute('data-dsh-ths'), null)
  })
})

describe('miniCtx（假皮肤隔离测试）', () => {
  test('effect 立即执行并收集返回 disposer，__disposeAll 逆序调用', async () => {
    const pkg = '@test/counter'
    const log = []
    // 构造一个真实形态的假 bundle：factory 注册 apply，apply 消费 ctx.effect。
    const bundleSrc = `window.__ModuleLoader__.load({
      id: ${JSON.stringify(pkg)},
      factory: () => ({
        apply(ctx) {
          window.__ctLog().push('apply-start')
          ctx.effect(() => () => { window.__ctLog().push('dispose:first') }, 'first')
          ctx.effect(() => () => { window.__ctLog().push('dispose:second') }, 'second')
          window.__ctLog().push('apply-end')
          document.body.dataset.dshCounter = ''
          ctx.effect(() => () => { window.__ctLog().push('dispose:attr'); delete document.body.dataset.dshCounter }, 'attr')
        }
      })
    })`
    win.__ctLog = () => log
    const engine = createSkinEngine({
      modules: win.__DSH_MODULES__,
      manifest: [{ id: 'counter', package: pkg, bodyAttr: 'data-dsh-counter', order: 1 }],
      bundles: { counter: bundleSrc },
      executeScript: (code) => executeOnWindow(win, code),
    })
    await engine.activateSkin({ id: 'counter', package: pkg, bodyAttr: 'data-dsh-counter', order: 1 })
    assert.deepEqual(log.slice(0, 2), ['apply-start', 'apply-end'], 'effect 注册不立即执行 disposer')
    assert.equal(win.document.body.hasAttribute('data-dsh-counter'), true)
    engine.deactivateSkin()
    assert.deepEqual(log.slice(2), ['dispose:attr', 'dispose:second', 'dispose:first'], 'disposer 逆序执行且先清 attr')
    assert.equal(win.document.body.hasAttribute('data-dsh-counter'), false)
    delete win.__ctLog
  })
})
