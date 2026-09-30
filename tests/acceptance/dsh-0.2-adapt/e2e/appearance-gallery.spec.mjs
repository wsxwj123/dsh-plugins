// dsh-appearance-gallery 0.1.5（dsh web）回归 e2e（@playwright/test）
//
// 接线：起一个已加载 dsh-appearance-gallery 的 0.1.5 dsh web 实例，设环境变量后跑：
//   DSH_E2E_BASE_URL=http://127.0.0.1:3099 npx playwright test tests/acceptance/dsh-0.2-adapt/e2e/appearance-gallery.spec.mjs
//
// 覆盖（0.1.5 可自动化的「去豁免后仍能加载」面）：
//   C5  去 peer 版本豁免后仍能加载——设置页出现「打开外观设置」入口，且无 peer 冲突/插件错误
// 0.2 桌面版的 C2/C3/C4（无 peer 告警、入口出现、功能闭环 5 条）依赖桌面 App，走卡点③真机实测
//（见 TEST-PLAN），不在本 spec。
import { test, expect } from '@playwright/test'

const BASE = process.env.DSH_E2E_BASE_URL
test.skip(!BASE, '未接线：设 DSH_E2E_BASE_URL 并先起 dsh web（0.1.5）实例')

test('C5 0.1.5回归_去豁免后设置页仍出现外观入口且无插件错误', async ({ page }) => {
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(3000)
  await page.getByRole('button', { name: /设置|Settings/ }).click()
  await page.getByRole('tab', { name: /通用|General/ }).click()
  await expect(page.locator('[data-slot-id="appearance-gallery"]')).toHaveCount(1, { timeout: 8000 })
  expect(errors.filter((e) => /appearance-gallery|peer|plugin/.test(e))).toEqual([])
})
