// 0.2.2 真机 e2e：Lexical contenteditable 输入框下的方向键历史 + 发送采集。
//
// 为什么必须这一层：0.2.2 把 `<textarea data-phase>` 换成 Lexical
// `<div contenteditable="true" data-phase>`，纯逻辑测试与假 DOM 都证明不了
// "真实按键 → 真实 Lexical 渲染 → 真实回填/光标"这条链。本脚本自动拉起一个
// 隔离 DSH 实例（临时 DSH_HOME，独立端口），用真实 Chromium 键盘事件跑完
// 验收清单并把每步的草稿文本打出来（证据可复读）。
//
// 运行（本机）：
//   node tests/e2e/composer-0.2.2.e2e.mjs
// 可选环境变量：
//   DSH_APP_BIN     desktop app 可执行文件（默认 /Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness）
//   DSH_ASAR_DIR    app.asar 目录（默认 /Applications/DeepSeek Harness.app/Contents/Resources/app.asar）
//   DSH_PROFILE_SRC 要复制的 profile（默认 ~/.dsh/profiles/desktop）
//   DSH_022_PORT    隔离实例端口（默认 6633）
//
// 覆盖：↑回填最新 → ↑更旧 → ↓较新 → ↓恢复原草稿；多行"首行↑触发/中间行放行/
// 末行↓触发"；命令菜单打开时 ↑↓ 不劫持；手动编辑后游标重置；会话隔离；
// 真实发送后 0.2.2 事件流采集落盘（且不采宿主注入的 user-role 上下文）。

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { access, cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from '@playwright/test'

const APP_BIN = process.env.DSH_APP_BIN
  ?? '/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness'
const ASAR_DIR = process.env.DSH_ASAR_DIR
  ?? '/Applications/DeepSeek Harness.app/Contents/Resources/app.asar'
const PROFILE_SRC = process.env.DSH_PROFILE_SRC ?? join(homedir(), '.dsh', 'profiles', 'desktop')
const PORT = Number(process.env.DSH_022_PORT ?? 6633)
const BIN_JS = join(ASAR_DIR, 'dsh/node_modules/@deepseek-ai/dsh/lib/bin.js')
const PROFILE_FILES = ['package.json', 'cordis.patch.yml', 'cordis.yml', 'pnpm-workspace.yaml']
const ADAPTER_MODULE = await readFile(new URL('../../lib/composer-target.js', import.meta.url), 'utf8')

async function exists(path) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

// app.asar 内部路径普通 node 看不到（只有 ELECTRON_RUN_AS_NODE 下的 Electron fs 能读），
// 所以只检查 app 可执行文件与 profile；bin.js 由子进程（Electron node）解析。
if (!(await exists(APP_BIN)) || !(await exists(PROFILE_SRC))) {
  console.log(`SKIP: 缺少 desktop app / profile（APP_BIN=${APP_BIN}）——本 e2e 只在本机 desktop 安装上跑。`)
  process.exit(0)
}

// ---- 隔离 DSH_HOME ----
const home = await mkdtemp(join(tmpdir(), 'dsh-ctl-022-'))
const profileDir = join(home, 'profiles', 'verify')
await mkdir(profileDir, { recursive: true })
for (const file of PROFILE_FILES) {
  if (await exists(join(PROFILE_SRC, file))) await cp(join(PROFILE_SRC, file), join(profileDir, file))
}
await symlink(join(PROFILE_SRC, 'node_modules'), join(profileDir, 'node_modules'), 'dir')

// 隔离实例不需要 remote（会弹 "Waiting for sign in" modal 盖住 composer）；从临时
// profile 的 bundle 列表里摘掉它，只影响 /tmp 下的临时 profile。
const pkgPath = join(profileDir, 'package.json')
if (await exists(pkgPath)) {
  const pkg = JSON.parse(await readFile(pkgPath, 'utf8'))
  if (Array.isArray(pkg?.dsh?.profile?.bundles)) {
    pkg.dsh.profile.bundles = pkg.dsh.profile.bundles.filter((bundle) => bundle !== 'ds-harness-remote')
    await writeFile(pkgPath, JSON.stringify(pkg, null, 2))
  }
}

let serverLog = ''
let child = null
let browser = null
let context = null
let baseUrl = ''
const results = []
const pluginErrors = []

/** 记录一条验收结果（失败不中断，最后统一汇总）。 */
async function checkCase(name, fn) {
  try {
    const detail = await fn()
    results.push({ name, ok: true, detail })
    console.log(`✔ ${name}${detail === undefined ? '' : ` — ${detail}`}`)
  } catch (error) {
    results.push({ name, ok: false, detail: String(error?.stack ?? error) })
    console.log(`✖ ${name}`)
    console.log(String(error?.stack ?? error).split('\n').slice(0, 8).map((line) => `   ${line}`).join('\n'))
  }
}

/** 关掉可能遮挡 composer 的 modal（未登录 remote / 引导页），只影响隔离实例测试页。 */
async function dismissDialogs(page) {
  await page.evaluate(() => {
    for (const dialog of document.querySelectorAll('[role="dialog"]')) {
      ;(dialog.closest('[role="presentation"]') ?? dialog).remove()
    }
  })
}

/** 把构建出的 composer 适配层注入页面，用真实实现读草稿全文（与插件运行时同源）。 */
async function injectAdapter(page) {
  await page.evaluate(async (code) => {
    if (window.__ct !== undefined) return
    const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }))
    window.__ct = await import(url)
  }, ADAPTER_MODULE)
}

