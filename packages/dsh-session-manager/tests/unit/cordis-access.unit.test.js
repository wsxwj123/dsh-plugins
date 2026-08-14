// cordis-access.unit.test.js — simulate the cordis access model so "tests green"
// cannot hide a real startup crash (the dsh-pet-bridge lesson).
//
// Cordis semantics we model:
//   - core ctx properties (logger/on/emit/base/get/has/effect) resolve normally
//   - a service property NOT declared in `inject` THROWS when bare-accessed
//     (reflect Proxy: "cannot get property \"X\" without inject")
//   - ctx.get('service') returns the service if provided, else undefined
//     (opt-in read, never throws)
//
// We assert that our node-half `apply` (and the handler wiring it builds) only
// reads core members + the three injected services + ctx.get('webServer'), and
// that it does NOT bare-access webServer or any other un-injected service.
import { test } from 'node:test'
import assert from 'node:assert'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const plugin = await import(path.join(root, 'lib', 'index.js'))
const { createSmHandler } = await import(path.join(root, 'lib', 'handler.js'))

// The list of service names our plugin is ALLOWED to bare-access (via inject).
// Anything else must go through ctx.get (or be absent).
const INJECTED = new Set(['connection', 'storageDomain', 'sessions'])
// Services our plugin OPTIONALLY reads via ctx.get.
const OPTIONAL = new Set(['webServer'])

/**
 * A fake cordis ctx that enforces the access model. Bare access to any
 * property that is not (a) a core member or (b) in INJECTED throws the exact
 * cordis wording. ctx.get returns provided services or undefined.
 */
function makeCordisCtx({ withWebServer = true } = {}) {
  const provided = new Map()
  if (withWebServer) provided.set('webServer', { register: () => () => {} })

  const CORE = new Set(['logger', 'on', 'emit', 'base', 'has', 'effect', 'get', 'plugin', 'set', 'provide'])

  const ctx = {
    // injected services resolve here
    sessions: { get: () => undefined },
    storageDomain: { get: () => null },
    connection: {},

    logger: { info() {}, warn() {}, debug() {}, error() {} },
    effect: (cb) => {
      if (typeof cb === 'function') cb()
      return () => {}
    },
    on() { return () => {} },
    emit() {},
    base: {},
    has(name) { return provided.has(name) || INJECTED.has(name) },
    get(name) { return provided.get(name) },
  }

  return new Proxy(ctx, {
    get(target, prop, receiver) {
      if (typeof prop !== 'string') return Reflect.get(target, prop, receiver)
      // core members + injected services resolve
      if (CORE.has(prop) || INJECTED.has(prop)) {
        return Reflect.get(target, prop, receiver)
      }
      // a service NOT injected, bare-accessed -> the exact crash
      if (!OPTIONAL.has(prop)) {
        throw new Error(`cannot get property "${prop}" without inject`)
      }
      // optional (webServer etc.): bare access is NOT allowed by us either,
      // but physical access should be fenced; here we throw to prove we never
      // even try a bare access.
      throw new Error(`cannot get property "${prop}" without inject`)
    },
    set(target, prop, value) { return Reflect.set(target, prop, value) },
  })
}

test('cordis model: bare access to an un-injected service property throws', () => {
  const ctx = makeCordisCtx()
  assert.throws(() => ctx.webServer, /cannot get property "webServer" without inject/)
  assert.throws(() => ctx.workspaces, /cannot get property "workspaces" without inject/)
})

test('cordis model: ctx.get returns undefined for an absent optional service', () => {
  const ctx = makeCordisCtx({ withWebServer: false })
  assert.strictEqual(ctx.get('webServer'), undefined)
})

test('node-half apply resolves all core + injected services; does not bare-access webServer', () => {
  // The Proxy above throws on ANY bare access of webServer/others; apply must
  // never hit that path, proving we read it only via ctx.get.
  const ctx = makeCordisCtx({ withWebServer: false }) // webServer absent -> apply should degrade, not crash
  // Point the session/trash roots somewhere harmless (they may be created).
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-sm-cordis-'))
  assert.doesNotThrow(() => {
    plugin.apply(ctx, { sessionsRoot: path.join(tmp, 'sessions'), trashRoot: path.join(tmp, 'trash') })
  })
  fs.rmSync(tmp, { recursive: true, force: true })
})

test('node-half apply mounts the /sm route through ctx.get webServer when available', () => {
  let registered = false
  const webServer = {
    register: () => {
      registered = true
      return () => {}
    },
  }
  const provided = new Map([['webServer', webServer]])
  const CORE = new Set(['logger', 'on', 'emit', 'base', 'has', 'effect', 'get', 'plugin', 'set', 'provide'])
  const INJECTED2 = new Set(['connection', 'storageDomain', 'sessions'])
  const ctx = new Proxy(
    {
      sessions: { get: () => undefined },
      storageDomain: { get: () => null },
      connection: {},
      logger: { info() {}, warn() {}, debug() {}, error() {} },
      effect: (cb) => { if (typeof cb === 'function') cb(); return () => {} },
      get(name) { return provided.get(name) },
    },
    {
      get(target, prop, receiver) {
        if (typeof prop !== 'string') return Reflect.get(target, prop, receiver)
        if (CORE.has(prop) || INJECTED2.has(prop)) return Reflect.get(target, prop, receiver)
        throw new Error(`cannot get property "${prop}" without inject`)
      },
    },
  )
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-sm-cordis2-'))
  plugin.apply(ctx, { sessionsRoot: path.join(tmp, 'sessions'), trashRoot: path.join(tmp, 'trash') })
  assert.ok(registered, 'apply should register the /sm route via ctx.get("webServer")')
  fs.rmSync(tmp, { recursive: true, force: true })
})
