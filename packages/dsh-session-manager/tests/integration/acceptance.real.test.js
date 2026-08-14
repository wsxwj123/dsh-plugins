// acceptance.real.test.js — drive the REAL node-half handler over a real
// loopback HTTP server against a real temp filesystem, exercising the same 65
// scenarios the locked contract image (tests/acceptance) asserts.
//
// Why this file exists: tests/acceptance/*.test.js import ./helpers.js, whose
// createTestContext() builds an internal "contract mirror" backend. Those
// files are read-only (locked), so they cannot be re-pointed at the real
// handler without modification. This file is the bridge the task asks for: it
// re-declares the identical behaviors against the real implementation (real
// src/handler.ts + src/trash.ts + src/trust-fence.ts + real fs + real
// workspace.json write), reported as status/json exactly like the harness.
//
// The server below reproduces the real route wiring from src/index.ts (the
// loopback trust fence + raw JSON body + dispatch) but as a thin HTTP adapter,
// so the assertions travel the same wire as the acceptance tests while the
// behavioral core is the shipped handler.
import { test, before, after } from 'node:test'
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const { TrashStore, SESSION_MARKER, METADATA_DIR } = await import(path.join(ROOT, 'lib', 'trash.js'))
const { createSmHandler } = await import(path.join(ROOT, 'lib', 'handler.js'))
const { isTrustedSmRequest } = await import(path.join(ROOT, 'lib', 'trust-fence.js'))
const { projectKey, encodeSegment, NO_CWD_DIR } = await import(path.join(ROOT, 'lib', 'paths.js'))

// ---------------- real backend (raw /sm surface) ----------------
function makeRealBackend(env) {
  const handler = env.handler
  return {
    handle(method, req, body) {
      // Loopback fence first (the same gate src/index.ts applies).
      if (!isTrustedSmRequest(req)) return { status: 403, json: { error: 'forbidden' } }
      if (method === null || method === undefined) return { status: 404, json: { error: 'not found' } }
      return handler.handle(method, req, body)
    },
  }
}

// ---------------- fake sessions / workspace / trash builders ----------------
function makeFakeSessionsRoot(tmpRoot) {
  const sessionsRoot = path.join(tmpRoot, 'sessions')
  fs.mkdirSync(sessionsRoot, { recursive: true })
  return sessionsRoot
}

// Create a fake session on the REAL encoded DSH layout so the node handler's
// projectKey/encodeSegment resolution finds it (mirrors the acceptance harness's
// literal helper, but on the actual on-disk encoding this handler targets).
// `projectLabel`: '' = no-cwd (_no-cwd dir), otherwise treated as a cwd label.
function makeFakeSession(root, projectLabel, id, opts = {}) {
  const projectDir = projectLabel
    ? path.join(root, projectKey(projectLabel))
    : path.join(root, NO_CWD_DIR)
  const dir = path.join(projectDir, encodeSegment(id))
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, SESSION_MARKER), opts.content || 'DUMMY_SESSION_LOG\n')
  return { dir, markerPath: path.join(dir, SESSION_MARKER) }
}

function makeWorkspaceGlobal(tmpRoot, archiveIds = []) {
  const file = path.join(tmpRoot, 'workspace.json')
  const store = { initialized: true, workspaceIds: ['main'], archivedSessionIds: [...archiveIds] }
  const dir = path.dirname(file)
  if (dir !== tmpRoot) fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(file, JSON.stringify(store))
  function read() {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')) }
    catch { return { initialized: true, workspaceIds: [], archivedSessionIds: [] } }
  }
  function write(v) { fs.writeFileSync(file, JSON.stringify(v)) }
  return {
    path: file,
    read,
    write,
    archived() { return read().archivedSessionIds || [] },
    setArchived(next) { const cur = read(); cur.archivedSessionIds = [...next]; write(cur) },
  }
}

function makeTrashRoot(tmpRoot) {
  const trashRoot = path.join(tmpRoot, 'trash')
  fs.mkdirSync(path.join(trashRoot, METADATA_DIR), { recursive: true })
  return {
    root: trashRoot,
    metaDir: path.join(trashRoot, METADATA_DIR),
    recordPath: (id) => path.join(trashRoot, METADATA_DIR, `${id}.json`),
    records() {
      if (!fs.existsSync(this.metaDir)) return []
      return fs.readdirSync(this.metaDir)
        .filter((f) => f.endsWith('.json'))
        .map((f) => { try { return JSON.parse(fs.readFileSync(path.join(this.metaDir, f), 'utf8')) } catch { return null } })
        .filter(Boolean)
    },
  }
}

