// handler.unit.test.js — core /sm handler behaviors against a real temp
// filesystem with injected stubs (strict, cordis-access-clean deps). Covers
// move/restore/empty idempotency, occupied-target refusal, invalid ids, the
// running-session guard, path boundaries, and archive write boundaries
// (unavailable domain / write failure / partial delete of an archived session).
import { test } from 'node:test'
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const { TrashStore } = await import(path.join(ROOT, 'lib', 'trash.js'))
const { createSmHandler } = await import(path.join(ROOT, 'lib', 'handler.js'))

const MARKER = 'session.jsonl.zstd'

let seq = 0
function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), `dsh-sm-unit-${seq++}-`))
}

/** Build a real handler bound to a fresh temp environment. */
function makeEnv(overrides = {}) {
  const base = tmpdir()
  const sessionsRoot = path.join(base, 'sessions')
  const trashRoot = path.join(base, 'trash')
  fs.mkdirSync(sessionsRoot, { recursive: true })

  const workspaceFile = path.join(base, 'workspace.json')
  const state = {
    liveIds: new Set(overrides.liveIds || []),
    domainUnavailable: overrides.domainUnavailable || false,
    storageWriteFail: overrides.storageWriteFail || false,
    archiveIds: [...(overrides.archiveIds || [])],
  }
  const writeWorkspace = () => {
    fs.writeFileSync(
      workspaceFile,
      JSON.stringify({ initialized: true, workspaceIds: ['main'], archivedSessionIds: state.archiveIds }),
    )
  }
  writeWorkspace()
  const readWorkspaceGlobal = () => {
    try {
      return JSON.parse(fs.readFileSync(workspaceFile, 'utf8'))
    } catch {
      return {}
    }
  }

  // storage-domain stub simulating cordis availability + write failure.
  const storageDomain = {
    get(name) {
      if (name !== 'workspace') return null
      if (state.domainUnavailable) return null
      return {
        global: {
          get: readWorkspaceGlobal,
          set(value) {
            if (state.storageWriteFail) throw new Error('storage write failed (simulated)')
            writeWorkspaceWith(value)
          },
        },
      }
    },
  }
  function writeWorkspaceWith(value) {
    if (value && Array.isArray(value.archivedSessionIds)) {
      state.archiveIds = [...value.archivedSessionIds]
      fs.writeFileSync(workspaceFile, JSON.stringify(value))
    }
  }

  const truncate = new TrashStore(trashRoot)
  const handler = createSmHandler({
    sessionsRoot,
    trash: truncate,
    sessions: { get: (id) => (state.liveIds.has(id) ? { id, running: true } : undefined) },
    storageDomain,
    readArchived: () => Array.from(state.archiveIds),
    readWorkspaceGlobal,
    log: { warn: () => {} },
  })

  const env = {
    base,
    sessionsRoot,
    truncate,
    state,
    handler,
    workspaceFile,
    archiveIds: () => Array.from(state.archiveIds),
    setArchived(ids) {
      state.archiveIds = [...ids]
      writeWorkspace()
    },
    live(id, on) {
      if (on === false) state.liveIds.delete(id)
      else state.liveIds.add(id)
    },
    newSession(project, id, content = 'DUMMY') {
      const dir = project ? path.join(sessionsRoot, project, id) : path.join(sessionsRoot, id)
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(path.join(dir, MARKER), content)
      return { dir, marker: path.join(dir, MARKER) }
    },
    cleanup() {
      fs.rmSync(base, { recursive: true, force: true })
    },
  }
  // Programmatic scoped handlers (no HTTP — direct dispatch, trusted).
  env.D = (body) => env.handler.handle('delete', {}, body)
  env.R = (body) => env.handler.handle('restore', {}, body)
  env.E = (body) => env.handler.handle('emptyTrash', {}, body)
  env.U = (body) => env.handler.handle('unarchive', {}, body)
  env.T = () => env.handler.handle('trash', {}, undefined)
  return env
}

test('delete: moves whole session dir into trash and wins 200 ok', () => {
  const env = makeEnv()
  const s = env.newSession('main', 's1')
  const res = env.D({ id: 's1', cwd: 'main', title: '会话1' })
  assert.strictEqual(res.status, 200)
  assert.strictEqual(res.json.ok, true)
  assert.strictEqual(fs.existsSync(s.dir), false)
  assert.ok(fs.existsSync(path.join(env.truncate.root, 's1', MARKER)))
  assert.ok(fs.existsSync(env.truncate.recordPath('s1')))
  env.cleanup()
})

test('delete: idempotent — second delete of an already-moved dir returns ok', () => {
  const env = makeEnv()
  env.newSession('main', 's1')
  assert.strictEqual(env.D({ id: 's1', cwd: 'main' }).json.ok, true)
  assert.strictEqual(env.D({ id: 's1', cwd: 'main' }).json.ok, true)
  env.cleanup()
})

