/**
 * resolve-modules.test.mjs — apply 层取宿主模块系统的三条分支。
 *
 * 这是 0.1.1-rc.2 上皮肤轨道整条失效的根因所在：宿主把 ClientModuleSystem 从
 * window 全局搬进了 cordis service。新宿主走 ctx.modules，旧宿主（≤ rc.7）走 window
 * 全局回落，两者都没有才降级为 null。三条分支各一条用例，缺一条就等于放任回归。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveModules } from '../../src/client.js'

/** 只实现 apply 层真正会碰的 ctx.get；未 provide 的服务返回 undefined（对齐 cordis 语义）。 */
const ctxWith = (services) => ({ get: (name) => services[name] })

const SERVICE = { tag: 'ctx.modules' }
const LEGACY = { tag: 'window.__DSH_MODULES__' }

test('新宿主_优先取 cordis service ctx.modules', () => {
  assert.equal(resolveModules(ctxWith({ modules: SERVICE }), {}), SERVICE)
})

test('新宿主_service 存在时不看旧全局', () => {
  assert.equal(resolveModules(ctxWith({ modules: SERVICE }), { __DSH_MODULES__: LEGACY }), SERVICE)
})

test('旧宿主回落_无 service 时取 window.__DSH_MODULES__', () => {
  assert.equal(resolveModules(ctxWith({}), { __DSH_MODULES__: LEGACY }), LEGACY)
})

test('两者皆无_返回 null 走皮肤区降级占位', () => {
  assert.equal(resolveModules(ctxWith({}), {}), null)
})

test('service 为 null 时也回落到旧全局_?? 对 null 与 undefined 同等对待', () => {
  assert.equal(resolveModules(ctxWith({ modules: null }), { __DSH_MODULES__: LEGACY }), LEGACY)
})

test('不把 modules 写进 inject_产物 inject 仍只有 slots', async () => {
  // 硬约束：inject 未满足会让 entry 停在 pending，宿主 assertEntriesActive 直接整页 boot 失败。
  const { readFileSync } = await import('node:fs')
  const { fileURLToPath } = await import('node:url')
  const lib = readFileSync(fileURLToPath(new URL('../../lib/client.js', import.meta.url)), 'utf8')
  assert.ok(lib.includes("exports.inject = ['slots'];"))
  assert.equal(/exports\.inject\s*=\s*\[[^\]]*modules/.test(lib), false)
})
