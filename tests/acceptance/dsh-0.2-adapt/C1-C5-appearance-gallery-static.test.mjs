// 静态门禁（INTERFACE §3.1 / §3.3 / 必验清单 C1、C5）— dsh-appearance-gallery
//
// 只读「数据」：package.json（peer 声明）。修复前（三个 ui-* peer 仍是 ^0.1.0-rc.6）
// 这里应 FAIL（红）；修复后应 PASS（绿）。
import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { PKGS, readJson } from './helpers.mjs'

const PKG = () => readJson(path.join(PKGS.appearanceGallery, 'package.json'))
const DUAL = '^0.1.0-rc.6 || ^0.2.0-rc.1'

// ---------------- C1：三 ui-* peer 改双区间；cordis/react/meta 不变 ----------------
for (const pkgName of [
  '@deepseek-ai/dsh-client-ui-theme',
  '@deepseek-ai/dsh-client-ui-settings',
  '@deepseek-ai/dsh-client-ui-slots',
]) {
  test(`C1 静态_peer ${pkgName} = ${DUAL}`, () => {
    const p = PKG()
    assert.notEqual(p, null, 'package.json 不存在或非法 JSON')
    assert.equal(
      p.peerDependencies?.[pkgName],
      DUAL,
      `${pkgName} 应为 "${DUAL}"，实为 "${p.peerDependencies?.[pkgName]}"（修复：改双区间以覆盖 0.1.5 与 0.2）`,
    )
  })
}

test('C1 静态_cordis peer 保持 ^4.0.1', () => {
  const p = PKG()
  assert.equal(p.peerDependencies?.['@deepseek-ai/cordis'], '^4.0.1')
})

test('C1 静态_react peer 保持 ^18.0.0 || ^19.0.0', () => {
  const p = PKG()
  assert.equal(p.peerDependencies?.react, '^18.0.0 || ^19.0.0')
})

test('C1 静态_peerDependenciesMeta 五项全部 optional 不变', () => {
  const p = PKG()
  const meta = p.peerDependenciesMeta
  assert.notEqual(meta, null, 'peerDependenciesMeta 缺失')
  for (const k of [
    '@deepseek-ai/cordis',
    '@deepseek-ai/dsh-client-ui-theme',
    '@deepseek-ai/dsh-client-ui-settings',
    '@deepseek-ai/dsh-client-ui-slots',
    'react',
  ]) {
    assert.equal(meta[k]?.optional, true, `peerDependenciesMeta.${k}.optional 应为 true`)
  }
})

// ---------------- C5：双区间结构（每个宿主版本各由一条 comparator 覆盖） ----------------
// INTERFACE §3.3 已定结论：DSH 用 semver.satisfies(range, {includePrerelease:true})，
// 双区间同时覆盖 0.2.0-rc.2（由 ^0.2.0-rc.1）与 0.1.5-rc.2（由 ^0.1.0-rc.6）。
// 静态面验证「两条 comparator 都在」，运行时「去豁免后仍能加载」由 C5 真机/e2e 守门。
test('C5 静态_双区间同时含 ^0.1.0-rc.6 与 ^0.2.0-rc.1 两条分支', () => {
  const p = PKG()
  for (const pkgName of [
    '@deepseek-ai/dsh-client-ui-theme',
    '@deepseek-ai/dsh-client-ui-settings',
    '@deepseek-ai/dsh-client-ui-slots',
  ]) {
    const range = p.peerDependencies?.[pkgName] ?? ''
    assert.ok(range.includes('^0.1.0-rc.6'), `${pkgName} 缺 ^0.1.0-rc.6 分支`)
    assert.ok(range.includes('^0.2.0-rc.1'), `${pkgName} 缺 ^0.2.0-rc.1 分支`)
    assert.ok(range.includes('||'), `${pkgName} 不是 "||" 双区间`)
  }
})