test('delete: missing dir (not in trash) -> session-dir-not-found', () => {
  const env = makeEnv()
  const res = env.D({ id: 'ghost', cwd: 'main' })
  assert.strictEqual(res.json.ok, false)
  assert.strictEqual(res.json.code, 'session-dir-not-found')
  assert.strictEqual(fs.existsSync(path.join(env.truncate.root, 'ghost')), false)
  env.cleanup()
})

test('delete: running session refused (session-running), no move', () => {
  const env = makeEnv()
  const s = env.newSession('main', 'running')
  env.live('running')
  const res = env.D({ id: 'running', cwd: 'main' })
  assert.strictEqual(res.json.code, 'session-running')
  assert.ok(fs.existsSync(s.dir))
  env.cleanup()
})

test('delete: invalid ids -> 400 invalid-id', () => {
  const env = makeEnv()
  for (const id of ['', '.', '..', 'a/b', 'a\\b', 'a\nb', 'a\tb', 123, null, {}, [], true]) {
    const res = env.D({ id })
    assert.strictEqual(res.status, 400, `id=${JSON.stringify(id)}`)
    assert.strictEqual(res.json.code, 'invalid-id')
  }
  env.cleanup()
})

test('delete: % id -> path-out-of-bounds (passes id guard, fails segment gate)', () => {
  const env = makeEnv()
  env.newSession('main', 'a%2F..')
  const res = env.D({ id: 'a%2F..', cwd: 'main' })
  assert.strictEqual(res.status, 200)
  assert.strictEqual(res.json.code, 'path-out-of-bounds')
  env.cleanup()
})

test('delete: cwd resolving outside sessions root -> path-out-of-bounds, no move', () => {
  // Build an env with a projectDirOverride that maps a cwd outside the root.
  const env = makeEnv()
  const outside = path.join(env.base, 'outside')
  env.handler = createSmHandler({
    sessionsRoot: env.sessionsRoot,
    trash: env.truncate,
    sessions: { get: () => undefined },
    storageDomain: { get: () => null },
    readArchived: () => [],
    readWorkspaceGlobal: () => ({}),
    projectDirOverride: (cwd) => (cwd === '/etc/yolo' ? outside : undefined),
  })
  const res = env.handler.handle('delete', {}, { id: 'x', cwd: '/etc/yolo' })
  assert.strictEqual(res.status, 200)
  assert.strictEqual(res.json.code, 'path-out-of-bounds')
  assert.strictEqual(fs.existsSync(path.join(env.truncate.root, 'x')), false, 'no move on boundary rejection')
  env.cleanup()
})

test('delete: cwd of wrong type -> 400 invalid-cwd; empty cwd -> 200 session-dir-not-found', () => {
  const env = makeEnv()
  assert.strictEqual(env.D({ id: 'x', cwd: 42 }).code ?? env.D({ id: 'x', cwd: 42 }).json.code, 'invalid-cwd')
  assert.strictEqual(env.D({ id: 'x', cwd: '' }).json.code, 'session-dir-not-found')
  env.cleanup()
})

test('restore: moves back and clears the trash record', () => {
  const env = makeEnv()
  const s = env.newSession('main', 'r1')
  env.D({ id: 'r1', cwd: 'main' })
  const res = env.R({ id: 'r1' })
  assert.strictEqual(res.status, 200)
  assert.strictEqual(res.json.ok, true)
  assert.ok(fs.existsSync(s.dir))
  assert.ok(fs.existsSync(path.join(s.dir, MARKER)))
  assert.strictEqual(fs.existsSync(path.join(env.truncate.root, 'r1')), false)
  env.cleanup()
})

test('restore: not-in-trash when no record', () => {
  const env = makeEnv()
  const res = env.R({ id: 'never' })
  assert.strictEqual(res.json.code, 'not-in-trash')
  env.cleanup()
})

test('restore: target occupied -> restore-target-exists, never overwrite', () => {
  const env = makeEnv()
  const s = env.newSession('main', 'c1')
  env.D({ id: 'c1', cwd: 'main' })
  const occupant = env.newSession('main', 'c1', 'NEW_SESSION')
  const res = env.R({ id: 'c1' })
  assert.strictEqual(res.json.code, 'restore-target-exists')
  assert.strictEqual(fs.readFileSync(occupant.marker, 'utf8'), 'NEW_SESSION')
  assert.ok(fs.existsSync(path.join(env.truncate.root, 'c1')), 'trash entry kept')
  env.cleanup()
})

test('restore: trash item missing but record present -> system-error, retryable', () => {
  const env = makeEnv()
  env.newSession('main', 'lost')
  env.D({ id: 'lost', cwd: 'main' })
  fs.rmSync(path.join(env.truncate.root, 'lost'), { recursive: true, force: true })
  const res = env.R({ id: 'lost' })
  assert.strictEqual(res.json.code, 'system-error')
  const res2 = env.R({ id: 'lost' })
  assert.strictEqual(res2.json.code, 'system-error')
  env.cleanup()
})

