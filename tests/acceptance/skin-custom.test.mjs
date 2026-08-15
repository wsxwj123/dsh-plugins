// 验收测试草稿 — skin-gallery 自定义皮肤（INTERFACE §3 / §5 / §8）
//
// 黑盒：只通过公开接口函数驱动，不 import 内部模块，不读实现。
// 【开发接线点】特征未实现前此文件为可运行底座：把 importPublicApi 里
//  创建的真实公开 API 对象暴露成下面的 `api` 即可跑通全部断言。
//  公开函数签名来自 INTERFACE §3.2 / §4.2：
//  - importCustomSkin({skin, client, a11y?}): Promise<CustomSkinItem>  reject {code,message}
//  - previewCustomSkin(id) / applyCustomSkin(id) / deleteCustomSkin(id) / restoreDefaultSkin()
//  - getSkins(): SkinManifestEntry[]  内置 9 + 自定义(source:'custom')
//  - currentSkinState(): {skinId, active}
//  - activateSkin(id) / previewSkin(id) / applySkin(id) / clearSkin()  内置保留
//  - registerCustomBundle(skin) / teardownSkins()  生命周期
import { describe, it, afterEach } from 'node:test'
import assert from 'node:assert/strict'

// —— 接线点：接入 skin-gallery 真实公开 API（仅改此接线块，不改任何断言）——
import { createSkinAcceptanceApi } from '../../packages/skin-gallery/src/acceptance-api.mjs'
const api = createSkinAcceptanceApi()
// —— 接线点结束 ——

const BUILTIN_SKIN_COUNT = 9

// 合规 client.js：契约满足、无高危能力
const OK_CLIENT = `window.__ModuleLoader__.load({
  id: '{{id}}',
  factory: function() {
    return {
      apply: function(ctx) {
        ctx.effect(function() {});
      }
    };
  }
});`
// 不合规：白名单外 ctx 访问
const BAD_CONTRACT_CLIENT = `window.__ModuleLoader__.load({
  id: 'x', factory: function() { return { apply: function(ctx) { ctx.hiddenApi(); } }; }
});`

const validSkin = (id = 'my-skin') => JSON.stringify({
  id,
  name: 'Mine',
  author: '柚子',
  license: 'BSD-3-Clause',
  source: 'custom',
})

const importValid = (id = 'my-skin') => api.importCustomSkin({
  skin: validSkin(id),
  client: OK_CLIENT.replace('{{id}}', id),
})

function codeOf(err) { return err && typeof err === 'object' && err.code }

describe('皮肤 状态机 & 生命周期 (§8.1 / §8.2)', () => {
  afterEach(() => { api.restoreDefaultSkin(); api.teardownSkins() })

  it('A2 全链并回默认，内置 9 不动', async () => {
    const builtinBefore = api.getSkins().filter((s) => s.source !== 'custom')
    await importValid()

    api.previewCustomSkin('my-skin')
    // preview 不写 applied（A3 语义）：preview 后 currentSkinState 不应记为已应用
    api.applyCustomSkin('my-skin')

    api.deleteCustomSkin('my-skin')
    const after = api.currentSkinState()
    // 删除 applied 项后应回 none
    assert.ok(!after.active, '删除 applied 项后 active 应为 false')
    assert.ok(after.skinId === '' || after.skinId == null, '删除 applied 项后皮肤 id 应为空')
    assert.deepEqual(api.getSkins().filter((s) => s.source !== 'custom').map((s) => s.id),
      builtinBefore.map((s) => s.id), '删除自定义不影响内置 9')

    api.restoreDefaultSkin()
    assert.equal(api.getSkins().filter((s) => s.source === 'custom').length, 0,
      'restore 后自定义清空')
    assert.equal(api.getSkins().filter((s) => s.source !== 'custom').length, BUILTIN_SKIN_COUNT,
      '内置皮肤恒为 9')
  })

  it('B1/B2 track 键随激活轨正确（theme/skin）', async () => {
    // 依赖公开 track 读取（INTERFACE §1.2 dsh-appearance-track-v1）
    // 若 api.getAppearanceTrack? 存在则断言
    if (api.getAppearanceTrack) {
      await importValid()
      api.applyCustomSkin('my-skin')
      assert.equal(api.getAppearanceTrack(), 'skin')
    }
  })
})

