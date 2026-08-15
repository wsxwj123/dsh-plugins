// delete-controller-dispose.unit.test.js — lock review I-7 (dispose) at the
// source level. The injection controller is browser-only (DOM + react), so it
// cannot execute in node; exactly like client-cordis-discipline.unit.test.js we
// assert the discipline statically over the client sources: the controller's
// dispose must truly release the injected delete buttons and hover style (not
// be an empty stub), and the client effect cleanup must call it AFTER stopping
// the sync drivers (otherwise the removals would re-trigger sync() and
// re-inject the very buttons being disposed).
import { test } from 'node:test'
import assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const deleteBtn = fs.readFileSync(path.join(root, 'src', 'client', 'DeleteButton.tsx'), 'utf8')
const indexSrc = fs.readFileSync(path.join(root, 'src', 'client', 'index.tsx'), 'utf8')

test('I-7: DeleteButton dispose removes injected buttons + hover style + clears the map', () => {
  // Not the pre-fix empty stub.
  assert.ok(
    !/dispose\s*:\s*\(\s*\)\s*=>\s*\{\s*\}/.test(deleteBtn),
    'dispose must not be an empty implementation',
  )
  // Collects every injected button (even ones not in the rowById map).
  assert.ok(
    deleteBtn.includes("querySelectorAll(DELETE_BTN_SEL)") || deleteBtn.includes("querySelectorAll('[data-dsh-sm-delete]')"),
    'dispose must query the injected delete buttons',
  )
  // Targets the injected hover style by its stable id.
  assert.ok(
    deleteBtn.includes("'#dsh-session-manager-delete-hover'"),
    'dispose must target the injected hover style',
  )
  // Both removals actually remove nodes (not just select), and the map clears.
  assert.match(deleteBtn, /\.forEach\s*\(\s*\(?[A-Za-z_$][\w$]*\)?\s*=>\s*[A-Za-z_$][\w$]*\.remove\(\)/, 'dispose must remove the collected nodes')
  assert.ok(deleteBtn.includes('rowById.clear()'), 'dispose must drop the row map')
})

test('I-7: the client effect cleanup invokes controller.dispose() after stopping sync drivers', () => {
  const effectStart = indexSrc.indexOf('ctx.effect(() => () => {')
  assert.ok(effectStart >= 0, 'the client lifecycle effect must exist')
  const cleanup = indexSrc.slice(effectStart)
  assert.match(cleanup, /controller\.dispose\(\)/, 'cleanup must call controller.dispose()')
  const moIdx = cleanup.indexOf('mo.disconnect()')
  const disposeIdx = cleanup.indexOf('controller.dispose()')
  assert.ok(moIdx >= 0, 'cleanup must disconnect the MutationObserver')
  assert.ok(
    disposeIdx > moIdx,
    'dispose must run AFTER mo.disconnect(): button removal would otherwise re-trigger sync() and re-inject',
  )
  // The list subscription must also be off before dispose (no list-driven sync either).
  const offListIdx = cleanup.indexOf('offList()')
  assert.ok(offListIdx >= 0 && disposeIdx > offListIdx, 'dispose must run after offList()')
})

test('S-8: the MutationObserver callback is debounced, and cleanup cancels a pending debounce', () => {
  // The observer fires on EVERY body mutation; a full O(rows×sessions) re-scan
  // per mutation stalls on large lists. The callback must collapse mutations
  // into one trailing sync (named delay constant), and the client cleanup must
  // cancel a pending debounce so no stale sync runs after dispose.
  assert.match(
    indexSrc,
    /MutationObserver\(\(\)\s*=>\s*\{[\s\S]*?setTimeout/,
    'the observer callback must debounce via setTimeout (S-8)',
  )
  assert.ok(indexSrc.includes('MO_DEBOUNCE_MS'), 'the debounce delay must be a named constant (S-8)')
  assert.ok(/let\s+moTimer/.test(indexSrc), 'the debounce handle must be tracked for cleanup')
  const effectStart = indexSrc.indexOf('ctx.effect(() => () => {')
  assert.ok(effectStart >= 0, 'the client lifecycle effect must exist')
  const cleanup = indexSrc.slice(effectStart)
  assert.match(cleanup, /clearTimeout\(moTimer\)/, 'cleanup must cancel a pending debounce (S-8)')
  const clearIdx = cleanup.indexOf('clearTimeout(moTimer)')
  const moIdx = cleanup.indexOf('mo.disconnect()')
  assert.ok(clearIdx >= 0 && moIdx >= 0, 'cleanup must clear the timer and disconnect the observer')
})