// The real TrashStore also persists records to <trash>/_metadata/<id>.json, so
// the harness-style `trash.records()` reader above matches its on-disk format.
function bindRealTrashStore(env) {
  const store = new TrashStore(env.trash.root, {
    rmItem(id, trashRoot) {
      if (env.cfg.state.emptyFailItems.has(id)) return false
      fs.rmSync(path.join(trashRoot, id), { recursive: true, force: true })
      return undefined
    },
  })
  env._realTrash = store
  return store
}

// ---------------- real context ----------------
async function createRealTestContext(overrides = {}) {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-sm-real-'))
  const sessionsRoot = makeFakeSessionsRoot(tmpRoot)

  const cfg = {
    state: {
      liveIds: new Set(),
      domainUnavailable: false,
      storageWriteFail: false,
      emptyFailItems: new Set(),
    },
  }
  const workspace = makeWorkspaceGlobal(tmpRoot, overrides.archived || [])
  const trash = makeTrashRoot(tmpRoot)
  const env = {
    tmpRoot,
    sessionsRoot,
    workspace,
    trash,
    cfg,
    projectCwdMap: overrides.projectCwdMap || {},
    _emptyFailItems: cfg.state.emptyFailItems,
  }

  // Real TrashStore backed by the same on-disk layout the test asserts against.
  const store = bindRealTrashStore(env)

  const state = cfg.state
  const storageDomain = {
    get(name) {
      if (name !== 'workspace') return null
      if (state.domainUnavailable) return null
      return {
        global: {
          get: () => workspace.read(),
          set(value) {
            if (state.storageWriteFail) throw new Error('storage write failed (simulated)')
            workspace.write(value)
          },
        },
      }
    },
  }

  const handler = createSmHandler({
    sessionsRoot,
    trash: store,
    sessions: { get: (id) => (state.liveIds.has(id) ? { id, running: true } : null) },
    storageDomain,
    readArchived: () => workspace.archived(),
    readWorkspaceGlobal: () => workspace.read(),
    projectDirOverride: (cwd) => env.projectCwdMap[cwd],
    log: { warn: () => {} },
  })
  env.handler = handler

  const backend = makeRealBackend(env)
  const server = await startServer(backend)

  const cleanup = () => fs.rmSync(tmpRoot, { recursive: true, force: true })

  return {
    ...env,
    server,
    cleanup,
    newSession(projectKey, id, opts) { return makeFakeSession(sessionsRoot, projectKey, id, opts) },
    live(id, on) { if (on === undefined || on === true) state.liveIds.add(id); else state.liveIds.delete(id) },
    makeDomainUnavailable() { state.domainUnavailable = true },
    makeStorageWriteFail() { state.storageWriteFail = true },
    makeEmptyFail(id) { state.emptyFailItems.add(id) },
  }
}

