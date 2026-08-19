/**
 * track-switch.test.mjs — 跨轨切换的 DOM 清理回归（P0：应用皮肤后点「恢复默认主题」整页塌陷）。
 *
 * 事故原文：主题↔皮肤的「软互斥」只写 dsh-appearance-track-v1 标记、不做动作 —— 切到主题轨后
 * 皮肤运行时（body[data-dsh-*] / chrome / 注入 style）原样还在，主题又把 token override 重画到
 * head 末尾盖过皮肤 CSS，两套外观同时生效 → 变量失效、布局塌陷。
 *
 * 既有 25 条软互斥验收断言全绿仍漏掉本 bug：它们只验「track 键写对了」，没验真实 DOM 被清干净。
 * 本文件只断言 DOM/运行时痕迹，与 track 键值无关。
 *
 * 复用验收侧的 apply 层接线（真实 client.js + 替身 DOM/storage/React/模块系统），
 * 不另起一套底座：这里要测的正是 apply 层的跨轨闸。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createSubject } from '../../../../tests/acceptance/appearance-gallery/helpers/subject.mjs'
import { KEYS } from '../../../../tests/acceptance/appearance-gallery/helpers/contract.mjs'
import { themeRegistry } from '../../../../tests/acceptance/appearance-gallery/helpers/fixtures.mjs'

const FULL = { services: { theme: {}, slots: {} } }
const tick = () => new Promise((r) => setImmediate(r))

/** 起一个「皮肤已生效」的现场（走真实启动恢复，不是手工摆 DOM）。 */
async function withSkin(seed = {}) {
  const h = await createSubject({ seed: { [KEYS.SKIN_BUILTIN]: 'xp', [KEYS.TRACK]: 'skin', ...seed } })
  h.start(FULL)
  await tick()
  assert.equal(h.dom.activeSkin, 'xp', '前置：皮肤应已激活')
  assert.equal(skinTrace(h).bodyAttrs.length, 1, '前置：body 上应有皮肤属性')
  return h
}

/** 皮肤在 DOM 上的全部痕迹：body 的 data-dsh-* 属性 + 皮肤/a11y style + 皮肤写的内联变量。 */
function skinTrace(h) {
  return {
    bodyAttrs: Object.keys(h.dom.body.attrs).filter((n) => n.startsWith('data-dsh-')),
    styles: h.dom.styleCount('data-skin') + h.dom.styleCount('data-skin-a11y'),
    inline: Object.keys(h.dom.body.inline),
    active: h.dom.activeSkin,
  }
}

function assertSkinGone(h, where) {
  const trace = skinTrace(h)
  assert.deepEqual(trace.bodyAttrs, [], `${where}: body 上残留皮肤属性`)
  assert.equal(trace.styles, 0, `${where}: 皮肤/a11y style 未移除`)
  assert.deepEqual(trace.inline, [], `${where}: 皮肤写的内联变量未清`)
  assert.equal(trace.active, null, `${where}: 引擎仍认为皮肤在生效`)
}

// ---------------- 皮肤 → 主题：前一条轨的 DOM 痕迹必须清零 ----------------
test('切轨_恢复默认主题必须卸掉正在生效的皮肤', async () => {
  const h = await withSkin()
  h.themeApi.restoreDefaultTheme()
  assertSkinGone(h, '恢复默认主题')
})

test('切轨_应用内置主题必须卸掉正在生效的皮肤', async () => {
  const h = await withSkin()
  h.themeApi.activateFamily('azure')
  assertSkinGone(h, '应用内置主题')
})

test('切轨_应用自定义主题必须卸掉正在生效的皮肤', async () => {
  const h = await withSkin({ [KEYS.THEME_CUSTOM]: themeRegistry(['m']) })
  h.themeApi.applyCustomTheme('m')
  assertSkinGone(h, '应用自定义主题')
})

test('切轨_试穿主题时同样卸掉皮肤_且撤销试穿后皮肤回来', async () => {
  const h = await withSkin({ [KEYS.THEME_CUSTOM]: themeRegistry(['m']) })
  h.storage.resetStats()
  h.themeApi.previewCustomTheme('m')
  assertSkinGone(h, '试穿主题')
  assert.equal(h.storage.stats.set + h.storage.stats.remove, 0, '试穿不许写 storage')
  h.revertPreview()
  await tick()
  assert.equal(h.dom.activeSkin, 'xp', '撤销试穿后应按 storage 复原皮肤')
})

