// 静态门禁（INTERFACE §2.1 / 必验清单 B1）— dsh-composer-tools
//
// 只读「数据」：src/**/*.ts(x) 文本，在断言里比较，不执行包内代码。
// 修复前（EntryProps 无 sessionId、取值仍写 snapshot.current、current/cwd 非可选）这里应 FAIL（红）；
// 修复后应 PASS（绿）。
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { PKGS, walk } from './helpers.mjs'

const srcText = () =>
  walk(path.join(PKGS.composerTools, 'src'), ['.ts', '.tsx'])
    .map((f) => {
      try {
        return fs.readFileSync(f, 'utf8')
      } catch {
        return null
      }
    })
    .filter(Boolean)
    .join('\n')

// B1-1：EntryProps 含 sessionId?: string（新增标准 prop）
test('B1 静态_EntryProps 含 sessionId?: string', () => {
  const text = srcText()
  assert.ok(text.length > 0, 'src 下找不到 .ts/.tsx 文件')
  assert.match(
    text,
    /EntryProps[\s\S]{0,300}?sessionId\s*\??\s*:\s*string/,
    'EntryProps 未声明 sessionId?: string（修复：给 EntryProps 增加 sessionId?: string）',
  )
})

// B1-2：当前会话 id 取值 = props.sessionId ?? snapshot.current（先标准 prop、后 0.1.5 兜底）
test('B1 静态_当前会话 id 取值 = props.sessionId ?? snapshot.current', () => {
  const text = srcText()
  assert.match(
    text,
    /props\.sessionId\s*\?\?\s*snapshot\.current/,
    '找不到 props.sessionId ?? snapshot.current（修复：取值改为先 props.sessionId、再 snapshot.current 兜底）',
  )
})

// B1-3：SessionListSnapshot.current 改为可选（0.1.5-only）——类型字段 current?:
test('B1 静态_SessionListSnapshot.current 改为可选 current?', () => {
  const text = srcText()
  assert.match(
    text,
    /SessionListSnapshot[\s\S]{0,300}?current\s*\?\s*:/,
    'SessionListSnapshot.current 未改为可选（current?:）（修复：current 标记为可选并注明 0.1.5-only）',
  )
})

// B1-4：SessionSummary.cwd 改为可选 string（cwd?: string）
test('B1 静态_SessionSummary.cwd 为可选 string', () => {
  const text = srcText()
  assert.match(
    text,
    /SessionSummary[\s\S]{0,300}?cwd\s*\?\s*:\s*string/,
    'SessionSummary.cwd 未声明为可选 string（cwd?: string）（修复：cwd 标记为可选 string）',
  )
})
