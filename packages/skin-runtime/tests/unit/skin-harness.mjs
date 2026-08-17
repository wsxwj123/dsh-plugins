import { readFile } from 'node:fs/promises'
import { makeWindow, executeOnWindow } from './harness.mjs'
import { createSkinEngine } from '../../src/skin-engine.js'
import { createA11yInjector } from '../../src/skin-a11y.js'

export const SKIN_ORDER = ['qq98', 'ths', 'xp', 'blue-fantasy', 'dragon-heir', 'minecraft', 'whale-song', 'trading', 'miku']
const ROOT = new URL('../../', import.meta.url)
const readText = (rel) => readFile(new URL(rel, ROOT), 'utf8')

export async function buildManifest() {
  const entries = []
  for (const id of SKIN_ORDER) {
    const meta = JSON.parse(await readText(`skins/${id}/skin.json`))
    entries.push({
      id: meta.id, name: meta.name, nameEn: meta.nameEn, author: meta.author,
      tagline: meta.tagline, accent: meta.accent, bodyAttr: meta.bodyAttr, order: meta.order,
      package: meta.package, bundleFile: `skins/${id}/client.js`, a11yFile: `skins/${id}/a11y.css`,
      license: 'BSD-3-Clause',
    })
  }
  return entries.sort((a, b) => a.order - b.order)
}

export async function loadSkinWithA11y(id, { includeA11y = true, log = console } = {}) {
  const win = makeWindow()
  const manifest = await buildManifest()
  const entry = manifest.find((item) => item.id === id)
  const bundles = { [id]: await readText(`skins/${id}/client.js`) }
  const a11y = { [id]: includeA11y ? await readText(`skins/${id}/a11y.css`) : '' }
  const engine = createSkinEngine({
    modules: win.__DSH_MODULES__,
    manifest,
    bundles,
    executeScript: (code) => executeOnWindow(win, code),
  })
  const injector = createA11yInjector({ a11y, log })
  const priorDocument = globalThis.document
  const priorMutationObserver = globalThis.MutationObserver
  globalThis.document = win.document
  globalThis.MutationObserver = class { constructor() {} observe() {} disconnect() {} takeRecords() { return [] } }
  await engine.activateSkin(entry, { afterApply: () => injector.inject(id) })
  return {
    engine,
    document: win.document,
    currentSkinState: () => engine.currentSkinState(),
    cleanup() {
      engine.teardownSkins()
      if (priorDocument !== undefined) globalThis.document = priorDocument
      else delete globalThis.document
      if (priorMutationObserver !== undefined) globalThis.MutationObserver = priorMutationObserver
      else delete globalThis.MutationObserver
    },
  }
}