/** 新开一页并等插件加载完。 */
async function openPage() {
  const page = await context.newPage()
  page.on('pageerror', (error) => {
    const text = String(error)
    pluginErrors.push(text)
    if (text.includes('dsh-composer-tools')) console.log(`[pageerror] ${text.slice(0, 300)}`)
  })
  page.on('console', (message) => {
    if (message.type() !== 'error') return
    const text = message.text()
    if (text.includes('dsh-composer-tools')) pluginErrors.push(text)
  })
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(4500)
  await dismissDialogs(page)
  await injectAdapter(page)
  return page
}

/** 当前会话 id（dsh web 持久化的当前会话）。 */
async function currentSessionId(page) {
  return page.evaluate(() => {
    try {
      const raw = localStorage.getItem('dsh.sessions.current')
      return raw ? (JSON.parse(raw).sessionId ?? null) : null
    } catch {
      return null
    }
  })
}

/** 写入指定会话的历史后刷新（插件只在加载时读 localStorage）。 */
async function seedHistoryAndReload(page, sessionId, entries) {
  await page.evaluate(({ sessionId, entries }) => {
    localStorage.setItem(`dsh-composer-tools:history:${sessionId}`, JSON.stringify(entries))
  }, { sessionId, entries })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(4200)
  await dismissDialogs(page)
  await injectAdapter(page)
}

async function focusComposer(page) {
  await page.evaluate(() => document.querySelector('[contenteditable="true"][data-phase]')?.focus())
  await page.waitForTimeout(120)
}

/**
 * 清空草稿。DSH 会把未发送草稿持久化到会话（换页/刷新会恢复），用例之间必须显式清空，
 * 否则上一个用例残留的草稿会和本用例输入拼在一起。
 */
async function clearDraft(page) {
  await focusComposer(page)
  await page.keyboard.press('Meta+a')
  await page.keyboard.press('Backspace')
  await page.waitForTimeout(250)
  assert.equal(await draftText(page), '', 'clearDraft: 草稿应为空')
}

/** 读当前草稿全文（真实 DOM → 与运行时同一个适配层）。 */
async function draftText(page) {
  return page.evaluate(() => {
    const root = document.querySelector('[contenteditable="true"][data-phase]')
    return root ? window.__ct.readComposerText(root) : null
  })
}

