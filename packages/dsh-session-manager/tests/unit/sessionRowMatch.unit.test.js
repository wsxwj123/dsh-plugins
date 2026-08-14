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

// ---- I-6: same-title rows must bind DISTINCT ids (never both to the first id) ----

const tieById = {
  a: { title: '同题', displayTitle: '同题', cwd: '/ctx-a', running: false, blank: false },
  b: { title: '同题', displayTitle: '同题', cwd: '/ctx-b', running: true, blank: false },
}
const tieLabel = '会话“同题”的操作'

test('I-6: two same-title rows bind DISTINCT ids in DOM/ids order', () => {
  const got = resolveRows([tieLabel, tieLabel], tieById, ['a', 'b'])
  assert.notStrictEqual(got[0], null)
  assert.notStrictEqual(got[1], null)
  assert.strictEqual(got[0].id, 'a')
  assert.strictEqual(got[1].id, 'b')
  assert.notStrictEqual(got[0].id, got[1].id, 'the two rows must never share one id')
  // Each row carries its OWN session metadata (cwd/running), not the first id's.
  assert.strictEqual(got[1].cwd, '/ctx-b')
  assert.strictEqual(got[1].running, true)
  assert.strictEqual(got[0].running, false)
})

test('I-6: tie alignment follows the ordered id list (reversed ids order)', () => {
  const got = resolveRows([tieLabel, tieLabel], tieById, ['b', 'a'])
  assert.strictEqual(got[0].id, 'b')
  assert.strictEqual(got[1].id, 'a')
})

test('I-6: a unique-title row among a tie pair keeps its own id', () => {
  const byId = {
    a: { title: '独题', displayTitle: '独题', cwd: '/a', blank: false },
    b: { title: '同题', displayTitle: '同题', cwd: '/b', blank: false },
    c: { title: '同题', displayTitle: '同题', cwd: '/c', blank: false },
  }
  const labels = ['会话“独题”的操作', '会话“同题”的操作', '会话“同题”的操作']
  const got = resolveRows(labels, byId, ['a', 'b', 'c'])
  assert.strictEqual(got[0].id, 'a')
  assert.strictEqual(got[1].id, 'b')
  assert.strictEqual(got[2].id, 'c')
})

test('I-6: more same-title rows than ids → the overflow row binds nothing (skip, never a wrong id)', () => {
  const byId = {
    a: { title: '同题', displayTitle: '同题', cwd: '/a', blank: false },
    b: { title: '同题', displayTitle: '同题', cwd: '/b', blank: false },
  }
  const got = resolveRows([tieLabel, tieLabel, tieLabel], byId, ['a', 'b'])
  assert.strictEqual(got[0].id, 'a')
  assert.strictEqual(got[1].id, 'b')
  assert.strictEqual(got[2], null, 'an unbindable overflow row is skipped, never rebound to a')
})

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
