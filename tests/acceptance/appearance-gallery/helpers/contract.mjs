// 契约常量 —— 逐条抄自 .devflow/INTERFACE.md，不得自行增补。
// 每个常量后面标注它来自 INTERFACE 的哪一节，方便 04 之后核对漂移。

/** INTERFACE §3.1 */
export const SLOT = {
  name: 'settings.general.item',
  id: 'appearance-gallery',
  order: 11,
  hostReservedOrder: 20, // 宿主自带 composer-enter
};

/** INTERFACE §3.0 / §3.10 */
export const PKG_NAME = 'dsh-appearance-gallery';
export const STYLE_MARK = 'data-appearance-gallery';
export const LEGACY_STYLE_MARKS = ['data-theme-gallery', 'data-skin-gallery', 'data-skin-entry'];

/** INTERFACE §3.4 —— 8 个键，一个不多一个不少 */
export const KEYS = {
  TRACK: 'dsh-appearance-track-v1',
  THEME_FAMILY: 'theme-gallery-family-v5',
  THEME_CUSTOM: 'theme-gallery-custom-v1',
  THEME_CUSTOM_APPLIED: 'theme-gallery-custom-applied-v1',
  THEME_TOUCHED: 'theme-gallery-custom-touched-v1',
  SKIN_CUSTOM: 'skin-gallery-custom-v1',
  SKIN_CUSTOM_APPLIED: 'skin-gallery-custom-applied-v1',
  SKIN_BUILTIN: 'skin-gallery-skin-v1',
};
export const ALL_KEYS = Object.values(KEYS);
/** §3.4 兼容断言 4：越权写入探测用的前缀白名单 */
export const KEY_PREFIXES = ['theme-gallery', 'skin-gallery', 'dsh-appearance'];

/** INTERFACE §3.6 —— 15 个内置主题 id，顺序照抄 */
export const BUILTIN_THEME_IDS = [
  'jade', 'terracotta', 'ember', 'starlight', 'rose-mist', 'amethyst',
  'amber-retro', 'ink-river', 'mossland', 'eclipse', 'horizon', 'azure',
  'monochrome', 'blush-dawn', 'lilac-mist',
];
export const DEFAULT_THEME_ID = 'jade';
/** §3.3 E1 —— INTERFACE 只钉住 jade 的 label 是「竹青」，其余 label 未定义，测试不得断言 */
export const JADE_LABEL = '竹青';

/** INTERFACE §3.7 —— 9 个内置皮肤 id，顺序照抄 */
export const BUILTIN_SKIN_IDS = [
  'qq98', 'ths', 'xp', 'blue-fantasy', 'dragon-heir',
  'minecraft', 'whale-song', 'trading', 'miku',
];

/** INTERFACE §3.8 错误码总表 */
export const ERR = {
  IMPORT_INVALID_JSON: 'ERR_IMPORT_INVALID_JSON',
  THEME_MISSING_FIELD: 'ERR_THEME_MISSING_FIELD',
  THEME_BAD_TOKEN: 'ERR_THEME_BAD_TOKEN',
  THEME_ID_CONFLICT: 'ERR_THEME_ID_CONFLICT',
  UNKNOWN_ID: 'ERR_UNKNOWN_ID',
  SKIN_MISSING_FILE: 'ERR_SKIN_MISSING_FILE',
  SKIN_BAD_META: 'ERR_SKIN_BAD_META',
  SKIN_CONTRACT: 'ERR_SKIN_CONTRACT',
  SKIN_DANGEROUS: 'ERR_SKIN_DANGEROUS',
  SKIN_SIZE: 'ERR_SKIN_SIZE',
  SKIN_COUNT: 'ERR_SKIN_COUNT',
};

/** INTERFACE §3.6 / §3.7 —— id 正则（主题与皮肤共用同一条） */
export const ID_RE = /^[a-z0-9][a-z0-9-_]{0,63}$/;
/** §3.6 */
export const THEME_LABEL_MAX = 80;
export const TOKEN_PREFIX = '--dsw-';
/** §3.3 T1 / S1 */
export const SEARCH_INPUT_MAX = 64;