/** 把光标放到第 N 个文本行首（Lexical 每个 [data-lexical-text] 节点是一行的一段）。 */
async function setCaretAtLine(page, lineIndex) {
  await page.evaluate((index) => {
    const root = document.querySelector('[contenteditable="true"][data-phase]')
    if (root === null) throw new Error('composer not found')
    const texts = [...root.querySelectorAll('[data-lexical-text="true"]')]
    const node = texts[index]?.firstChild
    const range = document.createRange()
    if (node !== undefined && node !== null) range.setStart(node, 0)
    else range.setStart(root, 0)
    range.collapse(true)
    const selection = window.getSelection()
    selection.removeAllRanges()
    selection.addRange(range)
    root.focus()
  }, lineIndex)
  await page.waitForTimeout(120)
}

async function press(page, key) {
  await page.keyboard.press(key)
  await page.waitForTimeout(350)
}

/** 等待条件成立（轮询）。 */
async function waitFor(fn, { timeoutMs = 10000, intervalMs = 200, label = 'condition' } = {}) {
  const started = Date.now()
  for (;;) {
    const value = await fn()
    if (value) return value
    if (Date.now() - started > timeoutMs) throw new Error(`timeout waiting for ${label}`)
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
}

/** 历史条目（最新在前）。 */
async function storedHistory(page, sessionId) {
  return page.evaluate((id) => {
    const raw = localStorage.getItem(`dsh-composer-tools:history:${id}`)
    return raw === null ? null : JSON.parse(raw)
  }, sessionId)
}

// ---- 端口占用预检（避免误连到已有实例/静默失败） ----
try {
  const res = await fetch(`http://127.0.0.1:${PORT}/`, { signal: AbortSignal.timeout(1500) })
  console.log(`SKIP: 端口 ${PORT} 已被占用（HTTP ${res.status}）——换个 DSH_022_PORT 再跑。`)
  await rm(home, { recursive: true, force: true })
  process.exit(0)
} catch {
  // 端口空闲，继续。
}

// ---- 拉起隔离实例 ----
try {
  child = spawn(APP_BIN, [BIN_JS, '--profile', 'verify', '--port', String(PORT), '--no-open'], {
    env: { ...process.env, DSH_HOME: home, ELECTRON_RUN_AS_NODE: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout.on('data', (chunk) => { serverLog += String(chunk) })
  child.stderr.on('data', (chunk) => { serverLog += String(chunk) })
  const tokenMatch = await waitFor(
    () => {
      if (child.exitCode !== null) throw new Error(`isolated dsh exited early (code ${child.exitCode})\n${serverLog.slice(-2000)}`)
      return /http:\/\/127\.0\.0\.1:(\d+)\/\?token=([\w-]+)/.exec(serverLog)
    },
    { timeoutMs: 90000, label: 'dsh web token' },
  )
  baseUrl = `http://127.0.0.1:${tokenMatch[1]}/?token=${tokenMatch[2]}`
  console.log(`isolated dsh: ${baseUrl.replace(tokenMatch[2], '<token>')}`)
  await new Promise((resolve) => setTimeout(resolve, 1500))
  browser = await chromium.launch()
  // 剪切（Meta+X）要剪贴板权限；IME 用 CDP 合成。
  context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] })

  // ---- 1. 单行历史：↑ 最新 / ↑ 更旧 / ↓ 较新 / ↓ 恢复原草稿 ----
  await checkCase('history: 单行 ↑↑↓↓ 往返 + 恢复草稿', async () => {
    const page = await openPage()
    const currentSession = await currentSessionId(page)
    assert.ok(currentSession, 'current session id')
    await seedHistoryAndReload(page, currentSession, ['最新一条', '更旧一条'])
    await clearDraft(page)
    await page.keyboard.type('我的草稿')
    await page.waitForTimeout(250)
    assert.equal(await draftText(page), '我的草稿', 'seed 草稿')
    await press(page, 'ArrowUp')
    assert.equal(await draftText(page), '最新一条', '↑ 回填最新')
    await press(page, 'ArrowUp')
    assert.equal(await draftText(page), '更旧一条', '再 ↑ 回填更旧')
    await press(page, 'ArrowDown')
    assert.equal(await draftText(page), '最新一条', '↓ 回填较新')
    await press(page, 'ArrowDown')
    assert.equal(await draftText(page), '我的草稿', '↓ 到底恢复原草稿')
    await page.close()
  })

  // ---- 2. 多行历史：首行 ↑ 触发 / 中间行 ↑ 放行 / 末行 ↓ 触发 ----
  await checkCase('history: 多行首行↑触发、中间行↑放行、末行↓触发', async () => {
    const page = await openPage()
    const sessionId = await currentSessionId(page)
    await seedHistoryAndReload(page, sessionId, ['历史A\n历史B\n历史C'])
    await clearDraft(page)
    // 真实键入两行（Shift+Enter 行内换行）
    await page.keyboard.type('第一行草稿')
    await page.keyboard.down('Shift')
    await page.keyboard.press('Enter')
    await page.keyboard.up('Shift')
    await page.keyboard.type('第二行草稿')
    await page.waitForTimeout(250)
    assert.equal(await draftText(page), '第一行草稿\n第二行草稿', '两行草稿')
    // 光标在末行：↑ 放行（只移动光标，不翻历史）
    await press(page, 'ArrowUp')
    assert.equal(await draftText(page), '第一行草稿\n第二行草稿', '末行 ↑ 放行')
    // 光标到首行：↑ 触发 → 回填多行历史
    await setCaretAtLine(page, 0)
    await press(page, 'ArrowUp')
    assert.equal(await draftText(page), '历史A\n历史B\n历史C', '首行 ↑ 回填历史')
    // 回填后光标在末行：↓ 触发 → 恢复原草稿
    await press(page, 'ArrowDown')
    assert.equal(await draftText(page), '第一行草稿\n第二行草稿', '末行 ↓ 恢复草稿')
    // 再回填一次，光标放中间行：↑/↓ 都放行（草稿不变）
    await setCaretAtLine(page, 0)
    await press(page, 'ArrowUp')
    assert.equal(await draftText(page), '历史A\n历史B\n历史C', '再次回填')
    await setCaretAtLine(page, 1)
    await press(page, 'ArrowUp')
    assert.equal(await draftText(page), '历史A\n历史B\n历史C', '中间行 ↑ 放行')
    await press(page, 'ArrowDown')
    assert.equal(await draftText(page), '历史A\n历史B\n历史C', '中间行 ↓ 放行')
    await page.close()
  })

  // ---- 3. 命令菜单打开时 ↑↓ 归菜单 ----
  await checkCase('menu: 命令菜单打开时 ↑↓ 不劫持历史', async () => {
    const page = await openPage()
    await clearDraft(page)
    await page.keyboard.type('/')
    await page.waitForTimeout(900)
    const menuState = await page.evaluate(() => ({
      menus: document.querySelectorAll('[data-trigger-menu]').length,
      active: document.querySelector('[role="option"][aria-selected="true"]')?.textContent?.slice(0, 80) ?? null,
    }))
    assert.equal(menuState.menus, 1, '菜单应打开')
    const before = await draftText(page)
    assert.equal(before, '/', '草稿是 /')
    await press(page, 'ArrowUp')
    const afterUp = await page.evaluate(() => ({
      menus: document.querySelectorAll('[data-trigger-menu]').length,
      active: document.querySelector('[role="option"][aria-selected="true"]')?.textContent?.slice(0, 80) ?? null,
    }))
    assert.equal(await draftText(page), '/', '菜单打开时 ↑ 不劫持草稿')
    assert.equal(afterUp.menus, 1, '菜单仍打开')
    await press(page, 'ArrowDown')
    assert.equal(await draftText(page), '/', '菜单打开时 ↓ 不劫持草稿')
    const moved = menuState.active !== afterUp.active || afterUp.active !== null
    assert.ok(moved, '菜单高亮应有变化（方向键归菜单）')
    await page.keyboard.press('Escape')
    await page.close()
  })

  // ---- 4. 手动编辑后游标重置 ----
  await checkCase('edit: 翻历史途中手动输入 → 游标重置回最新', async () => {
    const page = await openPage()
    const sessionId = await currentSessionId(page)
    await seedHistoryAndReload(page, sessionId, ['条目A', '条目B'])
    await clearDraft(page)
    await press(page, 'ArrowUp')
    assert.equal(await draftText(page), '条目A', '先回填最新')
    await page.keyboard.type('X')
    await page.waitForTimeout(200)
    assert.equal(await draftText(page), '条目AX', '手动输入接在回填文本后')
    await press(page, 'ArrowUp')
    assert.equal(await draftText(page), '条目A', '手动编辑打断后 ↑ 从最新重新开始')
    await page.close()
  })

  // ---- 4b. 删除类手动编辑（Backspace/Delete/全选删除/剪切）都要重置游标 ----
  // Lexical 对删除只发 keydown 并自己改 DOM，不派发 beforeinput/input；
  // 这一组用例防止"回填后删除再按 ↑ 继续翻更旧"回归。
  await checkCase('edit: Backspace/Delete/全选删/剪切 都重置游标', async () => {
    const variants = [
      { name: 'Backspace', apply: async (page) => { await press(page, 'Backspace') } },
      { name: 'Delete', apply: async (page) => { await press(page, 'Home'); await press(page, 'Delete') } },
      { name: '全选删除', apply: async (page) => { await press(page, 'Meta+a'); await press(page, 'Backspace') } },
      { name: '剪切', apply: async (page) => { await press(page, 'Meta+a'); await press(page, 'Meta+x') } },
    ]
    const evidence = []
    for (const variant of variants) {
      const page = await openPage()
      const sessionId = await currentSessionId(page)
      await seedHistoryAndReload(page, sessionId, ['条目A', '条目B'])
      await clearDraft(page)
      await press(page, 'ArrowUp')
      const recalled = await draftText(page)
      assert.equal(recalled, '条目A', `${variant.name}: ↑ 先回填最新`)
      await variant.apply(page)
      await page.waitForTimeout(150)
      const edited = await draftText(page)
      assert.notEqual(edited, '条目A', `${variant.name}: 删除后草稿应变化`)
      await press(page, 'ArrowUp')
      const afterUp = await draftText(page)
      assert.equal(afterUp, '条目A', `${variant.name}: 删除算手动编辑 → ↑ 从最新重新开始`)
      evidence.push(`${variant.name}: 回填「条目A」→ 删除后「${edited}」→ ↑「${afterUp}」`)
      await page.close()
    }
    console.log(`   ${evidence.join('；')}`)
  })

  // ---- 4c. 纯光标移动不应被当成手动编辑 ----
  await checkCase('edit: 纯光标移动（←/→/Home/End）不重置游标', async () => {
    const page = await openPage()
    const sessionId = await currentSessionId(page)
    await seedHistoryAndReload(page, sessionId, ['条目A', '条目B'])
    await clearDraft(page)
    await press(page, 'ArrowUp')
    assert.equal(await draftText(page), '条目A', '↑ 回填最新')
    await press(page, 'ArrowLeft')
    await press(page, 'ArrowLeft')
    await press(page, 'Home')
    await press(page, 'End')
    await press(page, 'ArrowLeft')
    await press(page, 'ArrowRight')
    assert.equal(await draftText(page), '条目A', '光标移动不改草稿')
    await press(page, 'ArrowUp')
    assert.equal(await draftText(page), '条目B', '光标移动不算编辑 → ↑ 继续翻更旧')
    await page.close()
  })

  // ---- 4d. IME：合成期放行、取消合成不误重置、提交合成算手动编辑 ----
  await checkCase('ime: 合成期 ↑ 放行、取消合成不重置、提交合成算编辑', async () => {
    const page = await openPage()
    const sessionId = await currentSessionId(page)
    const cdp = await page.context().newCDPSession(page)

    // (1) 取消合成：不应重置历史游标
    await seedHistoryAndReload(page, sessionId, ['条目A', '条目B'])
    await clearDraft(page)
    await press(page, 'ArrowUp')
    assert.equal(await draftText(page), '条目A', '回填最新')
    await page.evaluate(() => {
      window.__imeComposeStates = []
      document.addEventListener('keydown', (event) => window.__imeComposeStates.push(event.isComposing), true)
    })
    await cdp.send('Input.imeSetComposition', { text: 'n', selectionStart: 1, selectionEnd: 1 })
    await page.waitForTimeout(400)
    const composingDraft = await draftText(page)
    assert.notEqual(composingDraft, '条目A', '合成文本已进入 DOM')
    await press(page, 'ArrowUp') // 合成期 ↑ 必须放行（isComposing）
    assert.equal(await draftText(page), composingDraft, '合成期 ↑ 不劫持、不翻历史')
    const composingStates = await page.evaluate(() => window.__imeComposeStates)
    assert.equal(composingStates.at(-1), true, '合成期 keydown.isComposing === true')
    await cdp.send('Input.imeSetComposition', { text: '', selectionStart: 0, selectionEnd: 0 })
    await page.waitForTimeout(600)
    assert.equal(await draftText(page), '条目A', '取消合成后文本恢复')
    await press(page, 'ArrowUp')
    assert.equal(await draftText(page), '条目B', '取消合成不算手动编辑 → ↑ 继续翻更旧')

    // (2) 提交合成：算手动编辑 → 游标重置
    await seedHistoryAndReload(page, sessionId, ['条目A', '条目B'])
    await clearDraft(page)
    await press(page, 'ArrowUp')
    await cdp.send('Input.imeSetComposition', { text: 'ni', selectionStart: 2, selectionEnd: 2 })
    await page.waitForTimeout(400)
    await cdp.send('Input.insertText', { text: '你' })
    await page.waitForTimeout(700)
    const committed = await draftText(page)
    assert.equal(committed, '条目A你', '合成提交后草稿含新字')
    await press(page, 'ArrowUp')
    assert.equal(await draftText(page), '条目A', '提交合成算手动编辑 → ↑ 从最新重新开始')
    console.log(`   IME 取消合成：回填「条目A」→ 合成「${composingDraft}」→ ↑ 放行 → 取消 → ↑「条目B」；提交合成：「${committed}」→ ↑「条目A」`)
    await page.close()
  })

  // ---- 5. 会话隔离：真实开新会话并发消息后，历史互不串台 ----
  await checkCase('isolation: 新会话不继承上一会话历史', async () => {
    const page = await openPage()
    const firstSession = await currentSessionId(page)
    assert.ok(firstSession, 'first session id')
    // 前面的用例在同一个会话上 seed 过历史，先清掉并刷新让插件重读（否则断言会混入旧条目）。
    await page.evaluate((id) => localStorage.removeItem(`dsh-composer-tools:history:${id}`), firstSession)
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(4200)
    await dismissDialogs(page)
    await injectAdapter(page)
    await clearDraft(page)
    // 先把当前（blank）会话发成 active —— 0.2.2 里"New session"只有在当前会话
    // 已 stage 时才会真的新建会话 id。
    const firstText = `会话A-${Date.now()}`
    await page.keyboard.type(firstText)
    await press(page, 'Enter')
    await waitFor(async () => {
      const history = await storedHistory(page, firstSession)
      return Array.isArray(history) && history[0] === firstText
    }, { timeoutMs: 15000, label: 'session A capture' })
    // 新建会话：应落到新的 session id（hero）
    const newSessionBtn = page.locator('button[aria-label="New session"]').first()
    await newSessionBtn.click()
    await page.waitForTimeout(2500)
    await dismissDialogs(page)
    const secondSession = await waitFor(async () => {
      const id = await currentSessionId(page)
      return id !== null && id !== firstSession ? id : null
    }, { timeoutMs: 15000, label: 'new session id' })
    await clearDraft(page)
    await press(page, 'ArrowUp')
    assert.equal(await draftText(page), '', '新会话不继承上一会话历史')
    // 新会话发一条：应只落自己的历史
    const secondText = `会话B-${Date.now()}`
    await page.keyboard.type(secondText)
    await press(page, 'Enter')
    await waitFor(async () => {
      const history = await storedHistory(page, secondSession)
      return Array.isArray(history) && history[0] === secondText
    }, { timeoutMs: 15000, label: 'session B capture' })
    await focusComposer(page)
    await press(page, 'ArrowUp')
    assert.equal(await draftText(page), secondText, '↑ 只翻到本会话自己的历史')
    assert.deepEqual(await storedHistory(page, firstSession), [firstText], '旧会话历史不被污染')
    assert.deepEqual(await storedHistory(page, secondSession), [secondText], '新会话历史独立')
    console.log(`   sessions: ${firstSession} vs ${secondSession}`)
    await page.close()
  })

  // ---- 6. 发送采集（0.2.2 事件流）：真实回车 → localStorage ----
  await checkCase('capture: 真实发送 → 0.2.2 事件流采集落盘（过滤宿主注入上下文）', async () => {
    const page = await openPage()
    const sessionId = await currentSessionId(page)
    const historyBefore = (await storedHistory(page, sessionId)) ?? []
    console.log(`   capture session: ${sessionId}（发送前历史 ${JSON.stringify(historyBefore)}）`)
    await clearDraft(page)
    const text = `发送采集取证-${Date.now()}`
    await page.keyboard.type(text)
    await page.waitForTimeout(200)
    await press(page, 'Enter')
    // 宿主受理 → user/message append → 插件采集；LLM 可能因隔离 profile 无凭据而失败，
    // 但 user 事件在受理时已落事件流。
    await waitFor(async () => {
      const history = await storedHistory(page, sessionId)
      return Array.isArray(history) && history[0] === text
    }, { timeoutMs: 15000, label: 'history capture' })
    // 等宿主注入的 user-role 上下文事件（system-reminder/time-context）也 append 完，
    // 再确认历史里没有被误采成条目（否则会出现额外的历史条目）。
    await page.waitForTimeout(3500)
    const history = await storedHistory(page, sessionId)
    assert.deepEqual(history, [text, ...historyBefore], '只采真人输入，不采宿主注入的 user-role 上下文')
    assert.equal(await draftText(page), '', '发送后草稿清空')
    console.log(`   captured history: ${JSON.stringify(history)}`)
    await page.close()
  })

  // ---- 7. 无插件错误 ----
  await checkCase('errors: 全过程无 dsh-composer-tools 报错', async () => {
    const ourErrors = pluginErrors.filter((text) => text.includes('dsh-composer-tools'))
    assert.deepEqual(ourErrors, [], 'plugin errors')
  })
} finally {
  if (context !== null) await context.close().catch(() => {})
  if (browser !== null) await browser.close().catch(() => {})
  if (child !== null && child.exitCode === null) {
    child.kill('SIGTERM')
    await new Promise((resolve) => setTimeout(resolve, 1200))
    if (child.exitCode === null) child.kill('SIGKILL')
  }
  await rm(home, { recursive: true, force: true }).catch(() => {})
}

const failed = results.filter((result) => !result.ok).length
console.log(`\n${results.length - failed}/${results.length} passed`)
if (failed > 0) {
  console.log('\n--- isolated dsh log tail ---')
  console.log(serverLog.slice(-3000))
}
assert.equal(failed, 0, `${failed} real-instance e2e case(s) failed`)
