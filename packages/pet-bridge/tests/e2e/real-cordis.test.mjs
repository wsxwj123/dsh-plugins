/**
 * e2e 真实环境验收：在真实 cordis + 真实 dsh（headless profile）里加载插件跑任务，
 * 用假 pet 接收端断言推送——抓所有测试替身模拟不到的环境语义问题
 * （inject 约束、cordis 可调用服务 this 绑定、fiber 上下文等）。
 *
 * 前置条件（本机开发环境）：
 *   - `dsh` 在 PATH（npm global bin）
 *   - `~/.dsh/profiles/node_modules/dsh-pet-bridge` symlink 指向本包
 *
 * 慢（每次 headless 启动 + 模型响应约 5-15 秒），属「改代码后必跑」的守门测试。
 */
import { test } from 'node:test'
import assert from 'node:assert'
import { spawn, execSync } from 'node:child_process'
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const PKG_DIR = path.resolve(import.meta.dirname, '../..')

/** 起一个假 pet HookServer，收集收到的 body，返回 { port, bodies, close } */
function fakePetServer() {
  const bodies = []
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      try {
        bodies.push(JSON.parse(body))
      } catch {
        bodies.push({ raw: body })
      }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end('{"ok":true}')
    })
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({
        port: server.address().port,
        bodies,
        close: () => new Promise((r) => server.close(r)),
      })
    })
  })
}

/** 写临时 patch（insert pet-bridge + config.port） */
function writePatch(port) {
  const p = path.join(os.tmpdir(), `pet-bridge-e2e-${Date.now()}-${Math.floor(Math.random() * 1e6)}.yml`)
  fs.writeFileSync(
    p,
    `- insert:\n    - id: pet-bridge\n      name: dsh-pet-bridge\n      config:\n        port: ${port}\n`,
  )
  return p
}

/** 跑一次 dsh headless 任务，返回 { code, stdout, stderr } */
function runHeadless(patchPath, task) {
  return new Promise((resolve) => {
    const proc = spawn('dsh', ['--profile', 'headless', '--patch', patchPath, task], {
      env: { ...process.env },
    })
    let stdout = ''
    let stderr = ''
    proc.stdout.on('data', (d) => (stdout += d))
    proc.stderr.on('data', (d) => (stderr += d))
    const timer = setTimeout(() => {
      proc.kill('SIGKILL')
      resolve({ code: 'timeout', stdout, stderr })
    }, 120_000)
    proc.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code, stdout, stderr })
    })
  })
}

function checkSymlink() {
  const link = path.join(os.homedir(), '.dsh', 'profiles', 'node_modules', 'dsh-pet-bridge')
  return fs.existsSync(link)
}

test('前置条件：dsh 可用 + dsh-pet-bridge symlink 存在（缺则跳过）', (t) => {
  const hasDsh = (() => {
    try {
      execSync('which dsh', { stdio: 'pipe' })
      return true
    } catch {
      return false
    }
  })()
  if (!hasDsh || !checkSymlink()) {
    t.skip('dsh 或 symlink 缺失，跳过真实环境测试')
    return
  }
  assert.ok(true)
})

test('真实环境：正常推送（user/pre/post 到假 pet，payload 正确）', async (t) => {
  if (!checkSymlink()) return t.skip('symlink 缺失')
  const pet = await fakePetServer()
  t.after(pet.close)
  const patch = writePatch(pet.port)
  t.after(() => fs.unlinkSync(patch))

  const r = await runHeadless(patch, '运行 pwd 然后回复完成')
  assert.equal(r.code, 0, `dsh 应正常退出（stderr: ${r.stderr.slice(0, 300)}）`)
  assert.ok(
    !/this is not a function|cannot get property|without inject|TypeError/i.test(r.stderr),
    `stderr 不应有 cordis 崩溃（实际: ${r.stderr.slice(0, 300)}）`,
  )

  const kinds = pet.bodies.map((b) => b.kind)
  assert.ok(kinds.includes('user'), `应有 user 推送（实际: ${kinds}）`)
  assert.ok(kinds.includes('pre'), `应有 pre 推送（实际: ${kinds}）`)
  const pre = pet.bodies.find((b) => b.kind === 'pre')
  assert.equal(pre.agent_source, 'dsh')
  assert.equal(typeof pre.tool_name, 'string')
  assert.equal(typeof pre.tool_input, 'object')
  assert.equal(pre.tool_input.command, 'pwd', 'bash 工具应带 command 首词摘要')
  for (const b of pet.bodies) {
    assert.equal(b.agent_source, 'dsh')
    assert.equal(b.caller_pid, r.code === 0 ? b.caller_pid : b.caller_pid) // caller_pid 存在即可
    assert.ok(typeof b.caller_pid === 'number')
    assert.ok('tool_input' in b)
  }
})

test('真实环境：推送失败（端口无监听）进程不崩、静默降级', async (t) => {
  if (!checkSymlink()) return t.skip('symlink 缺失')
  // 找一个肯定没监听的端口
  const probe = http.createServer()
  await new Promise((r) => probe.listen(0, '127.0.0.1', r))
  const port = probe.address().port
  await new Promise((r) => probe.close(r))

  const patch = writePatch(port)
  t.after(() => fs.unlinkSync(patch))

  const r = await runHeadless(patch, '运行 pwd 然后回复完成')
  assert.equal(r.code, 0, `dsh 应正常退出（stderr: ${r.stderr.slice(0, 300)}）`)
  assert.ok(
    !/this is not a function|cannot get property|without inject|TypeError/i.test(r.stderr),
    `推送失败不应崩（实际: ${r.stderr.slice(0, 300)}）`,
  )
})
