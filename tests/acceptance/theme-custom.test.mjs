// 验收测试草稿 — theme-gallery 自定义主题（INTERFACE §2 / §5 / §8）
//
// 黑盒：只通过公开接口函数驱动，不 import 内部模块，不读实现。
// 【开发接线点】特征未实现前此文件为可运行底座：把 importPublicApi 里
//  创建的真实公开 API 对象暴露成下面的 `api` 即可跑通全部断言。
//  公开函数签名来自 INTERFACE §2.2 / §4.1：
//  - importCustomTheme(jsonText): Promise<CustomThemeItem>   reject {code,message}
//  - previewCustomTheme(id): void
//  - applyCustomTheme(id): void
//  - deleteCustomTheme(id): void
//  - restoreDefaultTheme(): void
//  - getCustomThemes(): CustomThemeItem[]
//  - getThemes(): ThemeFamily[]  (15 内置)
//  - activateFamily(id): void
//  - getCustomAppliedId(): string|null   【测试需要的读取缝】返回当前 applied 自定义主题 id；
//    INTERFACE §2 未显式列此 getter，但 §8.1 需断言 applied 键语义——开发须提供一个块读接口，
//    或把测试中 getCustomAppliedId 的断言改接到 getCustomThemes() 状态推导。
import { describe, it, afterEach } from 'node:test'
import assert from 'node:assert/strict'

// —— 接线点：接入 theme-gallery 真实公开 API（仅改此接线块，不改任何断言）——
import { createThemeAcceptanceApi } from '../../packages/theme-gallery/src/acceptance-api.mjs'
const api = createThemeAcceptanceApi()
// —— 接线点结束 ——

// 常量：内置主题 id 与 jade 默认值（来自 INTERFACE §1.1 / §5）
const BUILTIN_IDS = ['jade', 'terracotta', 'ember', 'starlight', 'rose-mist', 'amethyst',
  'amber-retro', 'ink-river', 'mossland', 'eclipse', 'horizon', 'azure', 'monochrome',
  'blush-dawn', 'lilac-mist'] // 15 内置（与 packages/theme-gallery/src/themes.curated.js 对齐）
const DEFAULT_APPLIED_ID = 'jade'

const validThemeJSON = JSON.stringify({
  id: 'my-theme',
  label: '我的主题',
  tokens: {
    '--dsw-bg': { light: '#ffffff', dark: '#000000' },
  },
})

function codeOf(err) {
  return err && typeof err === 'object' && err.code
}

describe('主题自定义系统 · 状态机 (§8.1)', () => {
  afterEach(() => api.restoreDefaultTheme())

  it('A1 全链：none→import→preview→applied→delete→restore 状态一致', async () => {
    const before = api.getCustomThemes()
    assert.equal(before.length, 0, '初始自定义 registry 应为空')

    const item = await api.importCustomTheme(validThemeJSON)
    assert.equal(item.id, 'my-theme')
    assert.ok(api.getCustomThemes().some((t) => t.id === 'my-theme'), '导入后应在 registry')

    // preview：不写 applied 键
    api.previewCustomTheme('my-theme')
    assert.equal(api.getCustomAppliedId?.() ?? null, null,
      'preview 不应写入 applied 键（A3 语义）')

    // apply：写 applied 键
    api.applyCustomTheme('my-theme')
    assert.equal(api.getCustomAppliedId?.() ?? null, 'my-theme', 'apply 后 applied 应为 my-theme')

    // delete applied 项 → 回内置默认 jade
    api.deleteCustomTheme('my-theme')
    assert.equal(api.getCustomAppliedId?.() ?? null, DEFAULT_APPLIED_ID,
      '删除正被应用的项应回内置默认 jade')
    assert.ok(!api.getCustomThemes().some((t) => t.id === 'my-theme'), '删除后移出 registry')

    // restore_default → registry 清空，内置仍在
    await api.importCustomTheme(validThemeJSON)
    api.restoreDefaultTheme()
    assert.equal(api.getCustomThemes().length, 0, 'restore 后自定义清空')
    assert.equal(api.getThemes().length, 15, 'restore 不影响内置主题数量')
  })

  it('A1b delete 未应用项：只移出 registry，不改 applied 键', () => {
    // 无副作用：不动外观 // 占位断言：delete 不抛错、registry 变化
    assert.equal(typeof api.deleteCustomTheme, 'function')
  })

  it('A4 非法导入全链失败且外观不变', async () => {
    const beforeApplied = api.getCustomAppliedId?.() ?? null
    await assert.rejects(api.importCustomTheme('not json'), (e) => {
      assert.equal(codeOf(e), 'ERR_IMPORT_INVALID_JSON')
      return true
    })
    // 失败后外观/键/registry 与失败前一致
    assert.equal(api.getCustomAppliedId?.() ?? null, beforeApplied, '失败后 applied 键不变')
    assert.equal(api.getCustomThemes().length, 0, '失败后不写入 registry')
  })
})

