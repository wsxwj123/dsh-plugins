// 校验参考桩 —— 严格按 INTERFACE §3.6 / §3.7 的校验顺序实现，短路在第一处失败。
// 这是"契约的镜子"：INTERFACE 没写的行为一律 throw HARNESS_UNDEFINED，不许自行发明。
import {
  ERR, ID_RE, THEME_LABEL_MAX, TOKEN_PREFIX, BUILTIN_THEME_IDS, BUILTIN_SKIN_IDS,
  MAX_BUNDLE_B64, MAX_A11Y_BYTES, MAX_CUSTOM_COUNT, DANGEROUS_SUBSTRINGS,
  CTX_WHITELIST, SKIN_REQUIRED_META,
} from './contract.mjs';

export function codedError(code, message) {
  const e = new Error(message);
  e.code = code;
  return e;
}
export function undefinedBehavior(what) {
  const e = new Error(`HARNESS_UNDEFINED: INTERFACE 未定义「${what}」，harness 拒绝自行发明`);
  e.code = 'HARNESS_UNDEFINED';
  return e;
}

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const nonEmptyString = (v) => typeof v === 'string' && v.length > 0;

export const b64Len = (text) => Buffer.from(text, 'utf8').toString('base64').length;
export const byteLen = (text) => Buffer.byteLength(text, 'utf8');

// ---------------------------------------------------------------- 主题 §3.6
export function validateTheme(jsonText) {
  let parsed;
  try {
    parsed = JSON.parse(jsonText);                                   // 顺序 1
  } catch {
    throw codedError(ERR.IMPORT_INVALID_JSON, '主题 JSON 解析失败');
  }
  if (!isPlainObject(parsed)) {                                      // 顺序 2
    throw codedError(ERR.IMPORT_INVALID_JSON, '主题 JSON 不是对象');
  }
  const { id, label, tokens } = parsed;
  const tokensEmpty = !isPlainObject(tokens) || Object.keys(tokens).length === 0;
  if (!nonEmptyString(id) || !nonEmptyString(label) || tokensEmpty) { // 顺序 3
    throw codedError(ERR.THEME_MISSING_FIELD, '缺少 id / label / tokens');
  }
  if (!ID_RE.test(id)) {                                             // 顺序 4
    throw codedError(ERR.THEME_MISSING_FIELD, `id 非法：${id}`);
  }
  if (label.length > THEME_LABEL_MAX) {                              // 顺序 5
    throw codedError(ERR.THEME_MISSING_FIELD, `label 超过 ${THEME_LABEL_MAX} 字符`);
  }
  if (BUILTIN_THEME_IDS.includes(id)) {                              // 顺序 6
    throw codedError(ERR.THEME_ID_CONFLICT, `id 与内置主题冲突：${id}`);
  }
  for (const [k, v] of Object.entries(tokens)) {                     // 顺序 7
    if (!k.startsWith(TOKEN_PREFIX)) {
      throw codedError(ERR.THEME_BAD_TOKEN, `token 键须以 ${TOKEN_PREFIX} 开头：${k}`);
    }
    if (!isPlainObject(v) || !nonEmptyString(v.light) || !nonEmptyString(v.dark)) {
      throw codedError(ERR.THEME_BAD_TOKEN, `token 值须是 {light,dark} 非空字符串：${k}`);
    }
  }
  for (const [k, v] of Object.entries(tokens)) {                     // 顺序 8
    for (const raw of [v.light, v.dark]) {
      if (raw.includes('}') || raw.slice(0, -1).includes(';')) {
        throw codedError(ERR.THEME_BAD_TOKEN, `token 值含危险字符：${k}`);
      }
    }
  }
  return { id, label, tokens };
}

