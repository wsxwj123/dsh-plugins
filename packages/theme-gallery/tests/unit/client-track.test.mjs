/**
 * client-track.test.mjs — 插件级轨道协调测试（INTERFACE §1.2/§1.3/§2.3/§2.6）。
 *
 * 覆盖（评审 F1/F2/F5）：
 *  - F1 localStorage 恢复 / track 判断：apply 后从 theme-gallery-track-v1 恢复轨道，
 *    写 skin+family 各自恢复；冲突时主题优先（§1.3）。
 *  - F2 主题↔皮肤互斥：激活皮肤后 activateFamily 必须清退皮肤并让主题 override 生效；
 *    再切回皮肤时主题 override 必须消失（§2.3）。
 *  - F5 插件 start/stop 副作用归零：ctx 停用钩子（teardown）后 body 无 data-dsh-*、
 *    无 skin/a11y style、主题 override 清空（§2.6）。
 *
 * 通过 client-harness 加载真实 client.js（含真实皮肤 bundle），驱动真实协调逻辑。
 */
import { test, describe, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { loadClient, createStorage } from './client-harness.mjs'

const FLUSH = () => new Promise((r) => setTimeout(r, 0))

/** 等皮肤恢复/激活的异步副作用（多次微任务 + 短宏任务）。 */
async function settle(n = 8) {
  for (let i = 0; i < n; i++) await FLUSH()
}

const active = []

afterEach(() => {
  while (active.length) active.pop().cleanup?.()
})

async function boot(opts = {}) {
  const h = await loadClient(opts)
  active.push(h)
  await settle()
  return h
}

describe('F1 — localStorage 恢复 / track 判断', () => {
  test('track=skin + skin-v1=qq98 → apply 后恢复激活 qq98，track=skin，主题 override 清空', async () => {
    const storage = createStorage({
      'theme-gallery-track-v1': 'skin',
      'theme-gallery-skin-v1': 'qq98',
    })
    const h = await boot({ storageOverride: storage })
    assert.equal(h.api.getTrack(), 'skin')
    const st = h.api.currentSkinState()
    assert.equal(st.active, true)
    assert.equal(st.skinId, 'qq98')
    assert.equal(h.document.body.hasAttribute('data-dsh-retro'), true, 'qq98 body 属性应恢复')
    assert.equal(h.theme.overrides.length, 0, '皮肤轨道激活时不应有主题 override')
  })

  test('track=theme + family-v5 → apply 后恢复主题轨道，皮肤 inactive', async () => {
    const storage = createStorage({
      'theme-gallery-track-v1': 'theme',
      'theme-gallery-family-v5': 'terracotta',
    })
    const h = await boot({ storageOverride: storage })
    assert.equal(h.api.getTrack(), 'theme')
    assert.equal(h.api.currentSkinState().active, false)
    assert.equal(h.theme.overrides.length, 1, '主题 override 应生效')
    // 恢复的是 terracotta（family-v5）
    assert.equal(h.theme.overrides[0].scope, 'dsh-theme-gallery')
  })

  test('track 缺失 → 回退主题轨道，皮肤 inactive（向后兼容）', async () => {
    const h = await boot({ storageOverride: createStorage({}) })
    assert.equal(h.api.getTrack(), 'theme')
    assert.equal(h.api.currentSkinState().active, false)
    assert.equal(h.theme.overrides.length, 1)
  })

  test('track=skin 但 skin-v1 非法 → 回退主题且写回 track=theme', async () => {
    const storage = createStorage({ 'theme-gallery-track-v1': 'skin', 'theme-gallery-skin-v1': 'nope' })
    const h = await boot({ storageOverride: storage })
    assert.equal(h.api.getTrack(), 'theme')
    assert.equal(h.storage.getItem('theme-gallery-track-v1'), 'theme', '非法 skin 应清 track 回主题')
    assert.equal(h.api.currentSkinState().active, false)
  })
})

describe('F2 — 主题↔皮肤轨道互斥（activateFamily 清退皮肤）', () => {
  test('激活皮肤后 activateFamily → 皮肤副作用全清、主题 override 生效、track=theme', async () => {
    const h = await boot()
    await h.api.activateSkin('qq98')
    assert.equal(h.api.currentSkinState().active, true)
    assert.equal(h.document.body.hasAttribute('data-dsh-retro'), true)
    assert.equal(h.theme.overrides.length, 0)

    h.api.activateFamily('terracotta')
    await settle()
    // 皮肤清退：body 无 data-dsh-retro
    assert.equal(h.document.body.hasAttribute('data-dsh-retro'), false, '激活主题应清退皮肤 body 属性')
    assert.equal(h.api.currentSkinState().active, false)
    // 主题生效
    assert.equal(h.api.getTrack(), 'theme')
    assert.equal(h.theme.overrides.length, 1, '主题 override 应生效')
  })

  test('回切皮肤 → 主题 override 消失、新皮肤生效（track=skin）', async () => {
    const h = await boot()
    await h.api.activateSkin('qq98')
    h.api.activateFamily('terracotta')
    await settle()
    assert.equal(h.theme.overrides.length, 1)

    await h.api.activateSkin('ths')
    assert.equal(h.theme.overrides.length, 0, '激活皮肤应清空主题 override')
    assert.equal(h.api.getTrack(), 'skin')
    assert.equal(h.document.body.hasAttribute('data-dsh-ths'), true, 'ths body 属性应生效')
    assert.equal(h.document.body.hasAttribute('data-dsh-retro'), false, '旧皮肤已清退')
  })

  test('主题轨道内部切换不破坏互斥状态', async () => {
    const h = await boot()
    h.api.activateFamily('jade')
    h.api.activateFamily('starlight')
    await settle()
    assert.equal(h.api.getTrack(), 'theme')
    assert.equal(h.api.currentSkinState().active, false)
    assert.equal(h.theme.overrides.length, 1)
  })
})

describe('F5 — 插件 start/stop 副作用归零', () => {
  test('stop（ctx 停用钩子）后：body 无 data-dsh-*、无 skin/a11y style、主题 override 清空', async () => {
    const h = await boot()
    await h.api.activateSkin('qq98')
    // 注入 a11y style（模拟 afterApply 之后的状态——activeSkin 已注入）
    assert.equal(h.document.body.hasAttribute('data-dsh-retro'), true)
    // 触发插件停用：执行 apply 里 ctx.effect(() => () => teardown())
    h.ctx._disposeAll()
    await settle()
    // body 无皮肤属性
    for (const el of Array.from(h.document.body.children)) {
      assert.equal(el.hasAttribute('data-dsh-retro'), false, 'chrome/属性已清')
    }
    assert.equal(h.document.body.hasAttribute('data-dsh-retro'), false)
    // 无皮肤/a11y style
    const leakStyles = h.document.querySelectorAll('style[data-theme-gallery-skin], style[data-theme-gallery-a11y]')
    assert.equal(leakStyles.length, 0, '无皮肤/a11y style 残留')
    // 主题 override 清空（无论之前是主题还是皮肤）
    assert.equal(h.theme.overrides.length, 0)
  })

  test('stop 后可重新启动，从 localStorage 恢复已选皮肤轨道（生命周期可往返、无残留态）', async () => {
    const h = await boot()
    await h.api.activateSkin('miku')
    assert.equal(h.api.getTrack(), 'skin')
    h.ctx._disposeAll()
    await settle()
    // stop 后：localStorage 保留皮肤选择（try-on 语义），副作用归零。
    assert.equal(h.api.currentSkinState().active, false, 'stop 后皮肤副作用归零')
    // 重新 apply（模拟 refresh/restart）：从 localStorage 恢复已选皮肤轨道。
    await h.apply(h.ctx)
    await settle()
    assert.equal(h.api.getTrack(), 'skin', 'restart 恢复持久化的皮肤轨道')
    assert.equal(h.api.currentSkinState().active, true)
    assert.equal(h.document.body.hasAttribute('data-dsh-miku'), true, 'miku body 属性应恢复')
    assert.equal(h.theme.overrides.length, 0)
  })
})
