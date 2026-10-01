// dsh-0.2-adapt 0.1.5 e2e 自包含夹具：起一个隔离的 0.1.5 `dsh web` 实例并给出可访问 URL。
//
// 背景（为什么要有这份夹具，而不直接复用用户的 $DSH_HOME）：
//   桌面版迁移时把用户全局 $DSH_HOME/settings.yaml 改名成 settings.yaml.imported，
//   0.1.5 的 `dsh web` 从 `$DSH_HOME/settings.yaml` 读「引导已看过」状态，读不到就
//   把用户当新用户 → 弹首次引导遮罩（`settings.onboarding` 槽位的 WelcomeNotice 步骤），
//   遮罩对应用根节点设 inert，把所有点击都拦下（playwright 报
//   `<div aria-hidden="true" class="_mask_">… intercepts pointer events`）。
//
//   该「已看过」的持久化键（查 0.1.5 宿主 @deepseek-ai/dsh-client-ui-settings-models
//   与 dsh-client-ui-settings-general 源码确认，非猜测）：
//     namespace: ui-onboarding
//     field:      welcomeNoticeVersion
//     期望值:     2026-08-13.1  （WELCOME_NOTICE_VERSION，精确相等才算已看过）
//   文件位置：`$DSH_HOME/settings.yaml`（dsh-settings-file 默认 `<harness home>/settings.yaml`）。
//
//   第二个 onboarding 步骤 `deepseek-official`（DeepSeekOnboardingDialog，引导填 API Key，
//   对话框标题「Add an API key to get started」）在全新 DSH_HOME 下**会**弹：credentials 的
//   describe 对不存在的引用返回 `{configured:false, writable:true}`（非 undefined），readiness
//   判成 credential-missing。消掉它的可靠办法是让该 provider 变成「可用」：给 boot 进程注入
//   一个占位环境变量 DEEPSEEK_API_KEY（inherited 环境凭据 → configured:true → provider-ready →
//   步骤自行 complete），不写任何凭据文件、不伪造真实密钥。
//
// 夹具完全自包含、不碰用户全局 $DSH_HOME：
//   - 每次 mkdtemp 一个临时 DSH_HOME（os.tmpdir 下），结束整目录删除；
//   - 在临时 home 内建 `profiles/web-e2e/`（bundle 含 @deepseek-ai/dsh-base +
//     @deepseek-ai/dsh-web-app + 工作区两个包 link:，结构与 C2 行为级测试一致）；
//   - 写一份预置「引导已看过」的 settings.yaml；
//   - 预置一个 workspace（storages/workspace.json）：composer-tools 的入口按钮注册在
//     `conversation.input.right` 槽位，该槽位只在「已选中 workspace」的会话输入区渲染；
//     全新 DSH_HOME 没有任何 workspace，输入区不出现，按钮也就不注入。预置一个指向临时
//     目录的 workspace 后，web 会把它当当前工作区并渲染输入区（composer 入口随之注入）。
//   - 起 0.1.5 `dsh --profile web-e2e --port 0 --no-open`，从就绪行解析带 token 的 URL。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn, execFileSync } from 'node:child_process'
import { PKGS, REPO_ROOT } from '../helpers.mjs'

// 0.1.5 CLI。优先环境变量 DSH_E2E_CLI（可指向其它 0.1.5 安装），否则找本机 npm-global 的 dsh，
// 再退回 PATH。绝不硬编码用户家目录绝对路径（脱敏闸门）。
const NPM_GLOBAL_DASH = path.join(os.homedir(), '.npm-global', 'bin', 'dsh')
const CLI = process.env.DSH_E2E_CLI || (fs.existsSync(NPM_GLOBAL_DASH) ? NPM_GLOBAL_DASH : 'dsh')

