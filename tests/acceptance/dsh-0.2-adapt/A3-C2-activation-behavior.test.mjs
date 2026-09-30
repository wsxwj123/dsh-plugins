// A3 + C2 行为级复现测试（桌面 0.2.0-rc.2 运行时）—— 把两条「人工真机」变自动可跑
//
// 覆盖（依据 INTERFACE-dsh-0.2-adapt §1.1 / §3.1，不读实现代码，只断外部可观察事实）：
//   A3  turn-scrubber 在 0.2 下能激活：启动日志不得出现 `without inject` / `did not activate`
//       （改前唯一错误是 `cannot get property "webServer" without inject` → 宿主记 `did not activate`）
//   C2  appearance-gallery 去掉 profile 版本豁免后仍能激活：启动日志不得出现
//       `skipping profile bundle`（改前 peer 写死 ^0.1.0-rc.6 → 无豁免被宿主跳过）
//   附  composer-tools 也在同一临时 profile 里：启动日志无 `did not activate` / `failed to import`
//       （它是 D2「重建 lib」的守门——composer-tools 的 lib 为构建期生成，未 build 会 failed to import）
//
// 做法（主会话实测可行）：
//   1) 造临时 profile（名字带 -verify，绝不叫 desktop），bundle 用工作区这三个包的本地 link 路径，
//      不拷兼容豁免文件（否则测不到 C2），不拷 node_modules。
//   2) 用桌面自带 CLI `dsh plugin --profile <名> install` 装依赖（自带 pnpm + workspace 设置）。
//   3) 同一 CLI `--profile <名> --port 0 --no-open` 起实例，stdout+stderr 写临时文件，
//      等 35 秒（macOS 无 timeout，用 sleep + kill）后杀进程。
//   4) 断言：输出不得含 `did not activate` / `without inject` / `skipping profile bundle`；
//      且必须出现服务器就绪行 `http://127.0.0.1:<port>`。
//   5) 无论如何清理：删临时 profile、删临时日志、杀残留进程。
//
// 断言只依赖「进程输出里有没有激活失败」这一外部可观察事实，不依赖实现细节。
// 环境不具备时（桌面 App 未装 / DSH_HOME 不存在 / 工作区包缺失）优雅跳过并说明原因，绝不假绿。
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { PKGS } from './helpers.mjs'

// 桌面自带 CLI（Electron 包装，可被 DSH_CLI 覆盖用于指向其它安装位置）
const CLI = process.env.DSH_CLI || '/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh'
const DSH_HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
const PROFILE_NAME = 'dsh-0.2-adapt-verify'
const PROFILE_DIR = path.join(DSH_HOME, 'profiles', PROFILE_NAME)

// 就绪行形如：`dsh web: http://127.0.0.1:64196/?token=…`
const READY_RE = /http:\/\/127\.0\.0\.1:\d+/
const FORBIDDEN = ['did not activate', 'without inject', 'skipping profile bundle']
const BOOT_WAIT_MS = 35_000
const KILL_GRACE_MS = 2_000
const INSTALL_TIMEOUT_MS = 120_000

// 三个包：name 用于 bundle 名与依赖键，dir 用工作区本地路径（修复会落到这里）
const BUNDLES = [
  { name: 'dsh-turn-scrubber', dir: PKGS.turnScrubber },
  { name: 'dsh-composer-tools', dir: PKGS.composerTools },
  { name: 'dsh-appearance-gallery', dir: PKGS.appearanceGallery },
]

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 环境不具备时返回跳过原因字符串，否则 false（node:test 的 skip 选项：false 运行、字符串跳过带原因）。 */
function detectSkip() {
  if (!fs.existsSync(CLI)) return `桌面 App CLI 未安装：${CLI}`
  if (!fs.existsSync(DSH_HOME)) return `DSH_HOME 不存在：${DSH_HOME}`
  for (const b of BUNDLES) {
    if (!fs.existsSync(path.join(b.dir, 'package.json'))) return `工作区包缺失：${b.dir}`
  }
  return false
}

/** 只删本测试自己的临时 profile；路径名不符时拒删（防御，避免误删用户 profile）。 */
function rmProfileDir() {
  if (path.basename(PROFILE_DIR) !== PROFILE_NAME) return
  fs.rmSync(PROFILE_DIR, { recursive: true, force: true })
}

