# dsh web 全插件加载失败诊断：session-manager 注册 ID 与包名漂移（2026-09-12）

## 现象

`dsh web`（端口 3080，dsh 0.1.5-rc.1）页面报错，HARNESS 面板显示 "Failed to load plugins"：

```
failed to import loader entry a0a8ea21 (@wsxwj123/dsh-session-manager):
client-modules: bundle /plugins/??@deepseek-ai/dsh-api-gateway/client.js,...
  &rev=4f87b67b8bd0
loaded without registering "@wsxwj123/dsh-session-manager" via __ModuleLoader__.load
```

同一 combo 里的其余几十个插件均正常，只有这一个 scoped 包失败。

## 证据链

1. **报错来自浏览器加载器校验**：`@deepseek-ai/dsh-client-modules/lib/client.js:248`
   `arrive(row)` 在 bundle 执行完后检查 `this.factories.has(row.id)`，缺失即抛本错误。
2. **行 id = 解析后的包名（宿主侧裁决）**：`dsh-client-modules/lib/index.js:826`
   `this.table.set(packageName, { entry: graphRow(packageName, rev, ...) })`，
   `graphRow(id,...)` 直接把第一个参数作为 `row.id`。README 也写明
   "解析出的 manifest 包名作为浏览器模块身份"。
3. **插件注册的是旧扁平名**：`packages/dsh-session-manager/tsdown.config.mjs:58`
   `const PLUGIN_ID = 'dsh-session-manager'`，通过 banner 写进产物头
   `window.__ModuleLoader__.load({ id: "dsh-session-manager", ... })` →
   `register()` 存的键是 `stripClientSuffix("dsh-session-manager")` = 旧名，
   与行 id `@wsxwj123/dsh-session-manager` 永不相等。
4. **漂移点在 git 历史里**：commit `52b518d`（"session-manager 改用作用域名
   @wsxwj123/dsh-session-manager（扁平名已被他人占用）"）只改了 package.json 的
   `name`，没有同步 tsdown.config.mjs 里硬编码的 PLUGIN_ID。
5. **横向对照排除其他假设**：同为 scoped 的 `@liustack/modlens`（手写
   `id: '@liustack/modlens'`）、`@changfenhuang/dsh-genui`（
   `id:\`@changfenhuang/dsh-genui\``）、`@dsh-external/dsh-automation` 都注册
   全名且正常加载；非 scoped 插件（dsh-composer-tools 等）包名恰与短 id 相同，
   所以从未暴露。

## 修复

`tsdown.config.mjs` 不再硬编码，改从 package.json 派生（requireFromHere 已在
配置顶部可用，零新增依赖）：

```js
const PLUGIN_ID = requireFromHere('./package.json').name
```

副作用一致：`makeCssPlugin(PLUGIN_ID)` 的 `data-plugin` / `data-plugin-css`
标签 id 同步变为全名，与 genui 的现有约定（`dataset.plugin='@changfenhuang/dsh-genui'`）相同。

三份工作树（app/dsh-plugins、app/dsh-plugins-runtime、claude/dsh-plugins）的
config 均已同步修复；仅 web profile 实际链接的 app/dsh-plugins 完成了重建。

## 验证

- 重建产物头部：`window.__ModuleLoader__.load({ id: "@wsxwj123/dsh-session-manager", ... })`。
- 离线模拟浏览器 loader（stub `window.__ModuleLoader__` 后 import 产物）：
  注册 id 与宿主 boot-graph 行 id 精确相等，factory 为 function。
- `npm run test:unit`：127/127 通过（测试前自动重建，测的即当前源码）。
- 运行中的 3080 进程在启动时快照 bundle，需重启 `dsh web` + 强刷浏览器后生效。

## 防回归

- PLUGIN_ID 从 package.json 派生后，包名再怎么改都不会漂移（本缺陷的结构性根因已消除）。
- 若想加自动化断言：单测里可对 `lib/client.js` 头部做一次
  `id` === `package.json.name` 的廉价 grep 断言（当前测试清单是硬编码的，
  新增文件需动 package.json，故本次未加，留作可选项）。
