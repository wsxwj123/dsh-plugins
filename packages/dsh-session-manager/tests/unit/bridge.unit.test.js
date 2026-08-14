// bridge.unit.test.js — drive the pure client→host HTTP core
// (lib/bridge-core.js) with a stubbed fetch. Locks review I-5: a network-level
// rejection (host down / abort / disconnect) must map to a structured
// `{ ok:false, code:'network-error' }` failure — never an unhandled rejection
// at the smTrash/smEmptyTrash/smUnarchive call sites — while HTTP and
// non-JSON failures keep their existing structured codes.
import { test } from 'node:test'
import assert from 'node:assert'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const { postJson } = await import(path.join(root, 'lib', 'bridge-core.js'))

test('I-5: fetch rejection (host down / abort) maps to a structured network-error', async () => {
  const fetchImpl = async () => {
    throw new Error('ECONNREFUSED 127.0.0.1')
  }
  const res = await postJson('/sm/delete', { id: 'x' }, fetchImpl)
  assert.strictEqual(res.ok, false)
  assert.strictEqual(res.code, 'network-error')
  assert.match(res.message, /ECONNREFUSED/)
})

test('I-5: the request is a same-origin JSON POST with the exact payload', async () => {
  let seen
  const fetchImpl = async (input, init) => {
    seen = { input, init }
    return { ok: true, status: 200, json: async () => ({ ok: true }) }
  }
  await postJson('/sm/trash', { id: 'a', cwd: '/ctx' }, fetchImpl)
  assert.strictEqual(seen.input, '/sm/trash')
  assert.strictEqual(seen.init.method, 'POST')
  assert.strictEqual(seen.init.headers['content-type'], 'application/json')
  assert.deepStrictEqual(JSON.parse(seen.init.body), { id: 'a', cwd: '/ctx' })
})

test('an absent body is posted as {}', async () => {
  let seen
  const fetchImpl = async (input, init) => {
    seen = init
    return { ok: true, status: 200, json: async () => ({ ok: true }) }
  }
  await postJson('/sm/trash', undefined, fetchImpl)
  assert.strictEqual(seen.body, '{}')
})

test('HTTP error status maps to http-<status>', async () => {
  const fetchImpl = async () => ({ ok: false, status: 403, json: async () => ({ error: 'forbidden' }) })
  const res = await postJson('/sm/emptyTrash', { confirm: true }, fetchImpl)
  assert.strictEqual(res.ok, false)
  assert.strictEqual(res.code, 'http-403')
})

test('a non-JSON success body maps to invalid-response', async () => {
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    json: async () => {
      throw new SyntaxError('Unexpected token <')
    },
  })
  const res = await postJson('/sm/trash', {}, fetchImpl)
  assert.strictEqual(res.ok, false)
  assert.strictEqual(res.code, 'invalid-response')
})

test('a 200 JSON body passes through untouched (host fields ride along, e.g. moved:true)', async () => {
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ ok: false, code: 'system-error', moved: true }),
  })
  const res = await postJson('/sm/delete', { id: 'a' }, fetchImpl)
  assert.deepStrictEqual(res, { ok: false, code: 'system-error', moved: true })
})
