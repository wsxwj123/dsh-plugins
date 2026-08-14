// client-cordis-discipline.unit.test.js — encode the cordis access red line
// (AGENTS.md, from the dsh-pet-bridge crashes) as a static guard over the
// CLIENT half.
//
// The client apply is browser-only (DOM + react), so it cannot be executed in
// node. But its cordis access discipline IS statically decidable: every
// `ctx.<service>` the client touches must be either an injected service
// (declared in `export const inject`) or a core member (effective/logger/on/
// emit — safe to bare-access). This test reads the client sources and asserts
// that discipline, the client-side twin of tests/unit/cordis-access.unit.test.js
// for the node half.
//
// Callable-service rule (ctx.logger) is audited too: the client must never
// capture a callable service across an async callback — here we assert it
// never bare-reads ctx.logger at all (it uses console for diagnostics).
import { test } from 'node:test'
import assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const clientDir = path.join(root, 'src', 'client')
const indexSrc = fs.readFileSync(path.join(clientDir, 'index.tsx'), 'utf8')

/** Core cordis members that are safe to bare-access (effective on/emit/logger/get/...). */
const CORE_MEMBERS = new Set([
  'logger',
  'on',
  'emit',
  'base',
  'has',
  'get',
  'effect',
  'plugin',
  'set',
  'provide',
])

test('client inject declares exactly the services the code bare-accesses', () => {
  // Parse the inject declaration on the client entry.
  const m = /export\s+const\s+inject\s*=\s*\[([^\]]*)\]/.exec(indexSrc)
  assert.ok(m, 'client entry must export an inject array')
  const injected = m[1].split(',').map((s) => s.trim().replace(/['"]/g, '')).filter(Boolean)
  assert.deepStrictEqual(injected, ['sessions', 'workspaces', 'slots'],
    'client inject must list exactly sessions/workspaces/slots (PLAN §9.1)')

  // Collect every `ctx.<name>` bare access across the client source.
  const files = fs.readdirSync(clientDir)
  const accesses = []
  for (const f of files) {
    if (!/\.(ts|tsx)$/.test(f)) continue
    const src = fs.readFileSync(path.join(clientDir, f), 'utf8')
    // Match member accesses on `ctx.` (a bare property read). Exclude the
    // destructuring/parameter usage and type-position references (interface
    // `Context extends` etc.) which do not access a service at runtime.
    const re = /\bctx\s*\.\s*([A-Za-z_$][A-Za-z0-9_$]*)/g
    let g
    while ((g = re.exec(src)) !== null) accesses.push(g[1])
  }

  const unique = [...new Set(accesses)]
  // Every accessed member must be injected or a core member.
  const illegal = unique.filter((name) => !injected.includes(name) && !CORE_MEMBERS.has(name))
  assert.deepStrictEqual(illegal, [],
    `client bare-accesses services not declared in inject: ${illegal.join(', ')}`)
})

test('client never captures a callable service across an async callback (logger discipline)', () => {
  // The pet-bridge crash came from storing ctx.logger and calling it later.
  // The client must not bare-read ctx.logger at all (it uses console for UI
  // diagnostics). This guards the class of bug rather than one instance.
  const files = fs.readdirSync(clientDir)
  for (const f of files) {
    if (!/\.(ts|tsx)$/.test(f)) continue
    const src = fs.readFileSync(path.join(clientDir, f), 'utf8')
    assert.ok(!/ctx\s*\.\s*logger/.test(src),
      `client must not bare-access ctx.logger (callable across callbacks) in ${f}`)
  }
})

test('S-11: archive trash count re-reads with the park table and success clears the error', () => {
  // ArchiveView is a React component (browser-only), so we lock the S-11
  // discipline statically: the trash read must re-run when the pending-delete
  // table changes while the view is open (a fired delete grows the recycle
  // bin), and any read success must clear a previous error banner.
  const arc = fs.readFileSync(path.join(clientDir, 'ArchiveView.tsx'), 'utf8')
  assert.match(
    arc,
    /\[open,\s*pending\]/,
    'the trash read effect must depend on the park table while open (S-11)',
  )
  const countSet = arc.indexOf('setTrashCount(Array.isArray(res.items) ? res.items.length : 0)')
  const errorClear = arc.indexOf('setError(null)')
  assert.ok(countSet >= 0, 'the read-success branch must update the count')
  assert.ok(
    errorClear > countSet,
    'the read-success branch must clear any stale error banner (S-11)',
  )
})
