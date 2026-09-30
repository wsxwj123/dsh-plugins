// dsh-composer-tools 0.1.5（dsh web）回归 e2e（@playwright/test）
//
// 接线：夹具自动起一个已加载 dsh-composer-tools 的隔离 0.1.5 dsh web 实例（自带临时
// DSH_HOME + 预置「引导已看过」状态，不碰用户全局 ~/.dsh）。手动接线时设 DSH_E2E_BASE_URL
// 即可让夹具复用外部已起实例（此时不自起也不清理）。
//
// 覆盖（0.1.5 可自动化的「不回归」面）：
//   B6  面板入口仍注入、点开仍正常（改前一致）
// 0.2 桌面版的 B2/B3/B4/B5（面板显示会话目录、列出并打开 ~/.dsh/AGENTS.md、空白会话不崩、
// sessionId 随切换变化）依赖桌面 App 的会话绑定与 UI，走卡点③真机实测（见 TEST-PLAN），不在本 spec。
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

test('B6 0.1.5回归_面板入口按钮注入且点开无插件错误', async ({ page }) => {
  test.skip(!!skipReason, skipReason || '')
  const BASE = handle.baseUrl
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(4000)
  const btn = page.locator('.dsh-ct-entry-btn, button[title="指令 / 提示词"]').first()
  await expect(btn).toBeVisible({ timeout: 8000 })
  await btn.click()
  await page.waitForTimeout(1500)
  const panelText = await page.evaluate(() => document.body.textContent || '')
  expect(panelText.includes('AGPL-3.0') || panelText.includes('Cherry Studio') || panelText.includes('提示词')).toBe(true)
  expect(errors.filter((e) => e.includes('dsh-composer-tools'))).toEqual([])
})
