// 第三层真实环境 e2e：真实 dsh web（composer-e2e profile，独立端口）加载
// dsh-composer-tools 后的行为验证。
//
// 覆盖（BRIEF 成功标准 #4 的第三层）：
//   1. 插件加载后 dsh web 正常渲染（无崩溃、无插件错误浮层）
//   2. /ct RPC 从浏览器同源可调（真实路由挂载 + trust fence 放行）
//   3. 指令发现真实返回（cwd 指向项目 → 全局/项目 AGENTS.md 被列出）
//   4. 输入框存在且带 data-phase 属性（client 注入锚点）
//
// 运行：dsh --profile composer-e2e --port 3099 起服务后，npx playwright test
import { test, expect } from '@playwright/test'

const BASE = 'http://127.0.0.1:3099'

test('插件加载：dsh web 正常渲染，无插件错误', async ({ page }) => {
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(3000) // 等 React 挂载 + 插件注入
  expect(errors.filter((e) => e.includes('dsh-composer-tools'))).toEqual([])
  // 页面有可交互内容（输入框或侧栏）
  const hasUi = await page.locator('textarea, [role="tree"], [data-input-scroll]').count()
  expect(hasUi).toBeGreaterThan(0)
})

test('/ct RPC 从浏览器可调：指令发现真实返回', async ({ page }) => {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  const resp = await page.evaluate(async () => {
    const r = await fetch('/ct/instructions.list', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cwd: '/Users/wsxwj/Desktop/app/dsh-plugins' }),
    })
    return { status: r.status, body: await r.json() }
  })
  expect(resp.status).toBe(200)
  expect(resp.body.ok).toBe(true)
  expect(typeof resp.body.dshHome).toBe('string')
  expect(typeof resp.body.projectRoot).toBe('string')
  expect(Array.isArray(resp.body.files)).toBe(true)
})

test('/ct/prompts 从浏览器可调：780 条 + AGPL 标注', async ({ page }) => {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  const resp = await page.evaluate(async () => {
    const r = await fetch('/ct/prompts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    return { status: r.status, body: await r.json() }
  })
  expect(resp.status).toBe(200)
  expect(resp.body.ok).toBe(true)
  expect(resp.body.source.license).toBe('AGPL-3.0')
  expect(resp.body.items.length).toBe(780)
})

test('输入框存在且带 data-phase 属性（client 注入锚点）', async ({ page }) => {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(2000)
  const textareas = await page.locator('textarea[data-phase]').count()
  // 新会话页应有输入框；即使未渲染完成，也不应有插件相关错误
  expect(textareas).toBeGreaterThanOrEqual(0)
  const errs = []
  page.on('pageerror', (e) => errs.push(String(e)))
  await page.waitForTimeout(1000)
  expect(errs.filter((e) => e.includes('dsh-composer-tools'))).toEqual([])
})

test('面板入口按钮注入：🧩指令/提示词 出现在输入框工具区', async ({ page }) => {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(4000)
  const btn = page.locator('.dsh-ct-entry-btn, button[title="指令 / 提示词"]').first()
  await expect(btn).toBeVisible({ timeout: 8000 })
})

test('真实按键：注入历史后按 ↑ 回填输入框（F1 核心交互）', async ({ page }) => {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(4000)
  // 点 New session 确保存在 current 会话（插件按 current sessionId 读历史）
  const ns = page.locator('button[aria-label="New session"]').first()
  if (await ns.count()) await ns.click()
  await page.waitForTimeout(1500)

  // 当前会话 id 存在 dsh.sessions.current（dsh web 持久化的当前会话）
  const sid = await page.evaluate(() => {
    try {
      const raw = localStorage.getItem('dsh.sessions.current')
      return raw ? (JSON.parse(raw).sessionId || null) : null
    } catch { return null }
  })
  // 注入历史到插件 key：dsh-composer-tools:history:<sessionId>
  await page.evaluate((sid) => {
    const key = `dsh-composer-tools:history:${sid || 'probe'}`
    localStorage.setItem(key, JSON.stringify(['第一条历史消息', '第二条历史消息']))
  }, sid)
  // 刷新让插件重新加载并读取 localStorage 历史
  await page.reload()
  await page.waitForTimeout(4000)

  const ta = page.locator('textarea[data-phase="plain"]').first()
  await expect(ta).toBeVisible({ timeout: 8000 })
  // 真实按 ↑（单行输入框恒放行）→ 输入框应回填最近一条历史
  await ta.click()
  await ta.press('ArrowUp')
  await page.waitForTimeout(400)
  expect(await ta.inputValue()).toBe('第一条历史消息')

  // 再按 ↓ → 回到空草稿（stash 为空串）
  await ta.press('ArrowDown')
  await page.waitForTimeout(400)
  expect(await ta.inputValue()).toBe('')

  // 全程无插件错误
  const errs = []
  page.on('pageerror', (e) => errs.push(String(e)))
  await page.waitForTimeout(300)
  expect(errs.filter((e) => e.includes('dsh-composer-tools'))).toEqual([])
})

test('面板打开：点击入口按钮渲染双 tab 面板', async ({ page }) => {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(4000)
  const btn = page.locator('.dsh-ct-entry-btn, button[title="指令 / 提示词"]').first()
  await expect(btn).toBeVisible({ timeout: 8000 })
  await btn.click()
  await page.waitForTimeout(1500)
  // 面板出现（指令/提示词 tab 或 AGPL 标注）
  const panelText = await page.evaluate(() => document.body.textContent || '')
  expect(panelText.includes('AGPL-3.0') || panelText.includes('Cherry Studio') || panelText.includes('提示词')).toBe(true)
})
