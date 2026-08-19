/**
 * body-attr.test.mjs — 皮肤 bodyAttr 自洽门禁（qq98 事故的回归护栏，九套全覆盖）。
 *
 * 事故原文：qq98/client.js 写 `body.dataset.dshRetro`（产出 data-dsh-retro），而
 * skin.json 声明与全部 CSS/a11y 选择器用 data-dsh-qq98 —— 样式永远匹配不上；
 * 引擎卸载时按声明值（skin-engine.js 的 entry.bodyAttr）回收，实际写上去的属性残留在 body 上。
 *
 * 一个皮肤的 body 属性名出现在四处，必须全等：
 *   skin.json 的 bodyAttr / client.js 里真正写 body 的那次调用 / client.js 内联 CSS 的作用域 / a11y.css 的作用域。
 *
 * 纯静态分析：不执行皮肤 bundle（trading 会拉行情、miku 有定时器，跑真 bundle 属实测范畴，
 * 不该由单测背）。提取规则覆盖九套现有的两种写法：`body.dataset.<Camel>` 与 `body.setAttribute('data-…')`。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { buildManifest } from './skin-harness.mjs'

const ROOT = new URL('../../', import.meta.url)
const camelToKebab = (s) => s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)

/** client.js 里对 body 上 data-dsh-* 属性的全部touch点（读/写/删都算），去重排序。 */
function touchedDshAttrs(source) {
  const names = new Set()
  for (const [, key] of source.matchAll(/\bbody\.dataset\.([A-Za-z0-9_$]+)/g)) {
    names.add(`data-${camelToKebab(key)}`)
  }
  for (const [, name] of source.matchAll(/\bbody\.(?:set|remove|has|get)Attribute\(\s*["'`]([^"'`]+)["'`]/g)) {
    names.add(name)
  }
  return [...names].filter((n) => n.startsWith('data-dsh-')).sort()
}

test('九套皮肤_bodyAttr 在 skin.json 与 client.js 与 CSS 三处一致', async () => {
  for (const entry of await buildManifest()) {
    const client = await readFile(new URL(`skins/${entry.id}/client.js`, ROOT), 'utf8')
    const a11y = await readFile(new URL(`skins/${entry.id}/a11y.css`, ROOT), 'utf8')

    assert.equal(entry.bodyAttr, `data-dsh-${entry.id}`, `${entry.id}: bodyAttr 应为 data-dsh-<id> 约定`)
    assert.deepEqual(touchedDshAttrs(client), [entry.bodyAttr],
      `${entry.id}: client.js 实际操作的 data-dsh-* 与 skin.json 声明的 bodyAttr 不一致`)
    assert.ok(client.includes(`body[${entry.bodyAttr}]`), `${entry.id}/client.js: 缺 body[${entry.bodyAttr}] 作用域`)
    assert.ok(a11y.includes(`body[${entry.bodyAttr}]`), `${entry.id}/a11y.css: 缺 body[${entry.bodyAttr}] 作用域`)
  }
})