/** INTERFACE §3.7 —— 对外承诺的 5 组常量 */
export const MAX_BUNDLE_B64 = 262144;
export const MAX_CUSTOM_COUNT = 8;
export const MAX_A11Y_BYTES = 65536;
export const SKIN_REQUIRED_META = ['id', 'name', 'author', 'license'];
export const CTX_WHITELIST = ['effect', 'get'];

/** INTERFACE §3.7 —— 12 条高危黑名单，顺序即代码顺序，纯子串匹配 */
export const DANGEROUS_SUBSTRINGS = [
  'eval(', 'new Function(', 'import(', 'require(', '<script src=', 'fetch(',
  'XMLHttpRequest(', 'WebSocket(', 'localStorage', 'sessionStorage',
  'document.cookie', 'chrome.runtime',
];

/** INTERFACE §3.2 / §3.3 —— 用户可见文案，逐字断言用 */
export const TEXT = {
  legacyConflict: '检测到旧版 theme-gallery / skin-gallery 仍已安装，请先卸载，否则外观会冲突',
  // INTERFACE 原文带反引号包裹 __DSH_MODULES__，实际渲染是否含反引号未定义 →
  // 测试只断言这两个片段都在，不断言整串（见 TEST-PLAN 的"契约歧义"节）。
  skinUnavailableHead: '皮肤轨道不可用：宿主未提供',
  skinUnavailableToken: '__DSH_MODULES__',
  summaryThemePrefix: '精选主题 · ',
  summarySkinPrefix: '完整皮肤 · ',
  summaryDefault: '默认外观',
};

/** INTERFACE §3.8 —— 两个无 code 的运行时错误（引擎层） */
export const runtimeUnknownSkin = (id) => `[theme-gallery-skin] unknown-skin: ${id}`;
export const runtimeNoApply = (pkg) => `[theme-gallery-skin] "${pkg}" client bundle exports no apply`;

/** INTERFACE §3.9 —— acceptance-api 必须导出的名字 */
export const ACCEPTANCE_API_EXPORTS = [
  'createThemeAcceptanceApi', 'createSkinAcceptanceApi', 'memoryStorage',
  'BUILTIN_THEME_IDS', 'BUILTIN_SKINS',
];
/** INTERFACE §3.9 —— 模块级导出清单 */
export const MODULE_EXPORTS = {
  'custom-theme.js': ['validateTheme', 'createCustomThemeApi', 'ERR', 'STORAGE_CUSTOM',
    'STORAGE_CUSTOM_APPLIED', 'STORAGE_FAMILY', 'STORAGE_TOUCHED', 'TRACK_KEY', 'DEFAULT_THEME_ID'],
  'custom-skin.js': ['validateBundle', 'createCustomSkinApi', 'ERR', 'STORAGE_CUSTOM',
    'STORAGE_CUSTOM_APPLIED', 'STORAGE_SKIN', 'TRACK_KEY', 'MAX_BUNDLE_B64',
    'MAX_CUSTOM_COUNT', 'MAX_A11Y_BYTES'],
  'skin-engine.js': ['validateCustomBundle', 'createSkinEngine', 'SKIN_VALIDATION_ERRORS'],
  'skin-a11y.js': ['createA11yInjector'],
};
/** INTERFACE §3.9 —— __TG_SURFACE__ 的 12 个字段 */
export const SURFACE_FIELDS = [
  'apply', 'activateSkin', 'previewSkin', 'applySkin', 'clearSkin', 'currentSkinState',
  'getSkins', 'getPreviewState', 'readStored', 'writeStored', 'teardown', 'revertPreview',
];

/** INTERFACE §3.10 壳（铁律 1）—— lib/client.js 前 3 行与尾串 */
export const SHELL_LINES = [
  `window.__ModuleLoader__.load({ id: "${PKG_NAME}", factory: (require) => {`,
  'var module = { exports: {} }; var exports = module.exports;',
  "const React = require('react');",
];
export const SHELL_TAIL = 'return module.exports; } });';
/** §3.10 / §3.11 P5 —— 不可协商兜底上限 */
export const CLIENT_JS_HARD_MAX_BYTES = 921600;

/** INTERFACE §3.11 —— 性能门禁数值 */
export const PERF = {
  backdropFilterTotalMax: 12,
  backdropFilterPerSkinMax: 4,
  entryClosedMaxNodes: 10,
  skinJsonCount: 9,
  memoizedParseCalls: 1,
};
