// cordis-access.unit.test.js — simulate the cordis access model so "tests green"
// cannot hide a real startup crash (the dsh-pet-bridge lesson) or a missing
// service blocking plugin activation.
//
// Cordis semantics we model:
//   - core ctx properties (logger/on/emit/base/get/has/effect) resolve normally
//   - bare access to an INJECT-DECLARED service property resolves (red line #1:
//     inject declares the service, so bare access is legal) — mirrors the
//     aionui-panel pattern this plugin now follows
//   - bare access to a service NOT in inject throws ("cannot get property ...")
//   - ctx.get('service') returns the provided value or undefined (never throws)
//
// The plugin's `inject` is now `['webServer','storageDomain','sessions']`, so
// cordis BLOCKS activation until all three are present (they all exist in the
// web profile; a headless profile lacking one leaves the plugin `pending`,
// which is accepted — the plugin is only ever installed in the web profile).
// Therefore apply() reads services BARE (legal via inject) and, given a fully
// provided ctx, MUST mount the /sm route on ctx.webServer.
import { test } from 'node:test'
import assert from 'node:assert'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import { Readable } from 'node:stream'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const plugin = await import(path.join(root, 'lib', 'index.js'))
const { createSmHandler } = await import(path.join(root, 'lib', 'handler.js'))
const { TrashStore } = await import(path.join(root, 'lib', 'trash.js'))

const CORE = new Set(['logger', 'on', 'emit', 'base', 'has', 'effect', 'get', 'plugin', 'set', 'provide', 'root'])
/** Service names the plugin declares in `inject` — bare access is legal for these. */
const INJECTED = new Set(['webServer', 'storageDomain', 'sessions'])

/**
 * A fake cordis ctx that enforces the access model. Bare access to an
 * INJECTED service resolves; bare access to anything else throws the exact
 * cordis wording. ctx.get returns the provided value or undefined.
 */
function makeCordisCtx({ services = {} } = {}) {
  const provided = new Map(Object.entries(services))
  const warnLog = []
  const ctx = {
    logger: {
      info() {},
      warn(m) { warnLog.push(String(m)) },
      debug() {},
      error() {},
    },
    effect: (cb) => {
      if (typeof cb === 'function') cb()
      return () => {}
    },
    on() { return () => {} },
    emit() {},
    base: {},
    has(name) { return provided.has(name) },
    get(name) { return provided.get(name) },
  }
  return {
    ctx: new Proxy(ctx, {
      get(target, prop, receiver) {
        if (typeof prop !== 'string') return Reflect.get(target, prop, receiver)
        // core members + injected services resolve
        if (CORE.has(prop) || INJECTED.has(prop)) return Reflect.get(target, prop, receiver)
        throw new Error(`cannot get property "${prop}" without inject`)
      },
      set(target, prop, value) { return Reflect.set(target, prop, value) },
    }),
    warnLog,
    // Put the injected services onto the ctx object so bare access yields them.
    provide(services) {
      for (const [k, v] of Object.entries(services)) ctx[k] = v
    },
  }
}

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-sm-cordis-'))
}
function roots() {
  const base = tmpdir()
  return { base, sessionsRoot: path.join(base, 'sessions'), trashRoot: path.join(base, 'trash') }
}

test('cordis model: bare access to an UN-injected service throws; an injected one resolves', () => {
  const { ctx, provide } = makeCordisCtx()
  // Injected services never throw on bare access (they resolve to the value, or
  // undefined before provide). An UN-injected service always throws.
  assert.throws(() => ctx.unknownService, /cannot get property "unknownService" without inject/)
  assert.strictEqual(ctx.webServer, undefined, 'injected-but-not-yet-provided step resolves to undefined (no throw)')
  provide({ webServer: { register: () => () => {} } })
  assert.strictEqual(typeof ctx.webServer.register, 'function', 'injected service bare-access resolves after provide')
  assert.strictEqual(ctx.get('missing'), undefined, 'ctx.get absent -> undefined')
})

test('plugin inject declares exactly webServer/storageDomain/sessions (aionui-panel wiring)', () => {
  assert.ok(Array.isArray(plugin.inject))
  assert.deepStrictEqual([...plugin.inject], ['webServer', 'storageDomain', 'sessions'],
    'inject must declare the three services that are then bare-accessed')
})

test('apply with all three injected services: mounts the /sm route via bare ctx.webServer', () => {
  let registered = false
  const { ctx, provide } = makeCordisCtx()
  provide({
    storageDomain: { get: () => null },
    sessions: { get: () => undefined },
    webServer: { register: () => { registered = true; return () => {} } },
  })
  const { base } = roots()
  // apply must bare-access ctx.webServer (injected) and register the route.
  assert.doesNotThrow(() => {
    plugin.apply(ctx, { sessionsRoot: path.join(base, 'sessions'), trashRoot: path.join(base, 'trash') })
  })
  assert.ok(registered, 'ctx.webServer.register called (the /sm route mounts on a live profile)')
  fs.rmSync(base, { recursive: true, force: true })
})

