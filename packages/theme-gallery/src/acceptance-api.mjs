/**
 * acceptance-api.mjs — theme-gallery 公开接口的 Node 接线（供 tests/acceptance 黑盒驱动）。
 *
 * 场景：验收测试在 Node 环境驱动公开接口函数，无 DOM/无 localStorage。
 * 此处用「内存 storage 替身 + 内置主题 id 列表」构造真实 createCustomThemeApi 实例，
 * 断言的是状态机/校验/副作用一致性（INTERFACE §2 / §5 / §8）。
 * 内置主题仅取 id（测试只断言数量/冲突/不可删），label 用 id 占位。
 */
import { createCustomThemeApi } from './custom-theme.js'

/** 内置 15 主题 id（与 src/themes.curated.js 对齐）。 */
export const BUILTIN_THEME_IDS = [
  'jade', 'terracotta', 'ember', 'starlight', 'rose-mist', 'amethyst',
  'amber-retro', 'ink-river', 'mossland', 'eclipse', 'horizon', 'azure',
  'monochrome', 'blush-dawn', 'lilac-mist',
]

/** 内存 storage 替身（同一实例共享同一 localStorage 语义）。 */
export function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial))
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)) },
    removeItem: (k) => { map.delete(k) },
  }
}

/** 创建主题侧验收 API。 */
export function createThemeAcceptanceApi() {
  return createCustomThemeApi({
    storage: memoryStorage(),
    builtinThemes: BUILTIN_THEME_IDS.map((id) => ({ id, label: id })),
  })
}
