/**
 * custom-theme.test.mjs — 自定义主题白盒单测（node:test）。
 * 覆盖 INTERFACE §2 / §8：导入校验各错误 code、状态机（preview/apply/delete/restore）、
 * 轨道互斥写键、内置不可删。用内存 storage 替身，纯逻辑无 DOM。
 */
import { describe, it, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { createCustomThemeApi, ERR, DEFAULT_THEME_ID } from '../../src/custom-theme.js'
import { memoryStorage, BUILTIN_THEME_IDS } from '../../src/acceptance-api.mjs'

function makeApi(initial = {}) {
  return createCustomThemeApi({
    storage: memoryStorage(initial),
    builtinThemes: BUILTIN_THEME_IDS.map((id) => ({ id, label: id })),
  })
}

const validJSON = (id = 'my-theme', label = '我的主题') => JSON.stringify({
  id, label, tokens: { '--dsw-bg': { light: '#ffffff', dark: '#000000' } },
})
const codeOf = (e) => (e && typeof e === 'object' && e.code) || 'NO_CODE'

describe('custom-theme 导入校验（INTERFACE §5 / §8.3）', () => {
  afterEach(() => { /* 每次新 api */ })

  it('合法 JSON 并入 registry', async () => {
    const api = makeApi()
    const item = await api.importCustomTheme(validJSON())
    assert.equal(item.id, 'my-theme')
    assert.equal(item.label, '我的主题')
    assert.ok(api.getCustomThemes().some((t) => t.id === 'my-theme'))
  })

  it('非法 JSON → ERR_IMPORT_INVALID_JSON', async () => {
    const api = makeApi()
    await assert.rejects(api.importCustomTheme('{oops'), (e) => codeOf(e) === ERR.INVALID_JSON)
    await assert.rejects(api.importCustomTheme(''), (e) => codeOf(e) === ERR.INVALID_JSON)
  })

  it('缺字段 → ERR_THEME_MISSING_FIELD', async () => {
    const api = makeApi()
    const cases = [{ label: 'x', tokens: {} }, { id: 'a', tokens: {} }, { id: 'a', label: 'x' }]
    for (const c of cases) {
      await assert.rejects(api.importCustomTheme(JSON.stringify(c)), (e) => codeOf(e) === ERR.MISSING_FIELD)
    }
  })

  it('坏 token → ERR_THEME_BAD_TOKEN', async () => {
    const api = makeApi()
    const bad = [
      { id: 'a', label: 'x', tokens: { 'bg': { light: '#fff', dark: '#000' } } },
      { id: 'a', label: 'x', tokens: { '--dsw-bg': { dark: '#000' } } },
      { id: 'a', label: 'x', tokens: { '--dsw-bg': { light: 1, dark: '#000' } } },
      { id: 'a', label: 'x', tokens: { '--dsw-bg': null } },
    ]
    for (const c of bad) {
      await assert.rejects(api.importCustomTheme(JSON.stringify(c)), (e) => codeOf(e) === ERR.BAD_TOKEN)
    }
  })

  it('与内置 id 冲突 → ERR_THEME_ID_CONFLICT', async () => {
    const api = makeApi()
    await assert.rejects(api.importCustomTheme(validJSON('jade')), (e) => codeOf(e) === ERR.ID_CONFLICT)
  })

  it('失败不改外观/注册表', async () => {
    const api = makeApi()
    const before = api.getCustomAppliedId()
    await assert.rejects(api.importCustomTheme('nope'))
    assert.equal(api.getCustomAppliedId(), before)
    assert.equal(api.getCustomThemes().length, 0)
  })
})

describe('自定义主题状态机（INTERFACE §8.1）', () => {
  it('none→import→preview→applied→delete→restore', async () => {
    const api = makeApi()
    await api.importCustomTheme(validJSON())
    api.previewCustomTheme('my-theme')
    assert.equal(api.getCustomAppliedId(), null, 'preview 不写 applied')
    api.applyCustomTheme('my-theme')
    assert.equal(api.getCustomAppliedId(), 'my-theme')
    api.deleteCustomTheme('my-theme')
    assert.equal(api.getCustomAppliedId(), DEFAULT_THEME_ID, '删除 applied 项回内置 jade')
    assert.ok(!api.getCustomThemes().some((t) => t.id === 'my-theme'))
  })

  it('restore_default 清自定义、内置仍 15', async () => {
    const api = makeApi()
    await api.importCustomTheme(validJSON())
    api.restoreDefaultTheme()
    assert.equal(api.getCustomThemes().length, 0)
    assert.equal(api.getThemes().length, BUILTIN_THEME_IDS.length)
  })

  it('未知 id 试穿/应用 → ERR_UNKNOWN_ID', () => {
    const api = makeApi()
    assert.throws(() => api.previewCustomTheme('nope'), (e) => codeOf(e) === ERR.UNKNOWN_ID)
    assert.throws(() => api.applyCustomTheme('nope'), (e) => codeOf(e) === ERR.UNKNOWN_ID)
  })

  it('内置不可删', async () => {
    const api = makeApi()
    const before = api.getThemes().map((t) => t.id)
    api.deleteCustomTheme('jade')
    assert.deepEqual(api.getThemes().map((t) => t.id), before)
  })
})
