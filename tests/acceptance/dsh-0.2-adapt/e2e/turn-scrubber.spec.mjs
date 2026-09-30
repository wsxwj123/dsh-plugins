// dsh-turn-scrubber 0.1.5（dsh web）回归 e2e（@playwright/test）
//
// 接线：起一个已加载 dsh-turn-scrubber 的 0.1.5 dsh web 实例，设环境变量后跑：
//   DSH_E2E_BASE_URL=http://127.0.0.1:3099 npx playwright test tests/acceptance/dsh-0.2-adapt/e2e/turn-scrubber.spec.mjs
//
// 覆盖（0.1.5 可自动化的「不回归」面）：
//   A5  插件加载不抛 webServer / without inject 报错
//   A7  删第三参后通道仍 loopback-only：非可信来源 403、本机 loopback 不受影响
// 0.2 桌面版的 A3/A4（启动审计 0 条 did not activate + rpc.call 返回 {ok:true}）依赖桌面 App，
// 走卡点③真机实测（见 .devflow/TEST-PLAN.md），不在本 spec。
import { test, expect } from '@playwright/test'

const BASE = process.env.DSH_E2E_BASE_URL
test.skip(!BASE, '未接线：设 DSH_E2E_BASE_URL 并先起 dsh web（0.1.5）实例')

test('A5 0.1.5回归_插件加载无 webServer / without inject / did not activate 报错', async ({ page }) => {
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text())
  })
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(3000)
  const bad = errors.filter((e) => /turn-scrubber|webServer|without inject|did not activate/.test(e))
  expect(bad).toEqual([])
})

test('A7 非可信来源（Sec-Fetch-Site: cross-site）→ 403 且不返回会话文本', async ({ request }) => {
  const resp = await request.post(`${BASE}/turn-scrubber/turnIndex`, {
    headers: { 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'cross-site' },
    data: { type: 'client-request', rpcId: 'e2e-x', method: 'turnIndex', payload: { sessionId: 'probe' } },
  })
  expect(resp.status()).toBe(403)
  const body = await resp.text()
  expect(body).not.toContain('preview')
})

test('A7 对照_本机 loopback 可信来源不受影响（非 403）', async ({ request }) => {
  const resp = await request.post(`${BASE}/turn-scrubber/turnIndex`, {
    headers: { 'Content-Type': 'application/json' },
    data: { type: 'client-request', rpcId: 'e2e-ok', method: 'turnIndex', payload: { sessionId: 'probe' } },
  })
  expect(resp.status()).not.toBe(403)
})