test('切轨_切到主题轨后刷新不许把皮肤拉回来', async () => {
  const h = await withSkin()
  h.themeApi.restoreDefaultTheme()
  // 用同一份 storage 重开一次插件 = 刷新页面
  const again = await createSubject({ storage: h.storage })
  again.start(FULL)
  await tick()
  assert.equal(again.dom.activeSkin, null, '皮肤的 applied 键没清 → 启动恢复又把皮肤拉回来')
  assertSkinGone(again, '刷新后')
})

// ---------------- 闸不许误伤 ----------------
test('切轨_删除非应用中的自定义主题不得卸掉皮肤', async () => {
  const h = await withSkin({ [KEYS.THEME_CUSTOM]: themeRegistry(['keep']) })
  h.themeApi.deleteCustomTheme('keep')
  assert.equal(h.dom.activeSkin, 'xp', '没发生切轨，皮肤不该被动')
})

test('切轨_导入自定义主题不得卸掉皮肤', async () => {
  const h = await withSkin()
  await h.themeApi.importCustomTheme(JSON.stringify({
    id: 'mine', label: '我的', tokens: { '--dsw-bg': { light: '#fff', dark: '#000' } },
  }))
  assert.equal(h.dom.activeSkin, 'xp', '只是入库，没切轨')
})

// ---------------- 主题 → 皮肤：刻意不对称，主题 override 是皮肤底下的兜底层 ----------------
test('切轨_应用皮肤后主题override保留为底层且主题键不动', async () => {
  const h = await createSubject({ seed: { [KEYS.THEME_FAMILY]: 'azure', [KEYS.THEME_TOUCHED]: '1' } })
  h.start(FULL)
  await tick()
  await h.skinRuntime.applySkin('xp')
  assert.equal(h.dom.activeSkin, 'xp')
  // 启动恢复本就是「先画主题 token 再叠皮肤」；这里删掉 override 会让即时应用与刷新后不一致。
  assert.equal(h.dom.tokens && h.dom.tokens.themeId, 'azure', '主题 override 应留着当底层')
  assert.equal(h.storage.read(KEYS.THEME_FAMILY), 'azure')
  assert.equal(h.storage.read(KEYS.THEME_TOUCHED), '1')
})

// ---------------- 卸载皮肤不许误删别人的 style ----------------
// P0 第二成因（真机取证）：宿主会给 head 里未打标的 <style> 盖上 data-plugin=<当时正在加载的包>，
// 于是本插件自己的面板样式 <style data-appearance-gallery> 在皮肤加载后被盖成
// data-plugin=@linxin666/dsh-client-ui-skin-miku —— 卸载皮肤时被当成皮肤的样式一起删掉，
// 面板按钮退回浏览器默认样式。引擎只该回收「本次激活期间新出现的」style。
test('卸载皮肤_不得删掉激活前就存在的同名data-plugin样式', async () => {
  const { createDoc } = await import('./harness.mjs')
  const { createSkinEngine } = await import('../../src/skin-engine.js')
  const PKG = '@vendor/skin-demo'
  const { document: doc } = createDoc()

  // 本插件自己的面板样式：先于皮肤存在，随后被宿主盖上皮肤包名。
  const mine = doc.createElement('style')
  mine.setAttribute('data-appearance-gallery', '')
  mine.setAttribute('data-plugin', PKG)
  doc.head.appendChild(mine)

  const entry = { id: 'demo', name: 'demo', bodyAttr: 'data-dsh-demo', order: 1, package: PKG }
  let own = null
  const engine = createSkinEngine({
    doc,
    manifest: [entry],
    bundles: { demo: '/* bundle */' },
    executeScript: () => {},
    modules: {
      invalidate() {},
      async import() {
        return {
          apply(ctx) {
            ctx.effect(() => {
              own = doc.createElement('style')
              own.setAttribute('data-plugin', PKG)
              doc.head.appendChild(own)
              doc.body.setAttribute('data-dsh-demo', '1')
              return () => { doc.body.removeAttribute('data-dsh-demo') }
            })
          },
        }
      },
    },
  })

  await engine.activateSkin(entry)
  engine.deactivateSkin()
  assert.equal(doc.querySelectorAll('style[data-appearance-gallery]').length, 1, '本插件自己的样式被误删')
  assert.equal(doc.querySelectorAll('style[data-plugin]').includes(own), false, '皮肤自己注入的样式应被回收')
})
