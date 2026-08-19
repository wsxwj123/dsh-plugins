// sessionRowMatch.unit.test.js — drive the pure row→session title-matching core
// (lib/session-row-match.js). This locks Bug 1 (byId field name: match against
// BOTH the raw `title` and the always-present derived `displayTitle`) and the
// containment + longest-match resolution from Bug 2 (the ⋮ button aria-label
// is the locale-agnostic row→title anchor).
import { test } from 'node:test'
import assert from 'node:assert'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const { matchSessionFromLabel, resolveRows } = await import(path.join(root, 'lib', 'session-row-match.js'))

/** byId fixtures mixing raw-title / displayTitle-only / blank / running shapes. */
const byId = {
  a: { title: '会话A', displayTitle: '会话A', cwd: '/proj-a', running: false, blank: false },
  b: { title: '会话B', displayTitle: '会话B', cwd: '/proj-b', running: true, blank: false },
  // displayTitle-only session (no raw title): the runtime still projects displayTitle.
  c: { displayTitle: 'Untitled Session', cwd: '/proj-c', running: false, blank: false },
  blank1: { displayTitle: 'New Session', cwd: '/proj-d', blank: true },
}

test('matchSessionFromLabel resolves by the raw `title` contained in the aria-label', () => {
  const got = matchSessionFromLabel('会话“会话A”的操作', byId)
  assert.notStrictEqual(got, null)
  assert.strictEqual(got.id, 'a')
  assert.strictEqual(got.title, '会话A')
  assert.strictEqual(got.cwd, '/proj-a')
})

test('matchSessionFromLabel falls back to displayTitle when raw title is absent', () => {
  const got = matchSessionFromLabel('Session actions for Untitled Session', byId)
  assert.notStrictEqual(got, null)
  assert.strictEqual(got.id, 'c')
  assert.strictEqual(got.title, 'Untitled Session')
})

test('matchSessionFromLabel reports running flag for a running session', () => {
  const got = matchSessionFromLabel('会话B 的操作', byId)
  assert.notStrictEqual(got, null)
  assert.strictEqual(got.id, 'b')
  assert.strictEqual(got.running, true)
})

test('blank sessions are never matched', () => {
  const got = matchSessionFromLabel('New Session', byId)
  assert.strictEqual(got, null)
})

test('longest contained title wins (avoids short-title false positives)', () => {
  const byIdLong = {
    short: { title: 'X', displayTitle: 'X', cwd: '/x', blank: false },
    long: { title: 'X 项目需求', displayTitle: 'X 项目需求', cwd: '/long', blank: false },
  }
  const got = matchSessionFromLabel('会话“X 项目需求”的操作', byIdLong)
  assert.notStrictEqual(got, null)
  assert.strictEqual(got.id, 'long')
})

test('no containment match returns null', () => {
  const got = matchSessionFromLabel('会话“不存在的会话”的操作', byId)
  assert.strictEqual(got, null)
})

test('candidate longer than 256 chars is rejected (boundary guard)', () => {
  const huge = '长'.repeat(300)
  const byIdHuge = { h: { title: huge, displayTitle: huge, cwd: '/h', blank: false } }
  const got = matchSessionFromLabel(huge, byIdHuge)
  assert.strictEqual(got, null)
})

// ---- I-6 tie-alignment cases RETIRED (2026-08-17, blind review F2) ----
// The four cases that used to live here (former lines 80-121: "two same-title
// rows bind DISTINCT ids in DOM/ids order", "tie alignment follows the ordered
// id list", "a unique-title row among a tie pair keeps its own id", "more
// same-title rows than ids") are deleted, not rewritten.
// 退役原因：断言把 F2 错误行为钉成预期 —— 它们假设 "DOM 行序 = sessions.list.ids
// 序"，而官方 flat 视图 rows.sort(byRecency) + 两种视图的可拖拽持久顺序
// (reconciledSessionOrder) 都会重排行，按序号对齐同名会话就是在赌，赌错=删错会话。
// 现在同名歧义行一律不注入按钮（tests/regression/f2-l4-row-binding.test.mjs）。

test('I-6: longest-match still wins inside resolveRows', () => {
  const byId = {
    short: { title: 'X', displayTitle: 'X', cwd: '/short', blank: false },
    long: { title: 'X 项目需求', displayTitle: 'X 项目需求', cwd: '/long', blank: false },
  }
  const got = resolveRows(['会话“X 项目需求”的操作'], byId, ['short', 'long'])
  assert.strictEqual(got[0].id, 'long')
})

test('I-6: rows with no label or no title match resolve to null (project/blank rows)', () => {
  const byId = { a: { title: 'A', displayTitle: 'A', cwd: '/a', blank: false } }
  const got = resolveRows([null, '会话“不存在的会话”的操作', '会话“A”的操作'], byId, ['a'])
  assert.strictEqual(got[0], null)
  assert.strictEqual(got[1], null)
  assert.strictEqual(got[2].id, 'a')
})

test('I-6: blank sessions never bind in resolveRows', () => {
  const byId = { blank1: { displayTitle: 'New Session', cwd: '/d', blank: true } }
  const got = resolveRows(['New Session'], byId, ['blank1'])
  assert.strictEqual(got[0], null)
})
