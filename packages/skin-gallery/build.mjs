import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = new URL('.', import.meta.url)
const id = 'dsh-skin-gallery'
// 皮肤目录（构建时从磁盘扫描；这些是只读资产副本，构建脚本只搬运、不重写）
const skinOrder = ['qq98', 'ths', 'xp', 'blue-fantasy', 'dragon-heir', 'minecraft', 'whale-song', 'trading', 'miku']

/** 读取某皮肤的 skin.json 并归一化为 manifest 条目。 */
async function buildManifest() {
  const entries = []
  for (const skinId of skinOrder) {
    const meta = JSON.parse(await readFile(new URL(`./skins/${skinId}/skin.json`, root), 'utf8'))
    if (meta.id !== skinId) throw new Error(`skin.json id mismatch: expected ${skinId}, got ${meta.id}`)
    entries.push({
      id: meta.id,
      name: meta.name,
      nameEn: meta.nameEn,
      author: meta.author,
      tagline: meta.tagline,
      accent: meta.accent,
      bodyAttr: meta.bodyAttr,
      order: meta.order,
      package: meta.package,
      bundleFile: `skins/${skinId}/client.js`,
      a11yFile: `skins/${skinId}/a11y.css`,
      license: 'BSD-3-Clause',
    })
  }
  return entries.sort((a, b) => a.order - b.order)
}

/** 采集皮肤资产：bundle 文本 + a11y 文本 内联常量（供运行期按需执行）。 */
async function collectAssets() {
  const bundles = {}
  const a11y = {}
  for (const skinId of skinOrder) {
    bundles[skinId] = await readFile(new URL(`./skins/${skinId}/client.js`, root), 'utf8')
    try {
      a11y[skinId] = await readFile(new URL(`./skins/${skinId}/a11y.css`, root), 'utf8')
    } catch {
      a11y[skinId] = ''
    }
  }
  return { bundles, a11y }
}

/** 去除 ESM `export`/`export default` 前缀，使其可内联进 CJS factory。 */
function stripExports(source) {
  return source
    .replace(/^export\s+default\s+/gm, 'return ')
    .replace(/^export\s+/gm, '')
    .replace(/\bexport\s*\{[^}]*\}\s*$/gm, '')
}

const [manifest, { bundles, a11y }] = await Promise.all([buildManifest(), collectAssets()])

const engine = await readFile(new URL('./src/skin-engine.js', root), 'utf8')
const a11yModule = await readFile(new URL('./src/skin-a11y.js', root), 'utf8')
const customSkin = stripExports(await readFile(new URL('./src/custom-skin.js', root), 'utf8'))
const source = await readFile(new URL('./src/client.js', root), 'utf8')

const maybeStrictWrapper = 'globalThis'

const output = `window.__ModuleLoader__.load({ id: ${JSON.stringify(id)}, factory: (require) => {\n  var module = { exports: {} }; var exports = module.exports;\n  const React = require('react');\n// ---- injected skin manifest / assets (build-time embedded, runtime lazy) ----\nconst __SKIN_MANIFEST__ = ${JSON.stringify(manifest)};\nconst __SKIN_BUNDLES__ = ${JSON.stringify(bundles)};\nconst __SKIN_A11Y__ = ${JSON.stringify(a11y)};\n// ---- skin engine (browser skin loading / mutex / teardown) ----\n${stripExports(engine)}\n// ---- custom skin: controlled import / registry / preview / apply / delete / restore ----\n${customSkin}\n// ---- a11y injector ----\n${stripExports(a11yModule)}\n// ---- plugin client ----\n${stripExports(source)}\n  module.exports = plugin;\n  return module.exports;\n} });\n`

await mkdir(new URL('./lib/', root), { recursive: true })
await writeFile(new URL('./lib/client.js', root), output)

if (process.argv.includes('--check')) {
  const generated = await readFile(new URL('./lib/client.js', root), 'utf8')
  if (!generated.includes('window.__ModuleLoader__.load')) throw new Error('client wrapper missing')
  if (!generated.includes('module.exports = plugin')) throw new Error('client plugin export missing')
  for (const skinId of skinOrder) {
    if (!generated.includes(`"${skinId}"`)) throw new Error(`skin bundle metadata missing: ${skinId}`)
  }
  if (!generated.includes('__SKIN_BUNDLES__') || !generated.includes('__SKIN_A11Y__')) {
    throw new Error('skin assets not embedded')
  }
}

console.log(`built ${resolve(new URL('./lib/client.js', root).pathname)} (${manifest.length} skins, ${skinOrder.length} bundles embedded)`)