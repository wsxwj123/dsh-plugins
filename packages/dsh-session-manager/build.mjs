/**
 * Build driver for dsh-session-manager — runs tsdown (esm node half) to
 * produce lib/{index,handler,trash,paths}.js. The node half depends only on
 * node builtins + injected cordis services, so there is no browser bundle to
 * produce until the client half is implemented.
 */
import { rm } from 'node:fs/promises'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// Resolve from this file regardless of cwd.
const HERE = fileURLToPath(new URL('.', import.meta.url))
process.chdir(HERE)

await rm('lib', { recursive: true, force: true })
// tsdown's .bin shim is a POSIX shell script (not a node CLI), so execSync's
// default /bin/sh invocation is what resolves it — do NOT prefix with `node`.
execSync('node_modules/.bin/tsdown', { stdio: 'inherit', shell: '/bin/sh' })