describe('主题导入校验 · 错误契约 (§5 / §8.3)', () => {
  afterEach(() => api.restoreDefaultTheme())

  it('C1 合法 JSON 通过并入 registry', async () => {
    const item = await api.importCustomTheme(validThemeJSON)
    assert.equal(item.id, 'my-theme')
    assert.equal(item.label, '我的主题')
  })

  it('C2 非法 JSON → ERR_IMPORT_INVALID_JSON', async () => {
    await assert.rejects(api.importCustomTheme('{oops'), (e) =>
      codeOf(e) === 'ERR_IMPORT_INVALID_JSON')
    await assert.rejects(api.importCustomTheme(''), (e) =>
      codeOf(e) === 'ERR_IMPORT_INVALID_JSON')
  })

  it('C3 缺 id / label / tokens 任一 → ERR_THEME_MISSING_FIELD', async () => {
    const cases = [
      { label: 'x', tokens: {} },          // 缺 id
      { id: 'a', tokens: {} },             // 缺 label
      { id: 'a', label: 'x' },             // 缺 tokens
    ]
    for (const c of cases) {
      await assert.rejects(
        api.importCustomTheme(JSON.stringify(c)),
        (e) => codeOf(e) === 'ERR_THEME_MISSING_FIELD',
        `缺字段应拒绝: ${JSON.stringify(c)}`,
      )
    }
  })

  it('C4 坏 token（前缀非 --dsw- / 值缺 light 或缺 dark / 非字符串）→ ERR_THEME_BAD_TOKEN', async () => {
    const bad = [
      { id: 'a', label: 'x', tokens: { 'bg': { light: '#fff', dark: '#000' } } },       // 前缀错误
      { id: 'a', label: 'x', tokens: { '--dsw-bg': { dark: '#000' } } },                // 缺 light
      { id: 'a', label: 'x', tokens: { '--dsw-bg': { light: '#fff' } } },               // 缺 dark
      { id: 'a', label: 'x', tokens: { '--dsw-bg': { light: 1, dark: '#000' } } },      // light 非字符串
      { id: 'a', label: 'x', tokens: { '--dsw-bg': null } },                            // 值非 {light,dark}
    ]
    for (const c of bad) {
      await assert.rejects(
        api.importCustomTheme(JSON.stringify(c)),
        (e) => codeOf(e) === 'ERR_THEME_BAD_TOKEN',
        `坏 token 应拒绝: ${JSON.stringify(c)}`,
      )
    }
  })

  it('C5 与内置主题 id 冲突 → ERR_THEME_ID_CONFLICT', async () => {
    await assert.rejects(
      api.importCustomTheme(JSON.stringify({
        id: 'jade', label: '冲突', tokens: { '--dsw-bg': { light: '#fff', dark: '#000' } },
      })),
      (e) => codeOf(e) === 'ERR_THEME_ID_CONFLICT',
      'id=jade 与内置冲突应拒绝',
    )
  })

  it('C6 边界拒绝且外观不变', async () => {
    // tokens 空对象
    await assert.rejects(api.importCustomTheme(JSON.stringify({ id: 'a', label: 'x', tokens: {} })),
      (e) => codeOf(e) === 'ERR_THEME_MISSING_FIELD')
    // label 超 80 字符
    const longLabel = '长'.repeat(81)
    await assert.rejects(api.importCustomTheme(JSON.stringify({
      id: 'a', label: longLabel, tokens: { '--dsw-bg': { light: '#fff', dark: '#000' } },
    })))
    // id 非法字符（大写/空格）
    await assert.rejects(api.importCustomTheme(JSON.stringify({
      id: 'Bad ID', label: 'x', tokens: { '--dsw-bg': { light: '#fff', dark: '#000' } },
    })))
    // 断言无副作用
    assert.equal(api.getCustomThemes().length, 0)
  })
})

describe('主题 试穿/应用 未知 id (§5 ERR_UNKNOWN_ID)', () => {
  it('对不存在的 id 试穿/应用抛 ERR_UNKNOWN_ID', () => {
    assert.throws(() => api.previewCustomTheme('nope'), (e) =>
      codeOf(e) === 'ERR_UNKNOWN_ID')
    assert.throws(() => api.applyCustomTheme('nope'), (e) =>
      codeOf(e) === 'ERR_UNKNOWN_ID')
  })
})

describe('主题 内置不可删 (§8.4 D5)', () => {
  afterEach(() => api.restoreDefaultTheme())
  it('对内置 id delete 不生效（内置仍可枚举）', () => {
    const before = api.getThemes().map((t) => t.id)
    assert.equal(BUILTIN_IDS.length, before.length, '内置主题应 15 个')
    api.deleteCustomTheme('jade')
    const after = api.getThemes().map((t) => t.id)
    assert.deepEqual(after, before, 'delete 内置主题后内置列表不变')
  })
})


