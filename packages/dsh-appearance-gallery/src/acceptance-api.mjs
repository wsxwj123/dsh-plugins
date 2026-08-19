/**
 * acceptance-api.mjs — 公开接口的 Node 接线（供 tests/acceptance 黑盒驱动）。
 *
 * 场景：验收测试在 Node 环境驱动公开接口，无 DOM / 无浏览器存储 / 不激活真实 bundle。
 * 用「内存 storage 替身 + 内置清单 + 包内校验器」构造真实的 createCustomThemeApi /
 * createCustomSkinApi。导出名与合并前两份文件逐字一致（INTERFACE §3.9）。
 */
import { createCustomThemeApi } from './custom-theme.js'
import { createCustomSkinApi } from './custom-skin.js'
import { validateCustomBundle } from './skin-engine.js'

/** 内置 15 主题 id（与 src/themes.curated.js 对齐）。 */
export const BUILTIN_THEME_IDS = [
  'jade', 'terracotta', 'ember', 'starlight', 'rose-mist', 'amethyst',
  'amber-retro', 'ink-river', 'mossland', 'eclipse', 'horizon', 'azure',
  'monochrome', 'blush-dawn', 'lilac-mist',
]

/** 内置 9 皮肤（与 skins/<id>/skin.json + build.mjs 的 buildManifest 对齐）。 */
export const BUILTIN_SKINS = [
  { id: 'qq98', name: 'QQ2008 怀旧版', nameEn: 'QQ2008 Retro', author: 'dsh-web-ui', accent: '#2b7cd9', bodyAttr: 'data-dsh-qq98', order: 1, package: '@linxin666/dsh-client-ui-skin-qq98', license: 'BSD-3-Clause' },
  { id: 'ths', name: '同花顺风格', nameEn: 'Tonghuashun Trading', author: 'dsh-web-ui', accent: '#e60012', bodyAttr: 'data-dsh-ths', order: 2, package: '@linxin666/dsh-client-ui-skin-ths', license: 'BSD-3-Clause' },
  { id: 'xp', name: 'Windows XP (Luna)', nameEn: 'Windows XP Luna', author: 'dsh-web-ui', accent: '#316ac5', bodyAttr: 'data-dsh-xp', order: 3, package: '@linxin666/dsh-client-ui-skin-xp', license: 'BSD-3-Clause' },
  { id: 'blue-fantasy', name: '蓝色幻想', nameEn: 'Blue Fantasy', author: 'powerdog996（DreamSkin 社区）· dsh-web-ui 适配', accent: '#4a5fa8', bodyAttr: 'data-dsh-blue-fantasy', order: 4, package: '@linxin666/dsh-client-ui-skin-blue-fantasy', license: 'BSD-3-Clause' },
  { id: 'dragon-heir', name: '龙的传人', nameEn: 'Dragon Heir', author: 'dsh-web-ui', accent: '#c3272b', bodyAttr: 'data-dsh-dragon-heir', order: 5, package: '@linxin666/dsh-client-ui-skin-dragon-heir', license: 'BSD-3-Clause' },
  { id: 'minecraft', name: 'Minecraft 方块世界', nameEn: 'Minecraft Voxel', author: 'dsh-web-ui', accent: '#7cbd4b', bodyAttr: 'data-dsh-minecraft', order: 6, package: '@linxin666/dsh-client-ui-skin-minecraft', license: 'BSD-3-Clause' },
  { id: 'whale-song', name: '鲸吟', nameEn: 'Whale Song', author: 'dsh-web-ui', accent: '#4d8fd4', bodyAttr: 'data-dsh-whale-song', order: 7, package: '@linxin666/dsh-client-ui-skin-whale-song', license: 'BSD-3-Clause' },
  { id: 'trading', name: '交易终端', nameEn: 'Trading Terminal', author: 'dsh-web-ui', accent: '#f23645', bodyAttr: 'data-dsh-trading', order: 8, package: '@linxin666/dsh-client-ui-skin-trading', license: 'BSD-3-Clause' },
  { id: 'miku', name: '初音未来 · 电子歌姬', nameEn: 'Hatsune Miku', author: '涂山苏苏', accent: '#2e9bff', bodyAttr: 'data-dsh-miku', order: 9, package: '@linxin666/dsh-client-ui-skin-miku', license: 'BSD-3-Clause' },
]

/** 内存 storage 替身（同一实例共享同一浏览器存储语义）。 */
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

/** 创建皮肤侧验收 API。 */
export function createSkinAcceptanceApi() {
  return createCustomSkinApi({
    storage: memoryStorage(),
    builtinSkins: BUILTIN_SKINS,
    validate: validateCustomBundle,
    // Node 环境不提供 engine（无 __DSH_MODULES__ / DOM），逻辑状态机已足够驱动黑盒断言。
  })
}
