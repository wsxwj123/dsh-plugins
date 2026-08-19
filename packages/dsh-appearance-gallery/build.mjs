/**
 * build.mjs — 唯一构建入口（PLAN D6）。
 *
 * 与合并前两个 build 脚本的四点差别：
 *   1. 拼接顺序固定，所有 src 文件被拼进同一个 factory 作用域；
 *   2. 落盘前先在内存串上跑一遍语法自检与全部断言，任一失败直接 throw，lib/ 不被写；
 *   3. `--check` 完全不落盘：重新生成 → 跑同一套断言 → 与磁盘逐字节比对，
 *      于是 `pnpm -r check` 从「破坏源」变成「看门狗」（LEARNINGS [LRN-20260817] 那颗地雷）；
 *   4. lib/index.js 一并生成，lib/ 下不再有任何手工维护的产物。
 *
 * 跨平台：路径一律 node:path / node:url，不拼 '/'，不依赖 shell glob，不调用平台专属命令。
 */
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(fileURLToPath(import.meta.url))
const SRC = path.join(ROOT, 'src')
const SKINS = path.join(ROOT, 'skins')
const LIB = path.join(ROOT, 'lib')
const PKG_ID = 'dsh-appearance-gallery'

/** 皮肤展示顺序（同时是内置 id 白名单） */
const SKIN_ORDER = ['qq98', 'ths', 'xp', 'blue-fantasy', 'dragon-heir', 'minecraft', 'whale-song', 'trading', 'miku']

/**
 * 体积门禁。兜底上限 900 KB 不可协商（INTERFACE §3.10）；
 * 目标值 2026-08-18 按实测落定（cwebp 重编码后 lib/client.js 实测 ~624 KB / 4 图 base64 ~348 KB），
 * 落定后只准下调。
 */
const MAX_CLIENT_BYTES = 921600
const MAX_IMAGE_B64_TOTAL = 400000

/** 拼接顺序：数据 → 引擎 → API → UI → apply 层。client.js 必须最后。 */
const CONCAT_ORDER = [
  'themes.curated.js',
  'custom-theme.js',
  '__ASSETS__',
  'skin-engine.js',
  'custom-skin.js',
  'skin-a11y.js',
  'panel-theme.js',
  'panel-skin.js',
  'client.js',
]

/** 去掉 ESM import 行与 export 前缀，使模块可内联进同一个 CJS factory 作用域。 */
function stripModuleSyntax(source) {
  return source
    .replace(/^\s*import\s+[^\n]*?from\s*['"][^'"]*['"];?[ \t]*$/gm, '')
    .replace(/^\s*import\s+['"][^'"]*['"];?[ \t]*$/gm, '')
    // 重导出块（可跨行）必须先于 `^export ` 前缀剥掉，否则会留下裸的 `{ … }`
    .replace(/^export\s*\{[^}]*\}\s*;?/gm, '')
    .replace(/^export\s+default\s+/gm, 'return ')
    .replace(/^export\s+/gm, '')
}