// ---------------- HTTP server (mirrors the acceptance startServer) ----------------
function startServer(backend) {
  const server = http.createServer((req, res) => {
    const send = (status, json) => {
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(JSON.stringify(json))
    }
    // Tests inject "trust attributes" (host/sec-fetch-site/origin) via a safe
    // enumerated header because fetch forbids setting them directly.
    let authHeaders = {}
    try {
      const raw = req.headers['x-sm-test-headers']
      if (raw) authHeaders = JSON.parse(raw)
    } catch { authHeaders = {} }
    // Overlay injected auth onto the request headers for the real fence to read.
    const overlay = { ...req.headers, ...toLower(authHeaders) }
    req.headers = overlay

    let raw = ''
    req.setEncoding('utf8')
    req.on('data', (c) => (raw += c))
    req.on('end', () => {
      let parsed
      try { parsed = raw ? JSON.parse(raw) : undefined } catch { parsed = '__BAD_JSON__' }
      const m = req.url.match(/^\/sm\/([^/?#]+)/)
      const method = m ? m[1] : null
      if (parsed === '__BAD_JSON__') {
        send(400, { ok: false, code: 'bad-request', message: 'invalid JSON' })
        return
      }
      const resp = backend.handle(method, req, parsed)
      send(resp.status, resp.json)
    })
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      const base = `http://127.0.0.1:${port}`
      resolve({
        base,
        close: () => new Promise((r) => server.close(r)),
        async call(method, body, headers = {}) {
          const hh = packRequestHeaders(headers)
          const fetchRes = await fetch(`${base}/sm/${method}`, {
            method: body === undefined ? 'GET' : 'POST',
            headers: hh,
            body: body === undefined ? undefined : JSON.stringify(body),
          })
          const text = await fetchRes.text()
          let json = null
          try { json = text ? JSON.parse(text) : null } catch { json = { parseError: true, raw: text } }
          return { status: fetchRes.status, json }
        },
        async rawCall(method, rawBody, headers = {}) {
          const hh = packRequestHeaders(headers)
          const fetchRes = await fetch(`${base}/sm/${method}`, {
            method: rawBody === undefined ? 'GET' : 'POST',
            headers: hh,
            body: rawBody,
          })
          const text = await fetchRes.text()
          let json = null
          try { json = text ? JSON.parse(text) : null } catch { json = { parseError: true, raw: text } }
          return { status: fetchRes.status, json }
        },
      })
    })
  })
}

function toLower(obj) {
  const out = {}
  for (const [k, v] of Object.entries(obj)) out[k.toLowerCase()] = v
  return out
}

function packRequestHeaders(headers = {}) {
  const authKeys = ['host', 'sec-fetch-site', 'origin']
  const auth = {}
  const rest = { 'content-type': 'application/json' }
  for (const [k, v] of Object.entries(headers)) {
    if (authKeys.includes(k.toLowerCase())) auth[k.toLowerCase()] = v
    else rest[k] = v
  }
  if (Object.keys(auth).length) rest['x-sm-test-headers'] = JSON.stringify(auth)
  return rest
}

// ---------------- shared assertions ----------------
function assertCode(t, res, status, code) {
  t.assert.equal(res.status, status, `HTTP ${status} expected, got ${res.status} body=${JSON.stringify(res.json)}`)
  if (status !== 200) return
  if (code != null) {
    t.assert.equal(res.json && res.json.ok, false, 'must be ok:false on error')
    t.assert.equal(res.json && res.json.code, code, `code ${code} expected, got ${res.json && res.json.code}`)
  } else {
    t.assert.ok(res.json && res.json.ok === true, 'must be ok:true')
  }
}
const exists = (p) => fs.existsSync(p)

// ================= auth (8) =================
let actx
before(async () => { actx = await createRealTestContext() })
after(async () => { await actx.server.close(); actx.cleanup() })

test('REAL auth: loopback host trusted, business branch reachable', async (t) => {
  const res = await actx.server.call('trash', undefined, {})
  t.assert.equal(res.status, 200, 'loopback passes fence')
})
test('REAL auth: non-loopback Host -> 403, no move', async (t) => {
  const s = actx.newSession('auth', 'sess-badhost')
  const res = await actx.server.call('delete', { id: 'sess-badhost', cwd: 'auth' }, { host: 'evil.example' })
  assertCode(t, res, 403, null)
  t.assert.ok(exists(s.dir))
})
test('REAL auth: cross-site -> 403', async (t) => {
  const s = actx.newSession('auth', 'sess-crosssite')
  const res = await actx.server.call('delete', { id: 'sess-crosssite', cwd: 'auth' }, { 'sec-fetch-site': 'cross-site' })
  assertCode(t, res, 403, null)
  t.assert.ok(exists(s.dir))
})
test('REAL auth: foreign origin -> 403', async (t) => {
  const res = await actx.server.call('emptyTrash', { confirm: true }, { origin: 'https://evil.example' })
  assertCode(t, res, 403, null)
})
test('REAL auth: 403 precedes confirm:true', async (t) => {
  actx.newSession('auth', 'sess-empty')
  await actx.server.call('delete', { id: 'sess-empty', cwd: 'auth' })
  const res = await actx.server.call('emptyTrash', { confirm: true }, { 'sec-fetch-site': 'cross-site' })
  assertCode(t, res, 403, null)
  t.assert.ok(exists(path.join(actx.trash.root, 'sess-empty')))
})
test('REAL auth: fence is per-request (one 403 does not poison later)', async (t) => {
  const s = actx.newSession('auth', 'sess-after403')
  await actx.server.call('delete', { id: 'sess-badhost', cwd: 'auth' }, { host: 'evil.example' })
  const res = await actx.server.call('delete', { id: 'sess-after403', cwd: 'auth' }, {})
  assertCode(t, res, 200, null)
  t.assert.equal(exists(s.dir), false)
})
test('REAL auth: restore fenced too', async (t) => {
  const s = actx.newSession('auth', 'sess-rev-fence')
  await actx.server.call('delete', { id: 'sess-rev-fence', cwd: 'auth' })
  const res = await actx.server.call('restore', { id: 'sess-rev-fence' }, { host: '198.18.2.1' })
  assertCode(t, res, 403, null)
  t.assert.ok(!exists(s.dir))
})
test('REAL auth: unknown method -> 404 not 403', async (t) => {
  const res = await actx.server.rawCall('nonexistent', '{}')
  t.assert.equal(res.status, 404)
})

// ================= delete (27) =================
let dctx
before(async () => { dctx = await createRealTestContext() })
after(async () => { await dctx.server.close(); dctx.cleanup() })
const proj = 'main-workspace'

test('REAL delete F1: moves dir + marker into trash, original gone', async (t) => {
  const s = dctx.newSession(proj, 'sess-normal')
  const res = await dctx.server.call('delete', { id: 'sess-normal', cwd: proj, title: '日常会话' })
  assertCode(t, res, 200, null)
  t.assert.equal(exists(s.dir), false)
  t.assert.ok(exists(path.join(dctx.trash.root, 'sess-normal', SESSION_MARKER)))
})
test('REAL delete F1: session-local artifacts move too', async (t) => {
  const s = dctx.newSession(proj, 'sess-with-artifacts')
  fs.writeFileSync(path.join(s.dir, 'local-artifact.bin'), 'b0')
  const res = await dctx.server.call('delete', { id: 'sess-with-artifacts', cwd: proj })
  assertCode(t, res, 200, null)
  t.assert.ok(exists(path.join(dctx.trash.root, 'sess-with-artifacts', 'local-artifact.bin')))
})
test('REAL delete F1: no cwd deletes at root', async (t) => {
  const s = dctx.newSession('', 'sess-no-cwd')
  const res = await dctx.server.call('delete', { id: 'sess-no-cwd' })
  assertCode(t, res, 200, null)
  t.assert.equal(exists(s.dir), false)
})
test('REAL delete F1: plain session leaves archive untouched', async (t) => {
  const s = dctx.newSession(proj, 'sess-plain')
  const beforeArchive = [...dctx.workspace.archived()]
  await dctx.server.call('delete', { id: 'sess-plain', cwd: proj })
  t.assert.deepEqual(dctx.workspace.archived(), beforeArchive)
})
test('REAL delete invalid ids -> 400 invalid-id', async (t) => {
  for (const id of ['', '.', '..', 'a/b', '../etc', 'a\\b', 'a\nb', 'a\tb', 'a\u0000b', 'a\rb']) {
    const res = await dctx.server.call('delete', { id })
    assertCode(t, res, 400, 'invalid-id')
  }
})
test('REAL delete non-string id -> 400 invalid-id', async (t) => {
  for (const id of [123, null, {}, ['x'], true]) {
    const res = await dctx.server.call('delete', { id })
    assertCode(t, res, 400, 'invalid-id')
  }
})
test('REAL delete Unicode/Chinese id valid', async (t) => {
  const id = '会话-中文-测试'
  const s = dctx.newSession(proj, id)
  const res = await dctx.server.call('delete', { id, cwd: proj })
  assertCode(t, res, 200, null)
  t.assert.equal(exists(s.dir), false)
  t.assert.ok(exists(path.join(dctx.trash.root, id)))
})
test('REAL delete cwd non-string -> 400 invalid-cwd', async (t) => {
  const res = await dctx.server.call('delete', { id: 'x', cwd: 42 })
  assertCode(t, res, 400, 'invalid-cwd')
})
test('REAL delete title non-string -> 400 invalid-title', async (t) => {
  const res = await dctx.server.call('delete', { id: 'x', title: 99 })
  assertCode(t, res, 400, 'invalid-title')
})
test('REAL delete title too long -> 400 invalid-title', async (t) => {
  const res = await dctx.server.call('delete', { id: 'x', title: 'a'.repeat(257) })
  assertCode(t, res, 400, 'invalid-title')
})
test('REAL delete title exactly 256 ok', async (t) => {
  dctx.newSession(proj, 'sess-title256')
  const res = await dctx.server.call('delete', { id: 'sess-title256', cwd: proj, title: 'a'.repeat(256) })
  assertCode(t, res, 200, null)
})
test('REAL delete missing body -> 400 bad-request', async (t) => {
  const res = await dctx.server.call('delete', undefined)
  assertCode(t, res, 400, 'bad-request')
})
test('REAL delete malformed JSON -> 400 bad-request, no move', async (t) => {
  const s = dctx.newSession(proj, 'sess-badjson')
  const res = await dctx.server.rawCall('delete', '{ id: "broken')
  assertCode(t, res, 400, 'bad-request')
  t.assert.ok(exists(s.dir))
})
test('REAL delete array/scalar body -> 400 bad-request', async (t) => {
  const s = dctx.newSession(proj, 'sess-badbody')
  for (const raw of ['[1,2,3]', '"plain-string"', '42']) {
    const res = await dctx.server.rawCall('delete', raw)
    assertCode(t, res, 400, 'bad-request')
  }
  t.assert.ok(exists(s.dir))
})
test('REAL delete missing source -> 200 session-dir-not-found', async (t) => {
  const res = await dctx.server.call('delete', { id: 'ghost-会话', cwd: proj })
  assertCode(t, res, 200, 'session-dir-not-found')
  t.assert.equal(exists(path.join(dctx.trash.root, 'ghost-会话')), false)
})
test('REAL delete empty cwd -> 200 session-dir-not-found', async (t) => {
  const res = await dctx.server.call('delete', { id: 'sess-x', cwd: '' })
  assertCode(t, res, 200, 'session-dir-not-found')
})
test('REAL delete running -> 200 session-running, host refuses', async (t) => {
  const s = dctx.newSession(proj, 'sess-running')
  dctx.live('sess-running')
  const res = await dctx.server.call('delete', { id: 'sess-running', cwd: proj })
  assertCode(t, res, 200, 'session-running')
  t.assert.ok(exists(s.dir))
  t.assert.equal(exists(path.join(dctx.trash.root, 'sess-running')), false)
})
test('REAL delete fence 403 -> no move', async (t) => {
  const s = dctx.newSession(proj, 'sess-forbidden')
  const res = await dctx.server.call('delete', { id: 'sess-forbidden', cwd: proj }, { host: 'not-local.tld' })
  assertCode(t, res, 403, null)
  t.assert.ok(exists(s.dir))
})
test('REAL delete escape char id -> 200 path-out-of-bounds', async (t) => {
  const id = 'a%2F..'
  const s = dctx.newSession(proj, id)
  const res = await dctx.server.call('delete', { id, cwd: proj })
  assertCode(t, res, 200, 'path-out-of-bounds')
  t.assert.ok(exists(s.dir))
})
test('REAL delete mapped-outside cwd -> 200 path-out-of-bounds', async (t) => {
  const outside = `${dctx.tmpRoot}/outside-place`
  dctx.projectCwdMap['/etc/yolo'] = outside
  const res = await dctx.server.call('delete', { id: 'sess-x', cwd: '/etc/yolo' })
  assertCode(t, res, 200, 'path-out-of-bounds')
  t.assert.equal(exists(path.join(dctx.trash.root, 'sess-x')), false)
})
test('REAL delete archived session (two-step) -> ok, id removed', async (t) => {
  const s = dctx.newSession(proj, 'sess-archived-del')
  dctx.workspace.setArchived(['sess-archived-del', 'keep-me'])
  const res = await dctx.server.call('delete', { id: 'sess-archived-del', cwd: proj })
  assertCode(t, res, 200, null)
  t.assert.equal(exists(s.dir), false)
  t.assert.ok(!dctx.workspace.archived().includes('sess-archived-del'))
  t.assert.ok(dctx.workspace.archived().includes('keep-me'))
})
test('REAL delete archived partial-failure -> system-error, file moved', async (t) => {
  const s = dctx.newSession(proj, 'sess-partial')
  dctx.workspace.setArchived(['sess-partial'])
  dctx.makeStorageWriteFail()
  const res = await dctx.server.call('delete', { id: 'sess-partial', cwd: proj })
  assertCode(t, res, 200, 'system-error')
  t.assert.equal(exists(s.dir), false)
  t.assert.ok(dctx.workspace.archived().includes('sess-partial'))
  dctx.cfg.state.storageWriteFail = false
})
test('REAL delete partial-failure retry -> ok, archive cleaned', async (t) => {
  const s = dctx.newSession(proj, 'sess-retry')
  dctx.workspace.setArchived(['sess-retry'])
  dctx.makeStorageWriteFail()
  await dctx.server.call('delete', { id: 'sess-retry', cwd: proj })
  dctx.cfg.state.storageWriteFail = false
  const res2 = await dctx.server.call('delete', { id: 'sess-retry', cwd: proj })
  assertCode(t, res2, 200, null)
  t.assert.equal(exists(s.dir), false)
  t.assert.ok(!dctx.workspace.archived().includes('sess-retry'))
})
test('REAL delete idempotent repeat deletes both ok', async (t) => {
  const s = dctx.newSession(proj, 'sess-idem')
  assertCode(t, await dctx.server.call('delete', { id: 'sess-idem', cwd: proj }), 200, null)
  assertCode(t, await dctx.server.call('delete', { id: 'sess-idem', cwd: proj }), 200, null)
  t.assert.equal(exists(s.dir), false)
})
test('REAL delete concurrent same archived id both ok, cleaned once', async (t) => {
  const s = dctx.newSession(proj, 'sess-conc')
  dctx.workspace.setArchived(['sess-conc'])
  const [a, b] = await Promise.all([
    dctx.server.call('delete', { id: 'sess-conc', cwd: proj }),
    dctx.server.call('delete', { id: 'sess-conc', cwd: proj }),
  ])
  t.assert.strictEqual(a.status, 200)
  t.assert.strictEqual(b.status, 200)
  t.assert.ok(a.json && a.json.ok === true)
  t.assert.ok(b.json && b.json.ok === true)
  t.assert.equal(exists(s.dir), false)
  t.assert.ok(!dctx.workspace.archived().includes('sess-conc'))
})
test('REAL delete Chinese/space dir names ok', async (t) => {
  for (const id of ['含空格 会话', '中文会话文件']) {
    const s = dctx.newSession(proj, id)
    const res = await dctx.server.call('delete', { id, cwd: proj })
    assertCode(t, res, 200, null)
    t.assert.equal(exists(s.dir), false)
  }
})
test('REAL delete long title ok', async (t) => {
  const s = dctx.newSession(proj, 'sess-longtitle')
  const res = await dctx.server.call('delete', { id: 'sess-longtitle', cwd: proj, title: '很长的标题 '.repeat(20) })
  assertCode(t, res, 200, null)
})

// ================= restore (10) =================
let rctx
before(async () => { rctx = await createRealTestContext() })
after(async () => { await rctx.server.close(); rctx.cleanup() })
const rproj = 'main'
async function deleteAndSetup(ctx, id, title) {
  const s = ctx.newSession(rproj, id)
  await ctx.server.call('delete', { id, cwd: rproj, title: title || `会话-${id}` })
  return s
}
test('REAL restore F1: moves dir back, clears trash', async (t) => {
  const s = await deleteAndSetup(rctx, 'sess-rev')
  const res = await rctx.server.call('restore', { id: 'sess-rev' })
  assertCode(t, res, 200, null)
  t.assert.ok(exists(s.dir))
  t.assert.ok(exists(path.join(s.dir, SESSION_MARKER)))
  t.assert.equal(exists(path.join(rctx.trash.root, 'sess-rev')), false)
})
test('REAL restore F1: trash listing updates after restore', async (t) => {
  const s = await deleteAndSetup(rctx, 'sess-trash-chk')
  const before = await rctx.server.call('trash')
  t.assert.ok(before.json.items.some((i) => i.id === 'sess-trash-chk'))
  await rctx.server.call('restore', { id: 'sess-trash-chk' })
  const after = await rctx.server.call('trash')
  t.assert.ok(!after.json.items.some((i) => i.id === 'sess-trash-chk'))
})
test('REAL restore invalid ids -> 400 invalid-id', async (t) => {
  for (const id of ['', 'a/b', '..', 'x\ny']) {
    const res = await rctx.server.call('restore', { id })
    assertCode(t, res, 400, 'invalid-id')
  }
  assertCode(t, await rctx.server.call('restore', { id: 5 }), 400, 'invalid-id')
})
test('REAL restore non-object body -> 400', async (t) => {
  assertCode(t, await rctx.server.rawCall('restore', '"x"'), 400, 'bad-request')
})
test('REAL restore no record -> not-in-trash', async (t) => {
  assertCode(t, await rctx.server.call('restore', { id: 'never-deleted' }), 200, 'not-in-trash')
})
test('REAL restore orphan dir no record -> not-in-trash, untouched', async (t) => {
  fs.mkdirSync(path.join(rctx.trash.root, 'orphan'), { recursive: true })
  const res = await rctx.server.call('restore', { id: 'orphan' })
  assertCode(t, res, 200, 'not-in-trash')
  t.assert.ok(exists(path.join(rctx.trash.root, 'orphan')))
})
test('REAL restore occupied target -> restore-target-exists, no overwrite', async (t) => {
  const s = await deleteAndSetup(rctx, 'sess-collide')
  const occupant = rctx.newSession(rproj, 'sess-collide', { content: 'NEW_SESSION\n' })
  const res = await rctx.server.call('restore', { id: 'sess-collide' })
  assertCode(t, res, 200, 'restore-target-exists')
  t.assert.ok(exists(path.join(rctx.trash.root, 'sess-collide')))
  t.assert.equal(fs.readFileSync(path.join(occupant.dir, SESSION_MARKER), 'utf8'), 'NEW_SESSION\n')
})
test('REAL restore idempotent (already restored) -> second not-in-trash', async (t) => {
  const s = await deleteAndSetup(rctx, 'sess-idem-rev')
  assertCode(t, await rctx.server.call('restore', { id: 'sess-idem-rev' }), 200, null)
  assertCode(t, await rctx.server.call('restore', { id: 'sess-idem-rev' }), 200, 'not-in-trash')
  t.assert.ok(exists(s.dir))
})
test('REAL restore concurrent same id -> exactly one ok', async (t) => {
  const s = await deleteAndSetup(rctx, 'sess-conc-rev')
  const [a, b] = await Promise.all([
    rctx.server.call('restore', { id: 'sess-conc-rev' }),
    rctx.server.call('restore', { id: 'sess-conc-rev' }),
  ])
  t.assert.strictEqual(a.status, 200)
  t.assert.strictEqual(b.status, 200)
  const okCount = [a, b].filter((r) => r.json && r.json.ok === true).length
  t.assert.equal(okCount, 1)
  t.assert.ok(exists(s.dir))
})
test('REAL restore trash item missing but record present -> system-error retryable', async (t) => {
  const s = await deleteAndSetup(rctx, 'sess-lost-trash')
  fs.rmSync(path.join(rctx.trash.root, 'sess-lost-trash'), { recursive: true, force: true })
  assertCode(t, await rctx.server.call('restore', { id: 'sess-lost-trash' }), 200, 'system-error')
  assertCode(t, await rctx.server.call('restore', { id: 'sess-lost-trash' }), 200, 'system-error')
})

// ================= emptyTrash (8) =================
let ectx
before(async () => { ectx = await createRealTestContext() })
after(async () => { await ectx.server.close(); ectx.cleanup() })
const eproj = 'w'
async function seed(ctx, idList) {
  for (const id of idList) {
    ctx.newSession(eproj, id)
    await ctx.server.call('delete', { id, cwd: eproj, title: id })
  }
}
test('REAL empty F1: empties all on confirm', async (t) => {
  await seed(ectx, ['t1', 't2', 't3'])
  const res = await ectx.server.call('emptyTrash', { confirm: true })
  assertCode(t, res, 200, null)
  for (const id of ['t1', 't2', 't3']) t.assert.equal(exists(path.join(ectx.trash.root, id)), false)
})
test('REAL empty: trash list empty after', async (t) => {
  const c = await createRealTestContext()
  try {
    await seed(c, ['e1'])
    await c.server.call('emptyTrash', { confirm: true })
    const list = await c.server.call('trash')
    t.assert.equal(list.json.items.length, 0)
  } finally { await c.server.close(); c.cleanup() }
})
test('REAL empty: no confirm -> 400 confirmation-required, nothing removed', async (t) => {
  const c = await createRealTestContext()
  try {
    await seed(c, ['safe1'])
    for (const body of [undefined, {}, { confirm: 'true' }, { confirm: 1 }]) {
      assertCode(t, await c.server.call('emptyTrash', body), 400, 'confirmation-required')
    }
    t.assert.ok(exists(path.join(c.trash.root, 'safe1')))
  } finally { await c.server.close(); c.cleanup() }
})
test('REAL empty: items still restorable after missing-confirm request', async (t) => {
  const c = await createRealTestContext()
  try {
    await seed(c, ['safe2'])
    await c.server.call('emptyTrash', {})
    const list = await c.server.call('trash')
    t.assert.ok(list.json.items.some((i) => i.id === 'safe2'))
    assertCode(t, await c.server.call('restore', { id: 'safe2' }), 200, null)
  } finally { await c.server.close(); c.cleanup() }
})
test('REAL empty: cross-site -> 403 before emptying', async (t) => {
  const c = await createRealTestContext()
  try {
    await seed(c, ['fence1'])
    const res = await c.server.call('emptyTrash', { confirm: true }, { 'sec-fetch-site': 'cross-site' })
    assertCode(t, res, 403, null)
    t.assert.ok(exists(path.join(c.trash.root, 'fence1')))
  } finally { await c.server.close(); c.cleanup() }
})
test('REAL empty: empty store -> ok', async (t) => {
  const c = await createRealTestContext()
  try { assertCode(t, await c.server.call('emptyTrash', { confirm: true }), 200, null) }
  finally { await c.server.close(); c.cleanup() }
})
test('REAL empty: repeat clean -> ok each time', async (t) => {
  const c = await createRealTestContext()
  try {
    await seed(c, ['idem-trash'])
    await c.server.call('emptyTrash', { confirm: true })
    assertCode(t, await c.server.call('emptyTrash', { confirm: true }), 200, null)
  } finally { await c.server.close(); c.cleanup() }
})
test('REAL empty: partial failure -> system-error, failed item kept', async (t) => {
  const c = await createRealTestContext()
  try {
    const [a, b] = [c.newSession(eproj, 'partA'), c.newSession(eproj, 'partB')]
    await c.server.call('delete', { id: 'partA', cwd: eproj, title: 'partA' })
    await c.server.call('delete', { id: 'partB', cwd: eproj, title: 'partB' })
    c.makeEmptyFail('partB')
    const res = await c.server.call('emptyTrash', { confirm: true })
    assertCode(t, res, 200, 'system-error')
    t.assert.equal(exists(path.join(c.trash.root, 'partA')), false)
    t.assert.ok(exists(path.join(c.trash.root, 'partB')))
  } finally { await c.server.close(); c.cleanup() }
})

// ================= trash (4) =================
let tctx
before(async () => { tctx = await createRealTestContext() })
after(async () => { await tctx.server.close(); tctx.cleanup() })
const tproj = 'x'
test('REAL trash F1: lists id+title+deadline, no originalDir', async (t) => {
  const s1 = tctx.newSession(tproj, 'a-session')
  tctx.newSession(tproj, 'b-session')
  await tctx.server.call('delete', { id: 'a-session', cwd: tproj, title: '会话A' })
  await tctx.server.call('delete', { id: 'b-session', cwd: tproj, title: '会话B' })
  const res = await tctx.server.call('trash')
  assertCode(t, res, 200, null)
  const items = res.json.items
  t.assert.equal(items.length, 2)
  const a = items.find((i) => i.id === 'a-session')
  t.assert.ok(a, 'has a-session')
  t.assert.equal(a.title, '会话A')
  t.assert.ok(typeof a.deadline === 'number')
  const serialized = JSON.stringify(res.json)
  t.assert.ok(!serialized.includes('originalDir'))
  t.assert.ok(!serialized.includes(tctx.tmpRoot))
  t.assert.equal(exists(s1.dir), false)
})
test('REAL trash: missing title listed without error', async (t) => {
  tctx.newSession(tproj, 'no-title')
  await tctx.server.call('delete', { id: 'no-title', cwd: tproj })
  const res = await tctx.server.call('trash')
  const item = res.json.items.find((i) => i.id === 'no-title')
  t.assert.ok(!(item && item.title && item.title.length > 0))
})
test('REAL trash: empty trash -> items:[]', async (t) => {
  const c = await createRealTestContext()
  try {
    const res = await c.server.call('trash')
    assertCode(t, res, 200, null)
    t.assert.deepEqual(res.json.items, [])
  } finally { await c.server.close(); c.cleanup() }
})
test('REAL trash: repeated reads stable', async (t) => {
  const r1 = await tctx.server.call('trash')
  const r2 = await tctx.server.call('trash')
  t.assert.deepEqual(r1.json.items, r2.json.items)
})

// ================= unarchive (8) =================
let uctx
before(async () => { uctx = await createRealTestContext({ archived: ['a1', 'a2', '中文归档'] }) })
after(async () => { await uctx.server.close(); uctx.cleanup() })
test('REAL unarchive F2: removes id, keeps others + fields', async (t) => {
  const res = await uctx.server.call('unarchive', { id: 'a1' })
  assertCode(t, res, 200, null)
  const arch = uctx.workspace.archived()
  t.assert.ok(!arch.includes('a1'))
  t.assert.ok(arch.includes('a2') && arch.includes('中文归档'))
  const g = uctx.workspace.read()
  t.assert.equal(g.initialized, true)
  t.assert.deepEqual(g.workspaceIds, ['main'])
})
test('REAL unarchive Chinese id ok', async (t) => {
  assertCode(t, await uctx.server.call('unarchive', { id: '中文归档' }), 200, null)
  t.assert.ok(!uctx.workspace.archived().includes('中文归档'))
})
test('REAL unarchive idempotent absent -> ok', async (t) => {
  assertCode(t, await uctx.server.call('unarchive', { id: 'never-archived' }), 200, null)
})
test('REAL unarchive repeat -> ok each time', async (t) => {
  assertCode(t, await uctx.server.call('unarchive', { id: 'a2' }), 200, null)
  assertCode(t, await uctx.server.call('unarchive', { id: 'a2' }), 200, null)
  t.assert.ok(!uctx.workspace.archived().includes('a2'))
})
test('REAL unarchive invalid ids -> 400 invalid-id', async (t) => {
  for (const id of ['', 'x/y', '..', 'a\nb', 7, null, ['x']]) {
    const res = await uctx.server.call('unarchive', { id })
    assertCode(t, res, 400, 'invalid-id')
  }
})
test('REAL unarchive non-object body -> 400', async (t) => {
  assertCode(t, await uctx.server.rawCall('unarchive', '"str"'), 400, 'bad-request')
})
test('REAL unarchive domain unavailable -> workspace-domain-unavailable, no change', async (t) => {
  const c = await createRealTestContext({ archived: ['na-1'] })
  try {
    const before = c.workspace.read()
    c.makeDomainUnavailable()
    const res = await c.server.call('unarchive', { id: 'na-1' })
    assertCode(t, res, 200, 'workspace-domain-unavailable')
    t.assert.ok(c.workspace.archived().includes('na-1'))
    t.assert.deepEqual(c.workspace.read(), before)
  } finally { await c.server.close(); c.cleanup() }
})
test('REAL unarchive write fail -> system-error, retry ok', async (t) => {
  const c = await createRealTestContext({ archived: ['wf-1'] })
  try {
    c.makeStorageWriteFail()
    const res = await c.server.call('unarchive', { id: 'wf-1' })
    assertCode(t, res, 200, 'system-error')
    t.assert.ok(c.workspace.archived().includes('wf-1'))
    c.cfg.state.storageWriteFail = false
    assertCode(t, await c.server.call('unarchive', { id: 'wf-1' }), 200, null)
    t.assert.ok(!c.workspace.archived().includes('wf-1'))
  } finally { await c.server.close(); c.cleanup() }
})