test('apply with webServer absent (partial profile): degrades route mount, does not throw', () => {
  // Real cordis would keep this plugin `pending` and never call apply without
  // webServer; this test defends the internal guard, not the activation gate.
  const { ctx, provide, warnLog } = makeCordisCtx()
  provide({
    storageDomain: { get: () => null },
    sessions: { get: () => undefined },
    // webServer deliberately not provided
  })
  const { base } = roots()
  assert.doesNotThrow(() => {
    plugin.apply(ctx, { sessionsRoot: path.join(base, 'sessions'), trashRoot: path.join(base, 'trash') })
  })
  assert.ok(warnLog.some((m) => /webServer service unavailable/.test(String(m))))
  fs.rmSync(base, { recursive: true, force: true })
})

test('apply: trash root inside sessions root -> warns and refuses to mount (S-1 shared containment)', () => {
  // S-1: the startup guard reuses paths.isInsideOrEqual. A trash root under the
  // sessions root must refuse to enable the recycle bin (route NOT mounted) and
  // warn — the host session scan would otherwise re-discover moved sessions.
  const { ctx, provide, warnLog } = makeCordisCtx()
  let registered = false
  provide({
    storageDomain: { get: () => null },
    sessions: { get: () => undefined },
    webServer: { register: () => { registered = true; return () => {} } },
  })
  const base = tmpdir()
  const sessionsRoot = path.join(base, 'sessions')
  const trashRoot = path.join(sessionsRoot, 'sub', 'trash') // inside sessions root
  assert.doesNotThrow(() => {
    plugin.apply(ctx, { sessionsRoot, trashRoot })
  })
  assert.strictEqual(registered, false, 'route NOT mounted when trash root sits inside sessions root')
  assert.ok(warnLog.some((m) => /refusing to enable recycle bin/.test(String(m))))
  fs.rmSync(base, { recursive: true, force: true })
})

test('handler: storageDomain missing degrades unarchive to workspace-domain-unavailable', () => {
  const base = tmpdir()
  const sessionsRoot = path.join(base, 'sessions')
  fs.mkdirSync(sessionsRoot, { recursive: true })
  const handler = createSmHandler({
    sessionsRoot,
    trash: new TrashStore(path.join(base, 'trash')),
    sessions: { get: () => undefined },
    // storageDomain NOT supplied (undefined) — the missing-service degradation
    readWorkspaceGlobal: () => ({ archival: 'x' }),
    log: { warn: () => {} },
  })
  const res = handler.handle('unarchive', {}, { id: 'na-1' })
  assert.strictEqual(res.status, 200)
  assert.strictEqual(res.json.code, 'workspace-domain-unavailable')
  fs.rmSync(base, { recursive: true, force: true })
})

test('handler: sessions missing skips running guard and delete proceeds', () => {
  const base = tmpdir()
  const sessionsRoot = path.join(base, 'sessions')
  // Session lives on the real encoded DSH layout (projectKey(cwd) / encodeSegment(id)).
  const projectDir = path.join(sessionsRoot, '--main--')
  fs.mkdirSync(projectDir, { recursive: true })
  fs.mkdirSync(path.join(projectDir, 's1'), { recursive: true })
  fs.writeFileSync(path.join(projectDir, 's1', 'session.jsonl.zstd'), 'LOG')
  const handler = createSmHandler({
    sessionsRoot,
    trash: new TrashStore(path.join(base, 'trash')),
    // sessions NOT supplied — running guard skipped
    storageDomain: { get: () => null },
    readWorkspaceGlobal: () => ({}),
    log: { warn: () => {} },
  })
  const res = handler.handle('delete', {}, { id: 's1', cwd: 'main' })
  assert.strictEqual(res.status, 200)
  assert.strictEqual(res.json.ok, true, 'delete proceeds when sessions service is absent')
  assert.strictEqual(fs.existsSync(path.join(projectDir, 's1')), false, 'dir moved to trash')
  fs.rmSync(base, { recursive: true, force: true })
})

test('route: body stream interrupted mid-read -> structured 400, async handler never rejects (I-4)', async () => {
  // Capture the real /sm route mounted by apply(), then drive it with a request
  // whose body dies mid-stream (client abort). The async handler must resolve —
  // no unhandled rejection — and answer a structured 400.
  const { ctx, provide } = makeCordisCtx()
  let route = null
  provide({
    storageDomain: { get: () => null },
    sessions: { get: () => undefined },
    webServer: { register: (r) => { route = r; return () => {} } },
  })
  const { base } = roots()
  plugin.apply(ctx, { sessionsRoot: path.join(base, 'sessions'), trashRoot: path.join(base, 'trash') })
  assert.ok(route && route.path === '/sm' && route.kind === 'prefix', 'route captured')

  // A partial body followed by a transport-level destroy: the exact ECONNRESET
  // scenario the old bare `for await` turned into an unhandled rejection.
  const req = new Readable({ read() {} })
  req.headers = { host: '127.0.0.1:3080' } // loopback -> passes the trust fence
  req.url = '/sm/delete'
  req.push('{"id":"')
  req.destroy(new Error('ECONNRESET: socket hang up'))
  const res = {
    headersSent: false,
    statusCode: null,
    writeHead(code, headers) { this.headersSent = true; this.statusCode = code; this._headers = headers },
    end(body) { this._body = body },
  }
  await route.handler(req, res) // must RESOLVE, never reject
  assert.strictEqual(res.statusCode, 400, 'interrupted body answered with 400')
  const sent = JSON.parse(res._body)
  assert.strictEqual(sent.ok, false)
  assert.strictEqual(sent.code, 'bad-request')
  assert.ok(typeof sent.message === 'string' && sent.message.length > 0)
  fs.rmSync(base, { recursive: true, force: true })
})
