# BRIEF — 主题与皮肤系统完善

## 目标

在 `packages/theme-gallery` 与 `packages/skin-gallery` 两个独立包中完成一套可维护的外观系统：

1. 主题包保持轻量，设置页滚动不卡；
2. 皮肤包独立承载完整皮肤，不影响主题列表性能；
3. 主题与皮肤都提供自定义入口、导入、试穿、应用、删除、恢复默认；
4. 已有 9 个皮肤支持试穿与应用；
5. 自定义主题必须是 CSS-only，禁止执行任意 JS；
6. 自定义皮肤使用受控包格式：`skin.json`、`client.js`、`a11y.css`；
7. 保留上游作者与 BSD-3-Clause 声明。

## 状态机

主题：`none` / `preview` / `applied` / `deleted`。
皮肤：`none` / `preview` / `applied` / `deleted`。

## 自定义主题格式

第一版只支持 JSON 导入：必须含 `id`、`label`、`tokens`；token 名必须以 `--dsw-` 开头；每个 token 必须提供 `light` 和 `dark` 字符串；不执行 JavaScript。

## 自定义皮肤包格式

```text
my-skin/
├── skin.json
├── client.js
└── a11y.css
```

`client.js` 必须注册 `window.__ModuleLoader__.load({ id, factory })` 并导出 `apply(ctx)`；所有 DOM、CSS、事件和定时器必须通过 `ctx.effect()` 可逆。不符合契约或存在高危能力的包拒绝导入。

## 性能约束

主题/皮肤列表不使用内部滚动容器；主题包 bundle 目标小于 100KB；皮肤 bundle 只在需要时执行；插件停止后无样式、DOM、body 属性残留。

## 验收标准

已有皮肤有试穿和应用按钮；自定义主题可导入、试穿、应用、删除、恢复默认；自定义皮肤包可导入、试穿、应用、删除、恢复默认；非法导入不改变当前外观；测试覆盖状态机、互斥、导入校验、删除、恢复默认；README 明确交付格式；构建和测试通过。
