import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = new URL('.', import.meta.url)
const catalog = await readFile(new URL('./src/themes.curated.js', root), 'utf8')
const source = await readFile(new URL('./src/client.js', root), 'utf8')
const id = 'dsh-theme-gallery'
const output = `window.__ModuleLoader__.load({ id: ${JSON.stringify(id)}, factory: (require) => {\n  var module = { exports: {} }; var exports = module.exports;\n  const React = require('react');\n${catalog}\n${source}\n  module.exports = { apply };\n  return module.exports;\n} });\n`

await mkdir(new URL('./lib/', root), { recursive: true })
await writeFile(new URL('./lib/client.js', root), output)

if (process.argv.includes('--check')) {
  const generated = await readFile(new URL('./lib/client.js', root), 'utf8')
  if (!generated.includes('window.__ModuleLoader__.load')) throw new Error('client wrapper missing')
  if (!generated.includes('module.exports = { apply }')) throw new Error('client export missing')
}

console.log(`built ${resolve(new URL('./lib/client.js', root).pathname)}`)
