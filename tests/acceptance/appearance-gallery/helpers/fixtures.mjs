// 测试数据构造器。合法样本必须"刚好"满足 INTERFACE 的全部门禁，非法样本每次只破坏一条。

/** 合法自定义主题 JSON 文本 */
export function themeJson(over = {}) {
  return JSON.stringify({
    id: 'mine', label: '我的主题',
    tokens: { '--dsw-bg': { light: '#ffffff', dark: '#101010' } },
    ...over,
  });
}

/**
 * 合法 client.js 文本：含 `window.__ModuleLoader__.load({` + `factory`、括号配平、
 * 导出 apply、只用 ctx.effect/ctx.get、不命中 12 条黑名单。
 */
export function clientJs(id = 'demo', extra = '') {
  return [
    `window.__ModuleLoader__.load({ id: "dsh-skin-${id}", factory: (require) => {`,
    '  function apply(ctx) { ctx.effect(() => {}); }',
    `  ${extra}`,
    '  return { apply: apply };',
    '} });',
  ].join('\n');
}

/** 合法 skin.json 文本 */
export function skinJson(over = {}) {
  return JSON.stringify({ id: 'demo', name: '演示皮肤', author: '我', license: 'MIT', ...over });
}

/** 合法三件套 */
export function skinParts(over = {}) {
  const id = over.id || 'demo';
  // 用 in 判断而不是 !== undefined —— 否则 {skin: undefined} 这种"显式传 undefined"的用例会被默认值吃掉
  return {
    skin: 'skin' in over ? over.skin : skinJson(over.meta || { id }),
    client: 'client' in over ? over.client : clientJs(id),
    a11y: 'a11y' in over ? over.a11y : ':root{--dsh-focus:2px}',
  };
}

/** 造一个正好 n 字节（ASCII）的字符串 */
export const bytes = (n, ch = 'a') => ch.repeat(n);

/** 造 n 个已存在的自定义皮肤 registry 值 */
export function skinRegistry(ids) {
  return JSON.stringify({
    version: 1,
    items: ids.map((id, i) => ({
      id, name: id, nameEn: id, author: 'a', license: 'MIT', accent: '',
      bodyAttr: `data-dsh-${id}`, order: 100 + i, source: 'custom',
      bundleText: clientJs(id), a11yText: '',
    })),
  });
}

/** 造自定义主题 registry 值 */
export function themeRegistry(items) {
  return JSON.stringify({
    version: 1,
    items: items.map((it) => (typeof it === 'string'
      ? { id: it, label: it, tokens: { '--dsw-bg': { light: '#fff', dark: '#000' } } }
      : it)),
  });
}
