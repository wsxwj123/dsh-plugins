// trash.unit.test.js — TrashStore primitives: move/restore/empty, metadata
// durability, and the partial-rm-failure seam.
import { test } from 'node:test'
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const { TrashStore, SESSION_MARKER, METADATA_DIR } = await import(path.join(ROOT, 'lib', 'trash.js'))

let seq = 0
function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), `dsh-sm-trash-${seq++}-`))
}

function makeSession(dir, id) {
  const p = path.join(dir, id)
  fs.mkdirSync(p, { recursive: true })
  fs.writeFileSync(path.join(p, SESSION_MARKER), 'LOG')
  return p
}

test('moveToTrash renames whole dir and writes a durable record', () => {
  const base = tmpdir()
  const src = path.join(base, 'src')
  const session = makeSession(src, 's1')
  const store = new TrashStore(path.join(base, 'trash'))
  store.moveToTrash(session, { id: 's1', originalDir: session, title: 'T', projectKey: 'src' })
  assert.strictEqual(fs.existsSync(session), false, 'source removed')
  assert.ok(fs.existsSync(path.join(store.root, 's1', SESSION_MARKER)), 'moved with marker')
  const rec = store.readRecord('s1')
  assert.ok(rec && rec.originalDir === session && rec.title === 'T')
  assert.ok(typeof rec.deletedAt === 'number')
  fs.rmSync(base, { recursive: true, force: true })
})

test('restoreItem moves back and removes the record', () => {
  const base = tmpdir()
  const src = path.join(base, 'src')
  const session = makeSession(src, 's1')
  const store = new TrashStore(path.join(base, 'trash'))
  store.moveToTrash(session, { id: 's1', originalDir: session, title: null, projectKey: 'src' })
  store.restoreItem(store.readRecord('s1'))
  assert.ok(fs.existsSync(path.join(session, SESSION_MARKER)))
  assert.strictEqual(store.hasRecord('s1'), false)
  assert.strictEqual(store.readRecord('s1'), null)
  fs.rmSync(base, { recursive: true, force: true })
})

test('empty removes all items and purges their records; empty store is fine', () => {
  const base = tmpdir()
  const src = path.join(base, 'src')
  const store = new TrashStore(path.join(base, 'trash'))
  store.moveToTrash(makeSession(src, 'a'), { id: 'a', originalDir: path.join(src, 'a'), title: null, projectKey: 'src' })
  store.moveToTrash(makeSession(src, 'b'), { id: 'b', originalDir: path.join(src, 'b'), title: null, projectKey: 'src' })
  const failed = store.empty()
  assert.deepStrictEqual(failed, [])
  assert.strictEqual(store.records().length, 0)
  assert.strictEqual(store.empty().length, 0, 'empty store idempotent')
  fs.rmSync(base, { recursive: true, force: true })
})

test('empty partial failure: removed items gone, failed item + record kept', () => {
  const base = tmpdir()
  const src = path.join(base, 'src')
  const store = new TrashStore(path.join(base, 'trash'), {
    rmItem(id, trashRoot) {
      if (id === 'partB') return false // simulated rm failure
      fs.rmSync(path.join(trashRoot, id), { recursive: true, force: true })
      return undefined
    },
  })
  store.moveToTrash(makeSession(src, 'partA'), { id: 'partA', originalDir: path.join(src, 'partA'), title: null, projectKey: 'src' })
  store.moveToTrash(makeSession(src, 'partB'), { id: 'partB', originalDir: path.join(src, 'partB'), title: null, projectKey: 'src' })
  const failed = store.empty()
  assert.deepStrictEqual(failed, ['partB'])
  assert.strictEqual(fs.existsSync(path.join(store.root, 'partA')), false)
  assert.ok(fs.existsSync(path.join(store.root, 'partB')), 'failed item still present')
  assert.ok(store.hasRecord('partB'), 'failed record kept (restorable)')
  assert.strictEqual(store.hasRecord('partA'), false)
  fs.rmSync(base, { recursive: true, force: true })
})

test('records() ignores non-json / corrupt metadata', () => {
  const base = tmpdir()
  const store = new TrashStore(path.join(base, 'trash'))
  fs.writeFileSync(path.join(store.root, METADATA_DIR, 'junk.txt'), 'x')
  fs.writeFileSync(path.join(store.root, METADATA_DIR, 'bad.json'), '{oops')
  assert.deepStrictEqual(store.records(), [])
  fs.rmSync(base, { recursive: true, force: true })
})
