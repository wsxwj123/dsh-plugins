/**
 * attribution.test.mjs — 致谢/许可一致性测试（评审 F4，INTERFACE §6/§8 项5）。
 *
 * 契约：
 *   - skins/NOTICE.md 列出全部 9 款皮肤及其 author（含三来源 dsh-web-ui / powerdog996 /
 *     涂山苏苏），并引用上游仓库 github.com/zhu1090093659/dsh-web-ui。
 *   - 每个 skins/<id>/LICENSE 为 BSD-3-Clause 且含版权行 Copyright (c) 2026, zhu1090093659。
 *   - manifest（getSkins 的数据源，与 build.mjs 一致）逐项与 NOTICE/license 对齐。
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { buildManifest } from './skin-harness.mjs'

const ROOT = new URL('../../', import.meta.url)
const NOTICE = await readFile(new URL('skins/NOTICE.md', ROOT), 'utf8')
const manifest = await buildManifest()
const SKIN_IDS = ['qq98', 'ths', 'xp', 'blue-fantasy', 'dragon-heir', 'minecraft', 'whale-song', 'trading', 'miku']

describe('F4 — NOTICE/LICENSE/作者/上游一致性', () => {
  test('NOTICE.md 含 9 款皮肤 author 与上游仓库引用', () => {
    // 三来源作者必须都出现（INTERFACE 要求的作者映射完整）。
    assert.match(NOTICE, /dsh-web-ui/, '聚合包作者 dsh-web-ui')
    assert.match(NOTICE, /powerdog996/, 'blue-fantasy 作者 powerdog996')
    assert.match(NOTICE, /涂山苏苏/, 'miku 作者 涂山苏苏')
    // 上游仓库
    assert.match(NOTICE, /github\.com\/zhu1090093659\/dsh-web-ui/, '上游仓库引用')
    // 每款皮肤 id 都出现在表中
    for (const id of SKIN_IDS) assert.match(NOTICE, new RegExp(String.raw`\| ${id} \|`), `NOTICE 含 ${id}`)
  })

  test('每个 skins/<id>/LICENSE 为 BSD-3 且含版权行', async () => {
    for (const id of SKIN_IDS) {
      const text = await readFile(new URL(`skins/${id}/LICENSE`, ROOT), 'utf8')
      assert.match(text, /BSD 3-Clause License/, `${id} LICENSE 为 BSD-3`)
      assert.match(text, /Copyright \(c\) 2026, zhu1090093659/, `${id} LICENSE 含版权行`)
      assert.match(text, /Redistribution and use in source and binary forms/, `${id} LICENSE 含 BSD-3 条款`)
    }
  })

  test('getSkins（manifest）逐项与皮肤资产作者/license 一致', async () => {
    for (const entry of manifest) {
      assert.equal(entry.license, 'BSD-3-Clause', `${entry.id} license 字段`)
      assert.ok(entry.author && typeof entry.author === 'string', `${entry.id} author`)
      assert.ok(entry.package.startsWith('@linxin666/dsh-client-ui-skin-'), `${entry.id} package`)
    }
    // 与 skin.json 实读一致（buildManifest 重建自同一数据源）
    const ids = manifest.map((e) => e.id)
    assert.deepEqual(ids, SKIN_IDS, 'manifest 顺序与清单一致')
  })

  test('manifest 与 NOTICE 中 author 逐项对齐', () => {
    // 解析 NOTICE 表格行：| id | 中文名 | nameEn | author | bodyAttr | license |
    const noticeAuthors = new Map()
    for (const line of NOTICE.split('\n')) {
      const m = line.match(/^\| ([a-z0-9-]+) \| ([^|]*) \| ([^|]*) \| ([^|]+?) \| `?data-dsh-[a-z-]+`? \| BSD-3-Clause \|$/)
      if (m) noticeAuthors.set(m[1], m[4].trim())
    }
    assert.equal(noticeAuthors.size, 9, 'NOTICE 应有 9 款皮肤行')
    for (const entry of manifest) {
      const n = noticeAuthors.get(entry.id)
      assert.ok(n !== undefined, `NOTICE 有 ${entry.id} 行`)
      assert.equal(n, entry.author.trim(), `${entry.id} author 与 NOTICE 一致`)
    }
  })
})
