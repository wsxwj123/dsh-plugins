// dsh-appearance-gallery 0.1.5（dsh web）回归 e2e（@playwright/test）
//
// 接线：夹具自动起一个已加载 dsh-appearance-gallery 的隔离 0.1.5 dsh web 实例（自带临时
// DSH_HOME + 预置「引导已看过」状态，不碰用户全局 ~/.dsh）。手动接线时设 DSH_E2E_BASE_URL
// 即可让夹具复用外部已起实例（此时不自起也不清理）。
//
// 覆盖（0.1.5 可自动化的「去豁免后仍能加载」面）：
//   C5  去 peer 版本豁免后仍能加载——设置页出现「打开外观设置」入口，且无 peer 冲突/插件错误
// 0.2 桌面版的 C2/C3/C4（无 peer 告警、入口出现、功能闭环 5 条）依赖桌面 App，走卡点③真机实测
//（见 TEST-PLAN），不在本 spec。
import { test, expect } from '@playwright/test'
import { boot, shutdown, detectSkip } from './fixture.mjs'

const skipReason = detectSkip()
let handle = null

test.beforeAll(async () => {
  if (!skipReason) handle = await boot()
})

test.afterAll(async () => {
  await shutdown(handle)
})

test('C5 0.1.5回归_去豁免后设置页仍出现外观入口且无插件错误', async ({ page }) => {
  test.skip(!!skipReason, skipReason || '')
  const BASE = handle.baseUrl
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(3000)
  await page.getByRole('button', { name: /设置|Settings/ }).click()
  // 0.1.5 设置面板默认停在「通用/General」节，外观入口（data-slot-id=appearance-gallery）
  // 即在其下直接可见，无独立 tab 角色可点；原「点通用 tab」一步对 0.1.5 不成立，已去除。
  await expect(page.locator('[data-slot-id="appearance-gallery"]')).toHaveCount(1, { timeout: 8000 })
  expect(errors.filter((e) => /appearance-gallery|peer|plugin/.test(e))).toEqual([])
})
