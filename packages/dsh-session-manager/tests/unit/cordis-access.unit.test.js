// cordis-access.unit.test.js — simulate the cordis access model so "tests green"
// cannot hide a real startup crash (the dsh-pet-bridge lesson) or a missing
// service blocking plugin activation.
//
// Cordis semantics we model:
//   - core ctx properties (logger/on/emit/base/get/has/effect) resolve normally
//   - a service property NOT reachable through inject throws when bare-accessed
//     (reflect Proxy: "cannot get property \"X\" without inject")
//   - ctx.get('service') returns the service if provided, else undefined
//     (opt-in read, never throws)
//   - a service absent from the profile must NOT block plugin activation — the
//     plugin reads everything via ctx.get (empty inject), so activation never
//     waits on a service.
//
// We assert apply() reads services ONLY through ctx.get (never bare), applies
// the documented degradation when storageDomain/sessions/webServer are missing,
// and does not attach the /sm route unless a web server is present.
import { test } from 'node:test'
import assert from 'node:assert'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const plugin = await import(path.join(root, 'lib', 'index.js'))
const { createSmHandler } = await import(path.join(root, 'lib', 'handler.js'))
const { TrashStore } = await import(path.join(root, 'lib', 'trash.js'))

const CORE = new Set(['logger', 'on', 'emit', 'base', 'has', 'effect', 'get', 'plugin', 'set', 'provide'])

/**
 * A fake cordis ctx that enforces the access model. Services are ONLY readable
 * through ctx.get (returning a provided value or undefined); a bare-access to
 * any service property throws the exact cordis wording. This proves apply()
 * never relies on inject-bare access.
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
        if (CORE.has(prop)) return Reflect.get(target, prop, receiver)
        // Bare access to a service (any service) is the crash we must avoid.
        throw new Error(`cannot get property "${prop}" without inject`)
      },
      set(target, prop, value) { return Reflect.set(target, prop, value) },
    }),
    warnLog,
    notify(name) { return provided.get(name) },
  }
}

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-sm-cordis-'))
}
function roots() {
  const base = tmpdir()
  return { base, sessionsRoot: path.join(base, 'sessions'), trashRoot: path.join(base, 'trash') }
}

test('cordis model: bare service access throws; ctx.get absent -> undefined', () => {
  const { ctx } = makeCordisCtx()
  assert.throws(() => ctx.storageDomain, /cannot get property "storageDomain" without inject/)
  assert.throws(() => ctx.sessions, /cannot get property "sessions" without inject/)
  assert.strictEqual(ctx.get('storageDomain'), undefined)
  assert.strictEqual(ctx.get('sessions'), undefined)
  assert.strictEqual(ctx.get('webServer'), undefined)
})

test('apply with NO services present: activates (no throw, no hang) and logs degradation', () => {
  // This reproduces the e2e crash condition: headless profile lacking
  // storageDomain/sessions. apply must not throw and not stay pending — it
  // merely logs the degradation and skips route mounting.
  const { ctx, warnLog } = makeCordisCtx()
  const { base } = roots()
  const warnBefore = warnLog.length
  assert.doesNotThrow(() => {
    plugin.apply(ctx, { sessionsRoot: path.join(base, 'sessions'), trashRoot: path.join(base, 'trash') })
  })
  const degraded = warnLog.slice(warnBefore).join('\n')
  assert.match(degraded, /storageDomain service unavailable/)
  assert.match(degraded, /sessions service unavailable/)
  assert.match(degraded, /webServer service unavailable/)
  fs.rmSync(base, { recursive: true, force: true })
})

test('apply with storageDomain+sessions present but webServer absent: degrades route, no throw', () => {
  const { ctx, warnLog } = makeCordisCtx({
    services: {
      storageDomain: { get: () => null },
      sessions: { get: () => undefined },
    },
  })
  const { base } = roots()
  assert.doesNotThrow(() => {
    plugin.apply(ctx, { sessionsRoot: path.join(base, 'sessions'), trashRoot: path.join(base, 'trash') })
  })
  assert.ok(warnLog.some((m) => /webServer service unavailable/.test(String(m))))
  fs.rmSync(base, { recursive: true, force: true })
})

test('apply with all services present: mounts the /sm route via ctx.get webServer', () => {
  let registered = false
  const { ctx } = makeCordisCtx({
    services: {
      storageDomain: { get: () => null },
      sessions: { get: () => undefined },
      webServer: { register: () => { registered = true; return () => {} } },
    },
  })
  const { base } = roots()
  plugin.apply(ctx, { sessionsRoot: path.join(base, 'sessions'), trashRoot: path.join(base, 'trash') })
  assert.ok(registered, 'webServer.register called when the service is present')
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
    readArchived: () => ['na-1'],
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
  fs.mkdirSync(path.join(sessionsRoot, 'main'), { recursive: true })
  fs.mkdirSync(path.join(sessionsRoot, 'main', 's1'), { recursive: true })
  fs.writeFileSync(path.join(sessionsRoot, 'main', 's1', 'session.jsonl.zstd'), 'LOG')
  const handler = createSmHandler({
    sessionsRoot,
    trash: new TrashStore(path.join(base, 'trash')),
    // sessions NOT supplied — running guard skipped
    storageDomain: { get: () => null },
    readArchived: () => [],
    readWorkspaceGlobal: () => ({}),
    log: { warn: () => {} },
  })
  const res = handler.handle('delete', {}, { id: 's1', cwd: 'main' })
  assert.strictEqual(res.status, 200)
  assert.strictEqual(res.json.ok, true, 'delete proceeds when sessions service is absent')
  assert.strictEqual(fs.existsSync(path.join(sessionsRoot, 'main', 's1')), false, 'dir moved to trash')
  fs.rmSync(base, { recursive: true, force: true })
})

test('cordis model: empty inject list is exported (no hard activation dependency)', () => {
  assert.ok(Array.isArray(plugin.inject))
  assert.strictEqual(plugin.inject.length, 0, 'inject must be empty so no service blocks activation')
})