test('emptyTrash: requires confirm:true else 400 confirmation-required, nothing deleted', () => {
  const env = makeEnv()
  env.newSession('main', 't1')
  env.D({ id: 't1', cwd: 'main' })
  for (const body of [undefined, {}, { confirm: 'true' }, { confirm: 1 }]) {
    const res = env.E(body)
    assert.strictEqual(res.status, 400, JSON.stringify(body))
    assert.strictEqual(res.json.code, 'confirmation-required')
  }
  assert.ok(fs.existsSync(path.join(env.truncate.root, 't1')))
  env.cleanup()
})

test('emptyTrash: empties all entries on confirm, empty store idempotent', () => {
  const env = makeEnv()
  env.newSession('main', 'e1')
  env.newSession('main', 'e2')
  env.D({ id: 'e1', cwd: 'main' })
  env.D({ id: 'e2', cwd: 'main' })
  assert.strictEqual(env.E({ confirm: true }).json.ok, true)
  assert.strictEqual(fs.existsSync(path.join(env.truncate.root, 'e1')), false)
  assert.strictEqual(fs.existsSync(path.join(env.truncate.root, 'e2')), false)
  assert.strictEqual(env.E({ confirm: true }).json.ok, true) // empty store -> ok
  env.cleanup()
})

test('delete archived session: file moved + archive id removed; keep others', () => {
  const env = makeEnv()
  const s = env.newSession('main', 'arc')
  env.setArchived(['arc', 'keep'])
  const res = env.D({ id: 'arc', cwd: 'main' })
  assert.strictEqual(res.json.ok, true)
  assert.strictEqual(fs.existsSync(s.dir), false)
  assert.deepStrictEqual(env.archiveIds().sort(), ['keep'])
  env.cleanup()
})

test('delete archived session partial-failure: file moved, archive not cleared, system-error', () => {
  const env = makeEnv()
  env.newSession('main', 'part')
  env.setArchived(['part'])
  env.state.storageWriteFail = true
  const res = env.D({ id: 'part', cwd: 'main' })
  assert.strictEqual(res.json.code, 'system-error')
  assert.strictEqual(fs.existsSync(path.join(env.sessionsRoot, 'main', 'part')), false, 'file moved')
  assert.ok(env.archiveIds().includes('part'), 'archive not cleared (middle state)')
  // retry completes step-2 and returns ok
  env.state.storageWriteFail = false
  const res2 = env.D({ id: 'part', cwd: 'main' })
  assert.strictEqual(res2.json.ok, true)
  assert.ok(!env.archiveIds().includes('part'))
  env.cleanup()
})

test('unarchive: removes id, preserves other fields, idempotent no-op', () => {
  const env = makeEnv()
  env.setArchived(['a1', 'a2'])
  const res = env.U({ id: 'a1' })
  assert.strictEqual(res.json.ok, true)
  assert.deepStrictEqual(env.archiveIds(), ['a2'])
  // idempotent: already absent -> ok
  assert.strictEqual(env.U({ id: 'a1' }).json.ok, true)
  const g = JSON.parse(fs.readFileSync(env.workspaceFile, 'utf8'))
  assert.strictEqual(g.initialized, true)
  assert.deepStrictEqual(g.workspaceIds, ['main'])
  env.cleanup()
})

test('unarchive: domain unavailable -> workspace-domain-unavailable, no state change', () => {
  const env = makeEnv()
  env.setArchived(['na'])
  const before = JSON.parse(fs.readFileSync(env.workspaceFile, 'utf8'))
  env.state.domainUnavailable = true
  const res = env.U({ id: 'na' })
  assert.strictEqual(res.json.code, 'workspace-domain-unavailable')
  assert.deepStrictEqual(env.archiveIds(), ['na'])
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(env.workspaceFile, 'utf8')), before)
  env.cleanup()
})

test('unarchive: write failure -> system-error, retry ok', () => {
  const env = makeEnv()
  env.setArchived(['wf'])
  env.state.storageWriteFail = true
  const res = env.U({ id: 'wf' })
  assert.strictEqual(res.json.code, 'system-error')
  assert.ok(env.archiveIds().includes('wf'))
  env.state.storageWriteFail = false
  assert.strictEqual(env.U({ id: 'wf' }).json.ok, true)
  assert.ok(!env.archiveIds().includes('wf'))
  env.cleanup()
})

test('trash: lists id/title/deadline, never originalDir', () => {
  const env = makeEnv()
  env.newSession('main', 'a')
  env.newSession('main', 'b')
  env.D({ id: 'a', cwd: 'main', title: 'A' })
  env.D({ id: 'b', cwd: 'main' })
  const res = env.T()
  assert.strictEqual(res.json.ok, true)
  const items = res.json.items
  assert.strictEqual(items.length, 2)
  const a = items.find((i) => i.id === 'a')
  assert.strictEqual(a.title, 'A')
  assert.ok(typeof a.deadline === 'number')
  assert.ok(!JSON.stringify(res.json).includes('originalDir'))
  env.cleanup()
})
