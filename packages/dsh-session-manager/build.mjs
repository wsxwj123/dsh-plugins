/**
 * Build driver for dsh-session-manager — runs tsdown (esm node half) to
 * produce lib/{index,handler,trash,paths}.js. The node half depends only on
 * node builtins + injected cordis services, so there is no browser bundle to
 * produce until the client half is implemented.
 */
import { rm } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Resolve from this file regardless of cwd.
const HERE = fileURLToPath(new URL('.', import.meta.url))
process.chdir(HERE)

await rm('lib', { recursive: true, force: true })
// tsdown's bin (package.json "bin": { "tsdown": "./dist/run.mjs" }) is a plain
// node ESM script — run it DIRECTLY with the current node instead of resolving
// the node_modules/.bin shim through a shell (S-7). The old `shell: '/bin/sh'`
// hard-coded POSIX and broke `npm run build` on Windows: /bin/sh does not
// exist there, and the .bin shim is a POSIX shell script that cmd cannot run.
// execFileSync(process.execPath, entry) needs no shell at all, so it works
// identically on POSIX and Windows.
const require = createRequire(import.meta.url)
const pkgJson = require.resolve('tsdown/package.json')
const tsdownEntry = join(dirname(pkgJson), 'dist', 'run.mjs')
execFileSync(process.execPath, [tsdownEntry], { stdio: 'inherit' })
