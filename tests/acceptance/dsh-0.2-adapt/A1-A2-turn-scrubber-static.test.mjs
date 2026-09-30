// 静态门禁（INTERFACE §1.1 / 必验清单 A1、A2）— dsh-turn-scrubber
//
// 只读「数据」：lib/index.js（产物）与 src/**/*.ts 的文本，在断言里比较，不执行任何包内代码。
// 修复前（未加 webServer、未删死参数）这里应 FAIL（红）；修复并重建后应 PASS（绿）。
import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { PKGS, readText, walk, extractInject } from './helpers.mjs'

const LIB_INDEX = path.join(PKGS.turnScrubber, 'lib/index.js')
const srcText = () =>
  walk(path.join(PKGS.turnScrubber, 'src'), ['.ts', '.tsx'])
    .map((f) => readText(f))
    .filter(Boolean)
    .join('\n')

// ---------------- A1：inject 恰为四个服务且保序 ----------------
test('A1 静态_inject 恰为 [connection,sessionPersistence,sessions,webServer]（保序）', () => {
  const expected = ['connection', 'sessionPersistence', 'sessions', 'webServer']
  let inject = extractInject(readText(LIB_INDEX))
  // 兜底：产物里找不到（例如被拆成 re-export）时扫 src 源码
  if (!inject) inject = extractInject(srcText())
  assert.notEqual(inject, null, '在 lib/index.js 与 src 里都找不到 inject 数组声明')
  assert.deepEqual(
    inject,
    expected,
    `inject 应为 [${expected.join(', ')}]，实为 [${inject.join(', ')}]（修复：inject 增加 'webServer'，原三项保序）`,
  )
})

// ---------------- A2：rpc.handle 无第三参（死参数 {authority:'loopback'} 已删） ----------------
// 死参数既出现在运行时调用（产物），也出现在源码；两处都要删干净。
test('A2 静态_lib/index.js 无第三参（死参数 {authority:"loopback"} 已删）', () => {
  const text = readText(LIB_INDEX)
  assert.notEqual(text, null, 'lib/index.js 不存在：先跑 node build.mjs 构建')
  assert.equal(
    /authority\s*:\s*['"]loopback/.test(text),
    false,
    'lib/index.js 仍残留死参数 {authority:"loopback"}（修复：删除 ctx.connection.rpc.handle 的第三参并重建）',
  )
})

test('A2 静态_src 同样无第三参（死参数已从源码删除）', () => {
  const text = srcText()
  assert.ok(text.length > 0, 'src 下找不到 .ts/.tsx 文件')
  assert.equal(
    /authority\s*:\s*['"]loopback/.test(text),
    false,
    'src 仍残留死参数 {authority:"loopback"}（修复：删除 rpc.handle 的第三参）',
  )
})

// 说明：清单 A2 的「NodeContext.connection.rpc.handle 类型签名无 options 形参」属 TypeScript
// 类型层断言，grep 无法可靠定位类型声明（会假绿），故不作为独立自动断言——由本包
// `check`（tsc --noEmit）+ 0.2 运行时 A3/A4 + 上面的死参数删除共同守门（见 TEST-PLAN）。
