/**
 * Build driver for dsh-turn-scrubber — runs tsdown for both halves:
 *   lib/index.js   (node half, no-op stub)
 *   lib/client.js  (browser client bundle, __ModuleLoader__ factory)
 * The monorepo root runs this via `pnpm -r build`.
 */
import { rm } from 'node:fs/promises'
import { execSync } from 'node:child_process'

await rm('lib', { recursive: true, force: true })
execSync('./node_modules/.bin/tsdown', { stdio: 'inherit' })
