import { mkdir, readFile, writeFile, stat } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = new URL('.', import.meta.url)
const id = 'dsh-theme-gallery'

/** 去除 ESM `export`/`export default` 前缀，使其可内联进 CJS factory。 */
function stripExports(source) {
  return source
    .replace(/^export\s+default\s+/gm, 'return ')
    .replace(/^export\s+/gm, '')
    .replace(/\bexport\s*\{[^}]*\}\s*$/gm, '')
}

const catalog = await readFile(new URL('./src/themes.curated.js', root), 'utf8')
// custom-theme.js 自包含轨道互斥 + 导入校验 + registry，作为独立模块内联。
const customTheme = stripExports(await readFile(new URL('./src/custom-theme.js', root), 'utf8'))
const source = await readFile(new URL('./src/client.js', root), 'utf8')

const output = `window.__ModuleLoader__.load({ id: ${JSON.stringify(id)}, factory: (require) => {\n  var module = { exports: {} }; var exports = module.exports;\n  const React = require('react');\n${catalog}\n// ---- custom theme registry / import / preview / apply / delete / restore ----\n${customTheme}\n// ---- plugin client ----\n${source}\n  module.exports = { apply };\n  return module.exports;\n} });\n`

await mkdir(new URL('./lib/', root), { recursive: true })
await writeFile(new URL('./lib/client.js', root), output)

if (process.argv.includes('--check')) {
  const generated = await readFile(new URL('./lib/client.js', root), 'utf8')
  if (!generated.includes('window.__ModuleLoader__.load')) throw new Error('client wrapper missing')
  if (!generated.includes('module.exports = { apply }')) throw new Error('client export missing')
  const size = (await stat(new URL('./lib/client.js', root))).size
  if (size >= 100 * 1024) throw new Error(`theme client.js 应 <100KB，实为 ${size}B`)
}

console.log(`built ${resolve(new URL('./lib/client.js', root).pathname)}`)