// ---------------------------------------------------------------- 皮肤 §3.7
const parenBalanced = (text) => {
  let depth = 0;
  for (const ch of text) {
    if (ch === '(') depth += 1;
    else if (ch === ')') { depth -= 1; if (depth < 0) return false; }
  }
  return depth === 0;
};
const EXPORTS_APPLY = [/\bapply\s*(\{|:)/, /function\s+apply/];
const CTX_RE = /ctx\.([A-Za-z_$][\w$]*)/g;
const REMOTE_URL_RE = /url\(\s*['"]?\s*(https?:|\/\/)/i;

/**
 * @param parts {{skin:string, client:string, a11y?:string}}
 * @param existingIds 已有自定义皮肤 id 列表（判数量上限 / 覆盖）
 */
export function validateBundle(parts, existingIds = []) {
  const { skin, client, a11y } = parts || {};
  if (!skin || !client) {                                            // 顺序 1
    throw codedError(ERR.SKIN_MISSING_FILE, '缺少 skin.json 或 client.js');
  }
  let meta;
  try {
    meta = JSON.parse(String(skin));                                 // 顺序 2
  } catch {
    throw codedError(ERR.IMPORT_INVALID_JSON, 'skin.json 解析失败');
  }
  if (!isPlainObject(meta)) {
    throw codedError(ERR.IMPORT_INVALID_JSON, 'skin.json 不是对象');
  }
  for (const f of SKIN_REQUIRED_META) {                              // 顺序 3
    if (!nonEmptyString(meta[f])) {
      throw codedError(ERR.SKIN_BAD_META, `缺少必填字段：${f}`);
    }
  }
  if (!ID_RE.test(meta.id)) {                                        // 顺序 4
    throw codedError(ERR.SKIN_BAD_META, `id 非法：${meta.id}`);
  }
  if (BUILTIN_SKIN_IDS.includes(meta.id)) {                          // 顺序 5
    throw codedError(ERR.THEME_ID_CONFLICT, `id 与内置皮肤冲突：${meta.id}`);
  }
  if (typeof client !== 'string' || client.length === 0) {            // 顺序 6
    throw codedError(ERR.SKIN_CONTRACT, 'client.js 必须是非空字符串');
  }
  if (!client.includes('window.__ModuleLoader__.load({')
      || !client.includes('factory')
      || !parenBalanced(client)) {                                   // 顺序 7
    throw codedError(ERR.SKIN_CONTRACT, 'client.js 不满足 __ModuleLoader__ 契约');
  }
  for (const bad of DANGEROUS_SUBSTRINGS) {                          // 顺序 8
    if (client.includes(bad)) {
      throw codedError(ERR.SKIN_DANGEROUS, `命中高危 API：${bad}`);
    }
  }
  if (!EXPORTS_APPLY.some((re) => re.test(client))) {                 // 顺序 9
    throw codedError(ERR.SKIN_CONTRACT, 'client.js 未导出 apply');
  }
  CTX_RE.lastIndex = 0;
  let m;
  while ((m = CTX_RE.exec(client)) !== null) {                        // 顺序 10
    if (!CTX_WHITELIST.includes(m[1])) {
      throw codedError(ERR.SKIN_CONTRACT, `使用了白名单外的 ctx.${m[1]}`);
    }
  }
  if (b64Len(String(skin) + client) > MAX_BUNDLE_B64) {               // 顺序 11
    throw codedError(ERR.SKIN_SIZE, `bundle 超过 ${MAX_BUNDLE_B64} B`);
  }
  const a11yText = typeof a11y === 'string' ? a11y : '';             // 非字符串静默降级
  if (byteLen(a11yText) > MAX_A11Y_BYTES) {                          // 顺序 12
    throw codedError(ERR.SKIN_SIZE, `a11y.css 超过 ${MAX_A11Y_BYTES} B`);
  }
  if (a11yText.includes('@import') || REMOTE_URL_RE.test(a11yText)) { // 顺序 13
    throw codedError(ERR.SKIN_DANGEROUS, 'a11y.css 含 @import 或远程 url()');
  }
  const isNew = !existingIds.includes(meta.id);
  if (isNew && existingIds.length >= MAX_CUSTOM_COUNT) {             // 顺序 14
    throw codedError(ERR.SKIN_COUNT, `自定义皮肤数不得超过 ${MAX_CUSTOM_COUNT}`);
  }
  return {
    id: meta.id,
    name: meta.name,
    nameEn: typeof meta.nameEn === 'string' ? meta.nameEn : '',
    author: meta.author,
    license: meta.license,
    accent: typeof meta.accent === 'string' ? meta.accent : '',
    bodyAttr: nonEmptyString(meta.bodyAttr) ? meta.bodyAttr : `data-dsh-${meta.id}`,
    order: typeof meta.order === 'number' ? meta.order : 100 + existingIds.length,
    source: 'custom',
    bundleText: client,
    a11yText,
  };
}