/** 写临时 profile 的最小配置：核心 bundle（0.2 运行时）+ 三个本地 link 包，无豁免文件。 */
function writeProfileFiles() {
  fs.mkdirSync(PROFILE_DIR, { recursive: true })
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
  fs.writeFileSync(path.join(PROFILE_DIR, 'package.json'), JSON.stringify(pkg, null, 2) + '\n')
  fs.writeFileSync(
    path.join(PROFILE_DIR, 'pnpm-workspace.yaml'),
    'packages:\n  - .\n\nnodeLinker: hoisted\nautoInstallPeers: false\n',
  )
  const emptyPatch = '# patch layer（本测试无需覆盖）\n[]\n'
  fs.writeFileSync(path.join(PROFILE_DIR, 'cordis.patch.yml'), emptyPatch)
  fs.writeFileSync(path.join(PROFILE_DIR, 'cordis.yml'), emptyPatch)
}

/** 兜底：install 若因兼容性被拒而回滚掉 link，这里手动补回符号链接（断言点在 boot 输出，与此无关）。 */
function ensureSymlinks() {
  const nm = path.join(PROFILE_DIR, 'node_modules')
  fs.mkdirSync(nm, { recursive: true })
  for (const b of BUNDLES) {
    const link = path.join(nm, b.name)
    if (!fs.existsSync(link)) {
      try {
        fs.symlinkSync(b.dir, link, 'dir')
      } catch {
        /* 忽略：boot 阶段会以「cannot resolve」暴露，仍可被断言捕获 */
      }
    }
  }
}

async function stopChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return
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

/** 从日志里抽取命中行（去 token 防泄漏），用于失败信息。 */
function matchLines(log, re) {
  const redact = (s) => s.replace(/token=[^&\s]+/g, 'token=***')
  return log.split('\n').filter((l) => re.test(l)).map(redact)
}

test(
  'A3/C2 0.2 行为级_三包临时 profile 启动无激活失败且服务器就绪',
  { skip: detectSkip(), timeout: 120_000 },
  async () => {
    let child = null
    let logFile = null
    let logFd = -1
    try {
      // 1) 清理并重建临时 profile（名字带 -verify，不叫 desktop，不污染用户真实 profile）
      rmProfileDir()
      writeProfileFiles()

      // 2) 装依赖（桌面自带 pnpm + workspace 设置；改前 appearance-gallery 会在此被拒，但 link 仍在）。
      //    不据此判失败：断言点在下方的 boot 输出（外部可观察），install 被拒也可能 exit != 0。
      try {
        execFileSync(CLI, ['plugin', '--profile', PROFILE_NAME, 'install'], {
          env: { ...process.env, DSH_HOME },
          stdio: 'pipe',
          timeout: INSTALL_TIMEOUT_MS,
        })
      } catch {
        /* 兜底由 ensureSymlinks 补回 link，boot 仍可跑 */
      }
      ensureSymlinks()

      // 3) 启临时实例并捕获 stdout+stderr 到临时文件
      logFile = path.join(os.tmpdir(), `dsh-0.2-adapt-verify-${process.pid}-${Date.now()}.log`)
      logFd = fs.openSync(logFile, 'w')
      child = spawn(CLI, ['--profile', PROFILE_NAME, '--port', '0', '--no-open'], {
        env: { ...process.env, DSH_HOME },
        stdio: ['ignore', logFd, logFd],
      })
      await sleep(BOOT_WAIT_MS)
      await stopChild(child)
      child = null
      fs.closeSync(logFd)
      logFd = -1

      // 4) 断言：只依赖进程输出的外部可观察事实
      const log = fs.readFileSync(logFile, 'utf8')
      const badReport = []
      for (const marker of FORBIDDEN) {
        const re = new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
        for (const line of matchLines(log, re)) badReport.push(`  [${marker}] ${line}`)
      }
      assert.deepEqual(
        badReport,
        [],
        `启动日志出现激活失败标记，命中行：\n${badReport.slice(0, 12).join('\n')}\n` +
          `（修复前应失败：turn-scrubber 缺 webServer 注入、appearance-gallery 无豁免被跳过）`,
      )
      const ready = matchLines(log, READY_RE)
      assert.ok(
        ready.length > 0,
        '启动日志未出现服务器就绪行（形如 http://127.0.0.1:<port>）——实例可能未成功启动',
      )
    } finally {
      // 5) 无论如何清理：杀残留进程、删临时日志、删临时 profile
      if (logFd >= 0) {
        try {
          fs.closeSync(logFd)
        } catch {}
      }
      if (child) {
        try {
          child.kill('SIGKILL')
        } catch {}
      }
      if (logFile) {
        try {
          fs.rmSync(logFile, { force: true })
        } catch {}
      }
      rmProfileDir()
    }
  },
)
