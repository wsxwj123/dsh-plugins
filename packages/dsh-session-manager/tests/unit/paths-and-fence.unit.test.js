// paths-and-fence.unit.test.js — pure helpers: id validity / stable-segment
// gates, project-dir lookup boundaries, path-in-root check, and the loopback
// trust fence decisions.
import { test } from 'node:test'
import assert from 'node:assert'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const { assertValidId, isStableSegment, lookupProjectDir, isInsideOrEqual } = await import(
  path.join(ROOT, 'lib', 'paths.js')
)
const { isTrustedSmRequest } = await import(path.join(ROOT, 'lib', 'trust-fence.js'))

// ---------- id gates ----------
test('assertValidId: rejects separators/control/empty/dot/bad types', () => {
  for (const id of ['', '.', '..', 'a/b', '../etc', 'a\\b', 'a\nb', 'a\tb', 'a\u0000b', 0, null, {}, [], true]) {
    assert.strictEqual(assertValidId(id), false, `id=${JSON.stringify(id)}`)
  }
})

test('assertValidId: accepts unicode/space/hyphen ids', () => {
  for (const id of ['sess-1', '会话-中文', '含空格 会话', 'a-b_c.d', 'mixed_中文-12']) {
    assert.strictEqual(assertValidId(id), true, `id=${id}`)
  }
})

test('isStableSegment: % ids are NOT stable (path-out-of-bounds at delete)', () => {
  assert.strictEqual(isStableSegment('a%2F..'), false)
  assert.strictEqual(isStableSegment('plain'), true)
  assert.strictEqual(isStableSegment('含空格 会话'), true)
})

// ---------- project lookup ----------
test('lookupProjectDir: undefined cwd -> sessions root; empty -> not-found; non-string -> invalid', () => {
  assert.strictEqual(lookupProjectDir('/r', undefined).kind, 'dir')
  assert.strictEqual(lookupProjectDir('/r', undefined).projectDir, '/r')
  assert.strictEqual(lookupProjectDir('/r', null).kind, 'dir')
  assert.strictEqual(lookupProjectDir('/r', '').kind, 'not-found')
  assert.strictEqual(lookupProjectDir('/r', 42).kind, 'invalid')
})

test('lookupProjectDir: string cwd joins under sessions root', () => {
  const r = lookupProjectDir('/r', 'main')
  assert.strictEqual(r.kind, 'dir')
  assert.strictEqual(r.projectDir, path.join('/r', 'main'))
})

// ---------- path-in-root ----------
test('isInsideOrEqual: containment both literal and resolved', () => {
  assert.strictEqual(isInsideOrEqual('/a/b', '/a/b/c'), true)
  assert.strictEqual(isInsideOrEqual('/a/b', '/a/b'), true)
  assert.strictEqual(isInsideOrEqual('/a/b', '/a/bc'), false)
  assert.strictEqual(isInsideOrEqual('/a/b', '/a/b/../escape'), false)
})

// ---------- trust fence ----------
function req(headers) {
  return { headers }
}

test('fence: loopback host trusted, non-loopback refused', () => {
  assert.strictEqual(isTrustedSmRequest(req({ host: '127.0.0.1:8080' })), true)
  assert.strictEqual(isTrustedSmRequest(req({ host: 'localhost' })), true)
  assert.strictEqual(isTrustedSmRequest(req({ host: '[::1]:8080' })), true)
  assert.strictEqual(isTrustedSmRequest(req({ host: 'evil.example' })), false)
  assert.strictEqual(isTrustedSmRequest(req({ host: '198.18.2.1' })), false)
  assert.strictEqual(isTrustedSmRequest(req({})), false, 'no host -> untrusted')
})

test('fence: cross-site refused, foreign origin refused, same-origin trusted', () => {
  assert.strictEqual(isTrustedSmRequest(req({ host: '127.0.0.1', 'sec-fetch-site': 'cross-site' })), false)
  assert.strictEqual(
    isTrustedSmRequest(req({ host: '127.0.0.1', origin: 'https://evil.example' })),
    false,
  )
  assert.strictEqual(
    isTrustedSmRequest(req({ host: 'localhost:8080', origin: 'http://localhost:8080' })),
    true,
  )
})