const PROFILE_NAME = 'web-e2e'
const BUNDLES = [
  { name: 'dsh-composer-tools', dir: PKGS.composerTools },
  { name: 'dsh-appearance-gallery', dir: PKGS.appearanceGallery },
]
// 占位 API key：让 deepseek-official provider 判为「可用」，跳过「Add an API key」引导。
// 纯占位、非真实密钥，e2e 不做任何模型调用。见文件头注释。
const PLACEHOLDER_API_KEY = 'e2e-placeholder-not-a-real-key'
const READY_RE = /dsh web:\s+(http:\/\/[^\s]+)/
const READY_TIMEOUT_MS = 90_000
const INSTALL_TIMEOUT_MS = 180_000
const KILL_GRACE_MS = 2_000
const POLL_MS = 250

/** 环境不具备时返回跳过原因（字符串），否则 false（同 C2 行为级测试的 skip 语义）。 */
export function detectSkip() {
  if (process.env.DSH_E2E_BASE_URL) return false // 手动接线：外部已起实例
  if (!fs.existsSync(CLI)) return `0.1.5 CLI 未找到：${CLI}（可用 DSH_E2E_CLI 覆盖）`
  for (const b of BUNDLES) {
    if (!fs.existsSync(path.join(b.dir, 'package.json'))) return `工作区包缺失：${b.dir}`
    if (!fs.existsSync(path.join(b.dir, 'lib'))) return `工作区包未构建（缺 lib）：${b.dir}`
  }
  return false
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 只删本夹具自己 mkdtemp 出来的 home；路径名不符时拒删（防御，避免误删用户目录）。 */
function rmHome(home) {
  if (!home || !path.basename(home).startsWith('dsh-e2e-0.1.5-')) return
  fs.rmSync(home, { recursive: true, force: true })
}

/** 写临时 profile 的最小配置：核心 bundle（0.1.5 运行时）+ 两个本地 link 包，无豁免文件。 */
function writeProfileFiles(profileDir) {
  fs.mkdirSync(profileDir, { recursive: true })
  const pkg = {
    name: `dsh-profile-${PROFILE_NAME}`,
    private: true,
    dependencies: {},
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'] } },
  }
  for (const b of BUNDLES) {
    pkg.dependencies[b.name] = `link:${b.dir}`
    pkg.dsh.profile.bundles.push(b.name)
  }
  fs.writeFileSync(path.join(profileDir, 'package.json'), JSON.stringify(pkg, null, 2) + '\n')
  fs.writeFileSync(
    path.join(profileDir, 'pnpm-workspace.yaml'),
    'packages:\n  - .\n\nnodeLinker: hoisted\nautoInstallPeers: false\n',
  )
  const emptyPatch = '# patch layer（本夹具无需覆盖）\n[]\n'
  fs.writeFileSync(path.join(profileDir, 'cordis.patch.yml'), emptyPatch)
  fs.writeFileSync(path.join(profileDir, 'cordis.yml'), emptyPatch)
}

/** 写预置「引导已看过」的 settings.yaml（见文件头注释的键名与来源）。 */
function writeSettings(home) {
  fs.writeFileSync(
    path.join(home, 'settings.yaml'),
    '# e2e 夹具：预置「引导已看过」状态，跳过 0.1.5 首次引导遮罩\n' +
      '# 键名/值查自 0.1.5 宿主 dsh-client-ui-settings-models（WELCOME_NOTICE_VERSION），非猜测\n' +
      'ui-onboarding:\n' +
      '  welcomeNoticeVersion: 2026-08-13.1\n',
  )
}

/** 预置一个 workspace，让输入区（conversation.input.right 槽位）渲染 → composer 入口按钮注入。 */
function writeWorkspaceSeed(home) {
  // 用仓库根作为 workspace 目录：它是真实存在、含 .git 的目录，web 会把它当当前工作区自动选中
  // 并渲染输入区。读侧只读不写，不污染仓库。指向 DSH_HOME 内部的空目录时，web 只列出不自动选中。
  const wsDir = REPO_ROOT
  const wsId = 'e2e-workspace-00000000-0000-0000-0000-000000000000'
  const now = new Date().toISOString()
  const doc = {
    unit: { name: 'workspace', version: 2 },
    global: { initialized: true, workspaceIds: [wsId], archivedSessionIds: [], pinnedSessionIds: [] },
    tables: {
      workspaces: {
        [wsId]: { path: wsDir, title: 'e2e-workspace', sessionIds: [], createdAt: now, updatedAt: now },
      },
    },
  }
  fs.mkdirSync(path.join(home, 'storages'), { recursive: true })
  fs.writeFileSync(path.join(home, 'storages', 'workspace.json'), JSON.stringify(doc, null, 2) + '\n')
}

/** 兜底：install 若失败，手动补回插件符号链接（boot 断言点在此，与 install 是否成功无关）。 */
function ensureSymlinks(profileDir) {
  const nm = path.join(profileDir, 'node_modules')
  fs.mkdirSync(nm, { recursive: true })
  for (const b of BUNDLES) {
    const link = path.join(nm, b.name)
    if (!fs.existsSync(link)) {
      try {
        fs.symlinkSync(b.dir, link, 'dir')
      } catch {
        /* boot 阶段以「cannot resolve」暴露，仍可被断言捕获 */
      }
    }
  }
}

/** 启动一个隔离实例，返回 { baseUrl, home, child, logFile }；就绪超时则抛错。 */
export async function boot() {
  // 手动接线（DSH_E2E_BASE_URL 已设）：直接复用外部实例，不自己起、也不清理。
  if (process.env.DSH_E2E_BASE_URL) {
    return { baseUrl: process.env.DSH_E2E_BASE_URL, home: null, child: null, logFile: null }
  }
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-e2e-0.1.5-'))
  const profileDir = path.join(home, 'profiles', PROFILE_NAME)
  const env = { ...process.env, DSH_HOME: home, DEEPSEEK_API_KEY: PLACEHOLDER_API_KEY }

  writeProfileFiles(profileDir)
  writeSettings(home)
  writeWorkspaceSeed(home)

  // 装依赖：dsh plugin install 转发给 pnpm（同 C2 行为级测试）；失败不判假绿，boot 输出才作数。
  try {
    execFileSync(CLI, ['plugin', '--profile', PROFILE_NAME, 'install'], {
      env,
      stdio: 'pipe',
      timeout: INSTALL_TIMEOUT_MS,
    })
  } catch {
    /* 兜底由 ensureSymlinks 补回 link，boot 仍可跑 */
  }
  ensureSymlinks(profileDir)

  const logFile = path.join(os.tmpdir(), `dsh-e2e-0.1.5-${process.pid}-${Date.now()}.log`)
  const logFd = fs.openSync(logFile, 'w')
  const child = spawn(CLI, ['--profile', PROFILE_NAME, '--port', '0', '--no-open'], {
    env,
    stdio: ['ignore', logFd, logFd],
  })

  let baseUrl = null
  const deadline = Date.now() + READY_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) break
    const text = safeRead(logFile)
    const m = text.match(READY_RE)
    if (m) {
      baseUrl = m[1]
      break
    }
    await sleep(POLL_MS)
  }
  fs.closeSync(logFd)

  if (!baseUrl) {
    const tail = safeRead(logFile).split('\n').slice(-40).join('\n')
    killChild(child)
    rmHome(home)
    try {
      fs.rmSync(logFile, { force: true })
    } catch {}
    throw new Error(`0.1.5 dsh web 未在 ${READY_TIMEOUT_MS}ms 内就绪。日志尾部：\n${tail}`)
  }

  return { baseUrl, home, child, logFile }
}

/** 无论测试成败都清理：SIGTERM → SIGKILL、删日志、删临时 home。 */
export async function shutdown(handle) {
  if (!handle) return
  if (handle.child) await killChild(handle.child)
  if (handle.logFile) {
    try {
      fs.rmSync(handle.logFile, { force: true })
    } catch {}
  }
  rmHome(handle.home)
}

async function killChild(child) {
  if (!child || (child.exitCode !== null && child.signalCode !== null)) return
  try {
    child.kill('SIGTERM')
  } catch {}
  await sleep(KILL_GRACE_MS)
  if (child.exitCode === null && child.signalCode === null) {
    try {
      child.kill('SIGKILL')
    } catch {}
  }
}

function safeRead(file) {
  try {
    return fs.readFileSync(file, 'utf8')
  } catch {
    return ''
  }
}