async function buildManifest() {
  const entries = []
  for (const skinId of SKIN_ORDER) {
    const meta = JSON.parse(await readFile(path.join(SKINS, skinId, 'skin.json'), 'utf8'))
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

async function collectAssets() {
  const bundles = {}
  const a11y = {}
  for (const skinId of SKIN_ORDER) {
    bundles[skinId] = await readFile(path.join(SKINS, skinId, 'client.js'), 'utf8')
    try {
      a11y[skinId] = await readFile(path.join(SKINS, skinId, 'a11y.css'), 'utf8')
    } catch {
      a11y[skinId] = '' // a11y 缺失是允许的降级（皮肤仍可用）
    }
  }
  return { bundles, a11y }
}

async function generate() {
  const [manifest, { bundles, a11y }] = await Promise.all([buildManifest(), collectAssets()])
  const parts = []
  for (const name of CONCAT_ORDER) {
    if (name === '__ASSETS__') {
      parts.push('// ---- injected skin manifest / assets (build-time embedded, runtime lazy) ----')
      parts.push(`const __SKIN_MANIFEST__ = ${JSON.stringify(manifest)};`)
      parts.push(`const __SKIN_BUNDLES__ = ${JSON.stringify(bundles)};`)
      parts.push(`const __SKIN_A11Y__ = ${JSON.stringify(a11y)};`)
      continue
    }
    parts.push(`// ---- ${name} ----`)
    parts.push(stripModuleSyntax(await readFile(path.join(SRC, name), 'utf8')))
  }
  const body = parts.join('\n')
  const output = [
    `window.__ModuleLoader__.load({ id: ${JSON.stringify(PKG_ID)}, factory: (require) => {`,
    'var module = { exports: {} }; var exports = module.exports;',
    "const React = require('react');",
    body,
    "exports.apply = apply;",
    "exports.inject = ['slots'];",
    'return module.exports; } });',
    '',
  ].join('\n')
  return { output, manifest, bundles }
}

/** 全部断言都跑在内存串上；任一失败 throw，lib/ 不被写。 */
function assertOutput(output, manifest) {
  const lines = output.split('\n')
  const shell = [
    `window.__ModuleLoader__.load({ id: "${PKG_ID}", factory: (require) => {`,
    'var module = { exports: {} }; var exports = module.exports;',
    "const React = require('react');",
  ]
  shell.forEach((expected, i) => {
    if (lines[i] !== expected) throw new Error(`壳第 ${i + 1} 行不匹配\n期望: ${expected}\n实际: ${lines[i]}`)
  })
  if (!output.includes('return module.exports; } });')) throw new Error('壳尾串缺失')
  if (!output.includes('exports.apply = apply')) throw new Error('缺 exports.apply')
  if (!output.includes("exports.inject = ['slots']")) throw new Error('缺 exports.inject')
  if (output.includes('priority')) throw new Error('产物出现 priority：单条目注册不该有遮盖机制')
  for (const table of ['__SKIN_MANIFEST__', '__SKIN_BUNDLES__', '__SKIN_A11Y__']) {
    if (!output.includes(table)) throw new Error(`皮肤资源表缺失: ${table}`)
  }
  for (const skinId of SKIN_ORDER) {
    if (!output.includes(`"${skinId}"`)) throw new Error(`皮肤条目缺失: ${skinId}`)
  }
  if (manifest.length !== SKIN_ORDER.length) throw new Error(`manifest 条目数 ${manifest.length} ≠ ${SKIN_ORDER.length}`)
  const registers = output.match(/slots\.register\s*\(/g) || []
  if (registers.length !== 1) throw new Error(`slots.register 命中 ${registers.length} 处，应恰好 1 处`)
  // 语法自检：只编译不执行，用来拦住重名 const 造成的 SyntaxError
  // eslint-disable-next-line no-new-func -- 只解析不调用；产物里含用户可导入的皮肤文本，绝不求值
  new Function(output)
  const size = Buffer.byteLength(output, 'utf8')
  if (size > MAX_CLIENT_BYTES) throw new Error(`lib/client.js ${size} B 超过上限 ${MAX_CLIENT_BYTES} B`)
  const imageBytes = (output.match(/data:image\/[a-z+]+;base64,[A-Za-z0-9+/=]+/g) || [])
    .reduce((sum, uri) => sum + uri.length, 0)
  if (imageBytes > MAX_IMAGE_B64_TOTAL) {
    throw new Error(`内嵌图片 base64 合计 ${imageBytes} B 超过上限 ${MAX_IMAGE_B64_TOTAL} B`)
  }
  return { size, imageBytes }
}

const INDEX_JS = "export const name = 'dsh-appearance-gallery'\nexport function apply() {}\n"

const { output, manifest } = await generate()
const stats = assertOutput(output, manifest)
const clientPath = path.join(LIB, 'client.js')
const indexPath = path.join(LIB, 'index.js')

if (process.argv.includes('--check')) {
  // 只读看门狗：不写盘，只比对
  let onDisk
  try {
    onDisk = await readFile(clientPath, 'utf8')
  } catch {
    throw new Error('lib/client.js 不存在，请先跑 pnpm build')
  }
  if (onDisk !== output) throw new Error('产物与源码不同步，请跑 pnpm build')
  if ((await readFile(indexPath, 'utf8')) !== INDEX_JS) throw new Error('lib/index.js 与源码不同步，请跑 pnpm build')
  const extra = (await readdir(LIB)).filter((f) => f !== 'client.js' && f !== 'index.js')
  if (extra.length > 0) throw new Error(`lib/ 下有非产物文件：${extra.join(', ')}`)
  console.log(`check ok (${stats.size} B, images ${stats.imageBytes} B)`)
} else {
  await mkdir(LIB, { recursive: true })
  await writeFile(clientPath, output)
  await writeFile(indexPath, INDEX_JS)
  console.log(`built ${clientPath} (${stats.size} B, images ${stats.imageBytes} B, ${manifest.length} skins)`)
}
