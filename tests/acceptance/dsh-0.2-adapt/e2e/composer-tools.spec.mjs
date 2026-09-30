// dsh-composer-tools 0.1.5（dsh web）回归 e2e（@playwright/test）
//
// 接线：起一个已加载 dsh-composer-tools 的 0.1.5 dsh web 实例，设环境变量后跑：
//   DSH_E2E_BASE_URL=http://127.0.0.1:3099 npx playwright test tests/acceptance/dsh-0.2-adapt/e2e/composer-tools.spec.mjs
//
// 覆盖（0.1.5 可自动化的「不回归」面）：
//   B6  面板入口仍注入、点开仍正常（改前一致）
// 0.2 桌面版的 B2/B3/B4/B5（面板显示会话目录、列出并打开 ~/.dsh/AGENTS.md、空白会话不崩、
// sessionId 随切换变化）依赖桌面 App 的会话绑定与 UI，走卡点③真机实测（见 TEST-PLAN），不在本 spec。
import { test, expect } from '@playwright/test'

const BASE = process.env.DSH_E2E_BASE_URL
test.skip(!BASE, '未接线：设 DSH_E2E_BASE_URL 并先起 dsh web（0.1.5）实例')

test('B6 0.1.5回归_面板入口按钮注入且点开无插件错误', async ({ page }) => {
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