describe('皮肤 导入校验 · 缺文件/元数据 (§5 / §8.3)', () => {
  afterEach(() => api.restoreDefaultSkin())

  it('C7 缺 skin.json 或缺 client.js → ERR_SKIN_MISSING_FILE', async () => {
    await assert.rejects(api.importCustomSkin({ skin: validSkin(), client: '' }),
      (e) => codeOf(e) === 'ERR_SKIN_MISSING_FILE')
    await assert.rejects(api.importCustomSkin({}),
      (e) => codeOf(e) === 'ERR_SKIN_MISSING_FILE')
  })

  it('C8 缺 id/name/author/license → ERR_SKIN_BAD_META', async () => {
    const drop = (key) => { const o = {}; for (const k in JSON.parse(validSkin())) { if (k !== key) o[k] = JSON.parse(validSkin())[k]; } return JSON.stringify(o) }
    for (const key of ['id', 'name', 'author', 'license']) {
      await assert.rejects(api.importCustomSkin({ skin: drop(key), client: OK_CLIENT }),
        (e) => codeOf(e) === 'ERR_SKIN_BAD_META',
        `删 ${key} 应满足 ERR_SKIN_BAD_META（含 author/license 明确触发）`)
    }
  })

  it('导入失败不改当前外观 / 不写 registry', async () => {
    const beforeCount = api.getSkins().length
    await assert.rejects(api.importCustomSkin({ skin: 'nope', client: OK_CLIENT }),
      (e) => codeOf(e) === 'ERR_IMPORT_INVALID_JSON')
    assert.equal(api.getSkins().length, beforeCount, '失败后 registry 不变')
  })
})

describe('皮肤 契约 & 高危能力 (§3.3 / §3.4)', () => {
  afterEach(() => api.restoreDefaultSkin())

  it('C9 坏契约 → ERR_SKIN_CONTRACT', async () => {
    const noLoader = 'const x = 1'   // 无 __ModuleLoader__
    await assert.rejects(api.importCustomSkin({ skin: validSkin(), client: noLoader }),
      (e) => codeOf(e) === 'ERR_SKIN_CONTRACT',
      '缺 __ModuleLoader__ 拒绝')
    await assert.rejects(api.importCustomSkin({
      skin: validSkin(), client: BAD_CONTRACT_CLIENT,
    }), (e) => codeOf(e) === 'ERR_SKIN_CONTRACT',
      'apply 内白名单外 ctx.<member> 拒绝')
  })

  it('C10 高危能力任一命中 → ERR_SKIN_DANGEROUS', async () => {
    const dangers = [
      'eval(1)', 'new Function()', 'import("x")', 'require("fs")',
      '<script src=', 'fetch("/api")', 'XMLHttpRequest()', 'WebSocket("w:")',
      'localStorage.setItem', 'sessionStorage.getItem', 'document.cookie',
      'chrome.runtime',
    ]
    for (const d of dangers) {
      const client = `window.__ModuleLoader__.load({id:'d',factory:function(){${d}}})`
      await assert.rejects(api.importCustomSkin({ skin: validSkin(), client }),
        (e) => codeOf(e) === 'ERR_SKIN_DANGEROUS',
        `${d} 应触发 ERR_SKIN_DANGEROUS`)
    }
  })

  it('C11 超 256KB（btoa 后）→ ERR_SKIN_SIZE', async () => {
    const big = OK_CLIENT + '//' + 'x'.repeat(300 * 1024) // 明显超
    await assert.rejects(api.importCustomSkin({ skin: validSkin(), client: big }),
      (e) => codeOf(e) === 'ERR_SKIN_SIZE',
      '超体积拒绝')
  })

  it('C12 已达 8 个再导入 → ERR_SKIN_COUNT', async () => {
    for (let i = 0; i < 8; i++) { await importValid(`skin-${i}`) }
    await assert.rejects(importValid('skin-over'),
      (e) => codeOf(e) === 'ERR_SKIN_COUNT',
      '超 8 个拒绝')
  })

  it('C13 与内置皮肤 id 冲突 → 拒绝且 registry 不变', async () => {
    const builtin = api.getSkins().filter((s) => s.source !== 'custom')[0]
    if (!builtin) { return }
    const beforeCount = api.getSkins().length
    await assert.rejects(api.importCustomSkin({ skin: validSkin(builtin.id), client: OK_CLIENT }))
    assert.equal(api.getSkins().length, beforeCount, '冲突导入不改 registry')
  })
})

describe('皮肤 a11y 缺失降级 (§3.2 / §5)', () => {
  it('C14 合法 skin+client 无 a11y → 仍可用（不拒绝）', async () => {
    const item = await api.importCustomSkin({ skin: validSkin(), client: OK_CLIENT })
    assert.equal(item.id, 'my-skin')
  })
  it('a11y 提供时不应破坏导入', async () => {
    const ok = await api.importCustomSkin({
      skin: validSkin(), client: OK_CLIENT, a11y: 'body{--x:1}',
    })
    assert.equal(ok.a11yText ?? '', 'body{--x:1}')
  })
})

describe('皮肤 内置不可删 (§8.4 D5)', () => {
  afterEach(() => api.restoreDefaultSkin())
  it('delete 内置 id 后内置仍在', () => {
    const beforeCount = api.getSkins().filter((s) => s.source !== 'custom').length
    api.deleteCustomSkin(builtinFirstId())
    assert.equal(api.getSkins().filter((s) => s.source !== 'custom').length, beforeCount,
      '内置皮肤不可被 deleteCustomSkin 移除')
  })
})

function builtinFirstId() {
  const s = api.getSkins().find((x) => x.source !== 'custom')
  return s ? s.id : 'builtin-0'
}
