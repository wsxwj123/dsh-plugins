/**
 * track-mutex.test.mjs — 主题↔皮肤轨道互斥（INTERFACE §1.2 / §3.6 / §8.2）。
 * 两包各自写 dsh-appearance-track-v1：主题活化写 'theme'，皮肤写 'skin'。
 * 这里是 theme 侧视图：验证主题 apply/restore 正确写键，且读回一致。
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createCustomThemeApi, TRACK_KEY } from '../../src/custom-theme.js'
import { memoryStorage, BUILTIN_THEME_IDS } from '../../src/acceptance-api.mjs'

function makeApi(initial = {}) {
  return createCustomThemeApi({
    storage: memoryStorage(initial),
    builtinThemes: BUILTIN_THEME_IDS.map((id) => ({ id, label: id })),
  })
}

const validJSON = '{"id":"my-theme","label":"T","tokens":{"--dsw-bg":{"light":"#fff","dark":"#000"}}}'

describe('theme 轨道互斥写键', () => {
  it('apply 自定义主题 → track=theme', async () => {
    const storage = memoryStorage()
    const api = createCustomThemeApi({ storage, builtinThemes: BUILTIN_THEME_IDS.map((id) => ({ id, label: id })) })
    await api.importCustomTheme(validJSON)
    api.applyCustomTheme('my-theme')
    assert.equal(storage.getItem(TRACK_KEY), 'theme')
  })

  it('对侧 track=skin 占位时，本轨 apply 仍写 theme（软互斥事件序：最后写者生效）', async () => {
    const storage = memoryStorage({ [TRACK_KEY]: 'skin' })
    const api = createCustomThemeApi({ storage, builtinThemes: BUILTIN_THEME_IDS.map((id) => ({ id, label: id })) })
    await api.importCustomTheme(validJSON)
    api.applyCustomTheme('my-theme')
    // 软互斥：本轨活化由事件序最后写者裁决，本轨 apply 写成 theme。
    assert.equal(storage.getItem(TRACK_KEY), 'theme')
  })

  it('restore_default → track=theme', async () => {
    const storage = memoryStorage()
    const api = createCustomThemeApi({ storage, builtinThemes: BUILTIN_THEME_IDS.map((id) => ({ id, label: id })) })
    api.restoreDefaultTheme()
    assert.equal(storage.getItem(TRACK_KEY), 'theme')
  })

  it('getAppearanceTrack 读回', async () => {
    const api = makeApi()
    assert.equal(api.getAppearanceTrack(), '')
    await api.importCustomTheme(validJSON)
    api.applyCustomTheme('my-theme')
    assert.equal(api.getAppearanceTrack(), 'theme')
  })
})
