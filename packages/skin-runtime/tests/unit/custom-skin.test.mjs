/**
 * custom-skin.test.mjs — 自定义皮肤受控导入校验白盒单测（node:test）。
 * 覆盖 INTERFACE §3 / §5 / §8.3：缺文件、缺元数据、契约、高危能力、体积、数量、id 冲突、a11y 降级。
 * 用内存 storage 替身 + 内置 9 皮肤 manifest，纯逻辑无 DOM。
 */
import { describe, it, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { createCustomSkinApi, ERR, MAX_CUSTOM_COUNT } from '../../src/custom-skin.js'
import { validateCustomBundle } from '../../src/skin-engine.js'
import { memoryStorage, BUILTIN_SKINS } from '../../src/acceptance-api.mjs'

function makeApi(initial = {}) {
  return createCustomSkinApi({ storage: memoryStorage(initial), builtinSkins: BUILTIN_SKINS, validate: validateCustomBundle })
}

const OK_CLIENT = `window.__ModuleLoader__.load({
  id: '{{id}}',
  factory: function() { return { apply: function(ctx) { ctx.effect(function() {}); } }; }
})`
const BAD_CONTRACT_CLIENT = `window.__ModuleLoader__.load({ id: 'x', factory: function() { return { apply: function(ctx) { ctx.hiddenApi(); } }; } })`
const validSkin = (id = 'my-skin') => JSON.stringify({ id, name: 'Mine', author: '柚子', license: 'BSD-3-Clause', source: 'custom' })
const codeOf = (e) => (e && typeof e === 'object' && e.code) || 'NO_CODE'

describe('custom-skin 缺文件/元数据（INTERFACE §5 / §8.3）', () => {
  afterEach(() => { /* 每次新 api */ })
  it('C7 缺 skin.json 或 client.js → ERR_SKIN_MISSING_FILE', async () => {
    const api = makeApi()
    await assert.rejects(api.importCustomSkin({ skin: validSkin(), client: '' }), (e) => codeOf(e) === ERR.MISSING_FILE)
    await assert.rejects(api.importCustomSkin({}), (e) => codeOf(e) === ERR.MISSING_FILE)
  })

  it('C8 缺 id/name/author/license → ERR_SKIN_BAD_META', async () => {
    const api = makeApi()
    for (const key of ['id', 'name', 'author', 'license']) {
      const meta = JSON.parse(validSkin()); delete meta[key]
      await assert.rejects(api.importCustomSkin({ skin: JSON.stringify(meta), client: OK_CLIENT }), (e) => codeOf(e) === ERR.BAD_META)
    }
  })

  it('导入失败不改 registry', async () => {
    const api = makeApi()
    const before = api.getSkins().length
    await assert.rejects(api.importCustomSkin({ skin: 'nope', client: OK_CLIENT }), (e) => codeOf(e) === ERR.INVALID_JSON)
    assert.equal(api.getSkins().length, before)
  })
})

describe('custom-skin 契约 & 高危能力（INTERFACE §3.3 / §3.4 / §8.3）', () => {
  it('C9 坏契约 → ERR_SKIN_CONTRACT', async () => {
    const api = makeApi()
    await assert.rejects(api.importCustomSkin({ skin: validSkin(), client: 'const x = 1' }), (e) => codeOf(e) === ERR.CONTRACT)
    await assert.rejects(api.importCustomSkin({ skin: validSkin(), client: BAD_CONTRACT_CLIENT }), (e) => codeOf(e) === ERR.CONTRACT)
  })

  it('C10 高危能力 → ERR_SKIN_DANGEROUS', async () => {
    const api = makeApi()
    const dangers = ['eval(1)', 'new Function()', 'import("x")', 'require("fs")', '<script src=', 'fetch("/api")', 'XMLHttpRequest()', 'WebSocket("w:")', 'localStorage.setItem', 'sessionStorage.getItem', 'document.cookie', 'chrome.runtime']
    for (const d of dangers) {
      const client = `window.__ModuleLoader__.load({id:'d',factory:function(){${d}}})`
      await assert.rejects(api.importCustomSkin({ skin: validSkin(), client }), (e) => codeOf(e) === ERR.DANGEROUS, d)
    }
  })

  it('C11 超 256KB → ERR_SKIN_SIZE', async () => {
    const api = makeApi()
    const big = OK_CLIENT + '//' + 'x'.repeat(300 * 1024)
    await assert.rejects(api.importCustomSkin({ skin: validSkin(), client: big }), (e) => codeOf(e) === ERR.SIZE)
  })

  it('C12 超 8 个 → ERR_SKIN_COUNT', async () => {
    const api = makeApi()
    for (let i = 0; i < MAX_CUSTOM_COUNT; i++) {
      await api.importCustomSkin({ skin: validSkin(`skin-${i}`), client: OK_CLIENT })
    }
    await assert.rejects(api.importCustomSkin({ skin: validSkin('skin-over'), client: OK_CLIENT }), (e) => codeOf(e) === ERR.COUNT)
  })

  it('C13 与内置 id 冲突 → 拒绝且 registry 不变', async () => {
    const api = makeApi()
    const before = api.getSkins().length
    await assert.rejects(api.importCustomSkin({ skin: validSkin('qq98'), client: OK_CLIENT }), (e) => codeOf(e) === ERR.ID_CONFLICT)
    assert.equal(api.getSkins().length, before)
  })
})

describe('custom-skin 生命周期（INTERFACE §8.1）', () => {
  it('A2 全链并回默认，内置 9 不动', async () => {
    const api = makeApi()
    const builtinIds = api.getSkins().filter((s) => s.source !== 'custom').map((s) => s.id)
    await api.importCustomSkin({ skin: validSkin(), client: OK_CLIENT })
    api.previewCustomSkin('my-skin')
    api.applyCustomSkin('my-skin')
    api.deleteCustomSkin('my-skin')
    const after = api.currentSkinState()
    assert.equal(after.active, false)
    assert.equal(after.skinId, '')
    assert.deepEqual(api.getSkins().filter((s) => s.source !== 'custom').map((s) => s.id), builtinIds)
    api.restoreDefaultSkin()
    assert.equal(api.getSkins().filter((s) => s.source === 'custom').length, 0)
    assert.equal(api.getSkins().filter((s) => s.source !== 'custom').length, 9)
  })

  it('C14 a11y 缺失降级（不拒绝）；提供则保留', async () => {
    const api = makeApi()
    const item = await api.importCustomSkin({ skin: validSkin(), client: OK_CLIENT })
    assert.equal(item.id, 'my-skin')
    const ok = await api.importCustomSkin({ skin: validSkin(), client: OK_CLIENT, a11y: 'body{--x:1}' })
    assert.equal(ok.a11yText, 'body{--x:1}')
  })

  it('内置不可删', async () => {
    const api = makeApi()
    const before = api.getSkins().filter((s) => s.source !== 'custom').length
    api.deleteCustomSkin('qq98')
    assert.equal(api.getSkins().filter((s) => s.source !== 'custom').length, before)
  })

  it('B1 应用自定义皮肤 → track=skin', async () => {
    const api = makeApi()
    await api.importCustomSkin({ skin: validSkin(), client: OK_CLIENT })
    api.applyCustomSkin('my-skin')
    assert.equal(api.getAppearanceTrack(), 'skin')
  })
})
