// dsh-composer-tools dual-half build.
//
// Node target: the Cordis host half — lib/{index,handler,instructions,
// prompts-store,trust-fence,http-util}.js plus the five pure client cores
// (gate/history-core/history-storage/append/bridge-core) built to node ESM so
// node --test can drive them directly.
//
// Browser target: the client half — mirrors the official DSH client-bundle
// preset (see dsh-session-manager tsdown.config.mjs):
//   - externals resolve through the loader module table at runtime
//     (CLIENT_EXTERNALS),
//   - everything else is inlined into the bundle,
//   - the purity gate rejects Node builtins and any @deepseek-ai value import
//     that is neither a platform module nor an inline-safe wire layer,
//   - CSS Modules compile to hashed class maps and inject <style data-plugin>
//     tags at factory execution,
//   - the artifact registers itself via window.__ModuleLoader__.load({ id,
//     factory }) with the (require) => exports CJS closure shape.
import { readFile } from 'node:fs/promises'
import { basename, dirname, relative, resolve as resolvePath } from 'node:path'
import { fileURLToPath } from 'node:url'
import { builtinModules } from 'node:module'
import { transform } from 'lightningcss'

/** Package root — the anchor for repo-relative virtual ids (no machine paths in the bundle). */
const REPOSITORY_ROOT = fileURLToPath(new URL('.', import.meta.url))

const NODE_BUILTINS = new Set([
  ...builtinModules,
  ...builtinModules.map((id) => `node:${id}`),
])

/** Module specifiers the web shell shares into the frozen module table. */
const CLIENT_EXTERNALS = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  'cordis',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-web-react',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-schema-form',
  '@deepseek-ai/dsh-client-runtime/client',
]

/** Wire/type layers a client bundle may inline (no runtime identity to share). */
const INLINE_SAFE = /^@deepseek-ai\/dsh-(host-apiproxy|session|llm|tools|brand)(\/|$)/

const CSS_VIRTUAL_PREFIX = '\0dsh-css:'
const CSS_VIRTUAL_SUFFIX = '.mjs'

const PLUGIN_ID = 'dsh-composer-tools'

/** The style-injection prologue shared by module css and plain css loads. */
function injectTag(pluginId, fileId, cssText) {
  const tagId = `${pluginId}/${basename(fileId)}`
  return [
    `const css = ${JSON.stringify(cssText)};`,
    `const tagId = ${JSON.stringify(tagId)};`,
    `if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css=' + JSON.stringify(tagId) + ']') === null) {`,
    `  const tag = document.createElement('style');`,
    `  tag.dataset.plugin = ${JSON.stringify(pluginId)};`,
    `  tag.dataset.pluginCss = tagId;`,
    `  tag.textContent = css;`,
    `  document.head.appendChild(tag);`,
    `}`,
  ].join('\n')
}

/** The shared client-bundle purity gate. */
function purityGatePlugin() {
  return {
    name: 'dsh-client-bundle-purity',
    resolveId(source) {
      if (NODE_BUILTINS.has(source)) {
        throw new Error(
          `client bundle purity: Node builtin "${source}" cannot run in the browser module table — `
          + 'select the dependency browser export or add an explicit browser implementation',
        )
      }
      if (!source.startsWith('@deepseek-ai/')) return null
      if (CLIENT_EXTERNALS.includes(source)) return null // platform module: external wins
      if (INLINE_SAFE.test(source)) return null // wire/type layer: inline is the point
      throw new Error(
        `client bundle purity: "${source}" is not a platform module (CLIENT_EXTERNALS) and not an inline-safe wire layer — `
        + 'cross-plugin value imports are forbidden; collaborate through cordis services (type-only imports are erased and never reach this gate)',
      )
    },
  }
}

/** The CSS-inline virtual-module plugin (one <style data-plugin> per file). */
function makeCssPlugin(pluginId) {
  return {
    name: 'dsh-css-inline',
    resolveId(source, importer) {
      if (!source.endsWith('.css')) return null
      let abs
      if (source.startsWith('.') || source.startsWith('/') || /^[A-Za-z]:[\\/]/.test(source)) {
        abs = importer === undefined ? source : resolvePath(dirname(importer), source)
      } else {
        abs = require.resolve(source)
      }
      const rel = relative(REPOSITORY_ROOT, abs)
      return CSS_VIRTUAL_PREFIX + rel + CSS_VIRTUAL_SUFFIX
    },
    async load(virtualId) {
      if (!virtualId.startsWith(CSS_VIRTUAL_PREFIX)) return null
      const relId = virtualId.slice(CSS_VIRTUAL_PREFIX.length, -CSS_VIRTUAL_SUFFIX.length)
      const fileId = resolvePath(REPOSITORY_ROOT, relId)
      this.addWatchFile(fileId)
      const source = await readFile(fileId)
      if (fileId.endsWith('.module.css')) {
        const { code, exports: cssExports } = transform({
          filename: fileId,
          code: source,
          cssModules: { pattern: '[hash]_[local]' },
          minify: true,
        })
        const classMap = {}
        for (const [local, exp] of Object.entries(cssExports ?? {})) classMap[local] = exp.name
        return [
          injectTag(pluginId, fileId, code.toString()),
          `export default ${JSON.stringify(classMap)};`,
        ].join('\n')
      }
      return [
        injectTag(pluginId, fileId, source.toString('utf8')),
        'export default "";',
      ].join('\n')
    },
  }
}

export default [
  {
    entry: {
      index: 'src/index.ts',
      handler: 'src/handler.ts',
      instructions: 'src/instructions.ts',
      'prompts-store': 'src/prompts-store.ts',
      'trust-fence': 'src/trust-fence.ts',
      'http-util': 'src/http-util.ts',
      // Pure client cores built to node ESM so node --test can drive them
      // (session-manager pending-deletes-core pattern).
      gate: 'src/client/gate.ts',
      'history-core': 'src/client/history-core.ts',
      'history-storage': 'src/client/history-storage.ts',
      'session-history': 'src/client/session-history.ts',
      // HistoryNav 是采集/回填的接线层（非纯函数但无 DOM 依赖，rAF 只在回填时
      // 调用）——一起建到 node ESM，验收测试才能驱动"快照采集 → 落盘 → ↑ 回填"
      // 整条链，而不是在测试里重写一遍接线（那正是 Bug 3 漏检的原因）。
      'history-nav': 'src/client/HistoryNav.ts',
      append: 'src/client/append.ts',
      'bridge-core': 'src/client/bridgeCore.ts',
      'instruction-view': 'src/client/instruction-view.ts',
    },
    outDir: 'lib',
    format: 'esm',
    platform: 'node',
    target: 'es2022',
    fixedExtension: false,
    dts: false,
    sourcemap: false,
    clean: false,
  },
  {
    entry: { client: 'src/client/index.tsx' },
    outDir: 'lib',
    format: 'cjs',
    platform: 'browser',
    dts: false,
    sourcemap: false,
    clean: false,
    external: CLIENT_EXTERNALS,
    define: {
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
      'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
      'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
    },
    inputOptions: {
      resolve: {
        conditionNames: ['browser', 'import', 'require', 'default'],
      },
    },
    noExternal: (id) => (CLIENT_EXTERNALS.includes(id) ? undefined : true),
    plugins: [purityGatePlugin(), makeCssPlugin(PLUGIN_ID)],
    outputOptions: {
      entryFileNames: 'client.js',
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(PLUGIN_ID)}, factory: (require) => {`,
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
      codeSplitting: false,
    },
  },
]
