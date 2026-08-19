/**
 * Shared harness for the REVIEW-BLIND-20260817 reproduction suite.
 *
 * Run: node --test "tests/regression/*.test.mjs"   (glob, never a bare dir —
 * `node --test tests/regression` treats the dir as a module → MODULE_NOT_FOUND)
 *
 * Why these tests import `src/*.ts` and not `lib/*.js` like tests/unit:
 *   the package has no installed node_modules in this working tree, so `npm run
 *   build` (tsdown) cannot produce lib/. Node strips TypeScript types natively;
 *   the only gap is that the sources import siblings with a `.js` extension
 *   (`./trash.js` → `./trash.ts`), which the resolve hook below bridges. Bonus:
 *   the suite always tests the CURRENT source, never a stale build artifact
 *   (the trap recorded in LEARNINGS.md).
 *
 * The stubs here deliberately model the REAL DSH runtime, not the convenient
 * fiction the existing unit tests use (that fiction is why F1/H2 were invisible):
 *   - `domain.global.set(v)` returns a Promise (dsh-storage-domain
 *     lib/types/domain.d.ts:28); it is queued on ONE per-domain chain, the
 *     in-memory value is replaced only AFTER the durable write resolves
 *     (lib/index.js:151-161), and a closing domain rejects immediately
 *     (`enqueue` → `Promise.reject(DomainError('closed'))`).
 *   - `domain.global.get()` throws once the domain is closed (assertReadable).
 */
import { registerHooks } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

// ---- TypeScript source loading -------------------------------------------------
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && specifier.endsWith('.js') && context.parentURL?.endsWith('.ts')) {
      const asTs = `${specifier.slice(0, -3)}.ts`
      if (fs.existsSync(fileURLToPath(new URL(asTs, context.parentURL)))) return nextResolve(asTs, context)
    }
    return nextResolve(specifier, context)
  },
})

/** Import a package-relative source module, e.g. `loadSrc('src/handler.ts')`. */
export function loadSrc(relative) {
  return import(path.join(PKG_ROOT, relative))
}

/** Read a package-relative file as text (for the static / config assertions). */
export function readPkgFile(relative) {
  return fs.readFileSync(path.join(PKG_ROOT, relative), 'utf8')
}

// ---- filesystem helpers --------------------------------------------------------
let seq = 0
/** A fresh temp dir. Callers clean up in their own test (no shared state). */
export function tmpdir(tag = 'reg') {
  return fs.mkdtempSync(path.join(os.tmpdir(), `dsh-sm-${tag}-${seq++}-`))
}

export function rmrf(dir) {
  fs.rmSync(dir, { recursive: true, force: true })
}

/** One macrotask, so a queued "durable write" can land. */
export function tick() {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

// ---- workspace storage-domain stub (the REAL async contract) -------------------
/**
 * @param opts.archivedSessionIds - initial archive set.
 * @param opts.failWrite - the durable write rejects (disk full / EACCES).
 * @param opts.disposing - `close()` has STARTED (DomainImpl.disposing): `get`
 *   still works, but `enqueue` rejects every new write immediately.
 * @param opts.closed - teardown finished: `get` throws too (assertReadable).
 * @returns { domain, readGlobal, current, setPayloads, writeHandlerAttached }
 */
export function makeWorkspaceDomain(opts = {}) {
  const initial = {
    initialized: true,
    workspaceIds: ['main'],
    archivedSessionIds: [...(opts.archivedSessionIds ?? [])],
  }
  /** The domain's in-memory value — replaced ONLY after a durable write lands. */
  let memory = initial
  let chain = Promise.resolve()
  const setPayloads = []
  /** True once the caller attached a handler (`await`/`.then`/`.catch`) to a
   *  returned write promise. A floating promise here is what kills the real host
   *  (dsh-app-boot installs a process-level unhandledRejection → exit(1)). */
  let writeHandlerAttached = false

  const set = (value) => {
    setPayloads.push(value)
    if (opts.closed === true || opts.disposing === true) {
      return track(Promise.reject(new Error("domain 'workspace' is closed")))
    }
    // enqueue(): the job starts on the shared chain immediately, whether or not
    // the caller keeps the returned promise.
    const job = chain.then(async () => {
      await tick() // the durable write (unit.setGlobal)
      if (opts.failWrite === true) throw new Error('storage write failed (simulated ENOSPC)')
      memory = value // in-memory value updates AFTER durability
    })
    chain = job.then(noop, noop)
    return track(job)
  }

  /** Wrap so an un-awaited rejection cannot abort the test process, while still
   *  recording whether the production code attached a handler at all. */
  function track(promise) {
    promise.catch(noop) // test-process safety net; the real runtime has none
    return {
      then(onFulfilled, onRejected) {
        writeHandlerAttached = true
        return promise.then(onFulfilled, onRejected)
      },
      catch(onRejected) {
        writeHandlerAttached = true
        return promise.catch(onRejected)
      },
      finally(onFinally) {
        writeHandlerAttached = true
        return promise.finally(onFinally)
      },
    }
  }

  const get = () => {
    if (opts.closed === true) throw new Error("domain 'workspace' is closed")
    return memory
  }

  return {
    /** What `storageDomain.get('workspace')` yields. */
    domain: { global: { get, set } },
    /** The `readWorkspaceGlobal` dep, mirroring src/index.ts readGlobal(). */
    readGlobal: () => {
      try {
        const v = get()
        return v && typeof v === 'object' ? v : {}
      } catch {
        return undefined
      }
    },
    /** Current archive set as the domain would report it right now. */
    current: () => [...(memory.archivedSessionIds ?? [])],
    /** Whole current global (to prove initialized/workspaceIds are preserved). */
    currentGlobal: () => memory,
    setPayloads,
    writeHandlerAttached: () => writeHandlerAttached,
  }
}

function noop() {}

// ---- cordis ctx + route driver (for the src/index.ts level items) --------------
/** Minimal cordis ctx: the three injected services + logger + effect. */
export function makeCtx(services = {}) {
  const warnings = []
  const routes = []
  const ctx = {
    logger: { info: noop, debug: noop, error: noop, warn: (m) => warnings.push(String(m)) },
    effect: (cb) => {
      if (typeof cb === 'function') cb()
      return () => {}
    },
    on: () => () => {},
    emit: noop,
    base: {},
    has: () => false,
    get: () => undefined,
    storageDomain: services.storageDomain ?? { get: () => null },
    sessions: services.sessions ?? { get: () => undefined },
    webServer:
      services.webServer ??
      {
        register: (route) => {
          routes.push(route)
          return noop
        },
      },
  }
  return { ctx, warnings, routes }
}

/**
 * POST a JSON body through a registered raw `/sm/*` route handler.
 * @returns { status, json, raw }
 */
export async function postRoute(route, method, body) {
  const payload = body === undefined ? '' : JSON.stringify(body)
  const req = {
    method: 'POST',
    url: `/sm/${method}`,
    headers: { host: '127.0.0.1:3000', 'content-length': String(Buffer.byteLength(payload)) },
    async *[Symbol.asyncIterator]() {
      if (payload.length > 0) yield Buffer.from(payload)
    },
  }
  let status = 0
  let raw = ''
  let headersSent = false
  const res = {
    get headersSent() {
      return headersSent
    },
    writeHead(code) {
      status = code
      headersSent = true
    },
    end(chunk) {
      if (chunk !== undefined) raw += String(chunk)
    },
  }
  await route.handler(req, res)
  let json
  try {
    json = JSON.parse(raw)
  } catch {
    json = undefined
  }
  return { status, json, raw }
}
