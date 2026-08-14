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

test('readRecord: corrupt record -> null AND a warn trace is left (S-6)', () => {
  // S-6: a broken record silently hid the item from /sm/trash and made restore
  // report not-in-trash. It must still read as missing, but the corruption must
  // be visible in the log so the operator can find the broken file.
  const base = tmpdir()
  const warns = []
  const store = new TrashStore(path.join(base, 'trash'), { log: { warn: (m) => warns.push(String(m)) } })
  fs.writeFileSync(store.recordPath('c1'), '{oops') // half-written / corrupt JSON
  assert.strictEqual(store.readRecord('c1'), null, 'corrupt record reads as missing')
  assert.strictEqual(store.readRecord('missing'), null, 'absent record reads as missing too')
  assert.strictEqual(warns.length, 1, 'exactly the corrupt read warns')
  assert.ok(/c1/.test(warns[0]) && /corrupt/.test(warns[0]), 'warn names the corrupt record')
  fs.rmSync(base, { recursive: true, force: true })
})

test('writeRecord is atomic (temp + rename): valid round-trip, no .tmp residue (S-6)', () => {
  // S-6: the record write must go through a same-dir temp file + rename so a
  // crash can never leave a half-written record.json. Observable contract: the
  // final file is complete/valid and no temp file is left behind.
  const base = tmpdir()
  const store = new TrashStore(path.join(base, 'trash'))
  store.writeRecord({ id: 'a1', originalDir: '/x/a1', title: 'T', projectKey: 'p', deletedAt: 42 })
  const rec = store.readRecord('a1')
  assert.ok(rec && rec.originalDir === '/x/a1' && rec.title === 'T' && rec.deletedAt === 42, 'round-trip intact')
  assert.strictEqual(fs.existsSync(`${store.recordPath('a1')}.tmp`), false, 'no temp residue after write')
  // Overwriting an existing record must also be atomic and clean.
  store.writeRecord({ id: 'a1', originalDir: '/x/a1', title: 'T2', projectKey: 'p', deletedAt: 43 })
  assert.strictEqual(store.readRecord('a1').title, 'T2')
  assert.strictEqual(fs.existsSync(`${store.recordPath('a1')}.tmp`), false)
  fs.rmSync(base, { recursive: true, force: true })
})

test('moveToTrash: rename failure rolls the record back — no orphan, no dangling record', () => {
  // I-2: the record is the commit point. If the rename fails after the record
  // write, the record must be rolled back so system-error still means "host
  // changed nothing" — never a moved-but-unrecorded orphan.
  const base = tmpdir()
  const src = path.join(base, 'src')
  const session = makeSession(src, 's1')
  const store = new TrashStore(path.join(base, 'trash'))
  // Occupy the trash destination with a non-empty dir so renameSync fails
  // (ENOTEMPTY — rename never overwrites a non-empty target).
  const occupied = path.join(store.root, 's1')
  fs.mkdirSync(path.join(occupied, 'blk'), { recursive: true })
  fs.writeFileSync(path.join(occupied, 'blk', 'x'), '1')
  assert.throws(() => store.moveToTrash(session, { id: 's1', originalDir: session, title: 'T', projectKey: 'src' }))
  assert.strictEqual(store.hasRecord('s1'), false, 'record rolled back')
  assert.ok(fs.existsSync(path.join(session, SESSION_MARKER)), 'source dir untouched')
  fs.rmSync(base, { recursive: true, force: true })
})

test('moveToTrash: record-first ordering — crash window (record without move) is self-healing', () => {
  // I-2: a crash between the record write and the rename leaves a record whose
  // dir is still in place. That state must be self-healing: a re-delete
  // overwrites the record and completes the move; a restore refuses with
  // restore-target-exists (dir occupied) rather than clobbering.
  const base = tmpdir()
  const src = path.join(base, 'src')
  const session = makeSession(src, 's1')
  const store = new TrashStore(path.join(base, 'trash'))
  // Simulate the crash window: record written, rename never happened.
  store.writeRecord({ id: 's1', originalDir: session, title: 'OLD', projectKey: 'src', deletedAt: 111 })
  assert.ok(store.hasRecord('s1'))
  assert.ok(fs.existsSync(session), 'dir still in place during the window')
  // Re-delete overwrites the stale record and completes the move.
  store.moveToTrash(session, { id: 's1', originalDir: session, title: 'NEW', projectKey: 'src' })
  assert.ok(store.hasItem('s1'), 'item moved')
  assert.strictEqual(fs.existsSync(session), false)
  const rec = store.readRecord('s1')
  assert.strictEqual(rec.title, 'NEW', 'stale record overwritten (self-healed)')
  assert.ok(rec.deletedAt > 111, 'fresh timestamp')
  fs.rmSync(base, { recursive: true, force: true })
})

test('restoreItem: record-removal failure degrades — restore still succeeds, no throw', () => {
  // I-2: the restore rename is the committed truth; a failure to remove the
  // record afterwards must not surface as a system-error on a successful
  // restore (and must not orphan anything — the item is safely back).
  const base = tmpdir()
  const src = path.join(base, 'src')
  const session = makeSession(src, 's1')
  const store = new TrashStore(path.join(base, 'trash'))
  store.moveToTrash(session, { id: 's1', originalDir: session, title: null, projectKey: 'src' })
  const rec = store.readRecord('s1') // capture BEFORE breaking the record path
  // Make deleteRecord fail: replace the record file with a non-empty directory
  // (rmSync without recursive refuses directories).
  const recPath = store.recordPath('s1')
  fs.rmSync(recPath, { force: true })
  fs.mkdirSync(path.join(recPath, 'blk'), { recursive: true })
  fs.writeFileSync(path.join(recPath, 'blk', 'x'), '1')
  assert.doesNotThrow(() => store.restoreItem(rec))
  assert.ok(fs.existsSync(path.join(session, SESSION_MARKER)), 'item restored despite record-cleanup failure')
  fs.rmSync(base, { recursive: true, force: true })
})
