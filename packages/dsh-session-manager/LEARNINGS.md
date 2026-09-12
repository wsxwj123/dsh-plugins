# LEARNINGS — dsh-session-manager（项目专属）

## lib/ 是不入库的构建产物：测试脚本自己先 build（2026-08-17 修正，原为"入库"）
- 现象：`tests/unit/*.test.js` / `tests/integration/*` 直接 import `lib/*.js`，而 `.gitignore`
  忽略 `lib/`，测试脚本又不带构建——新克隆的工作树里这些测试一条也跑不起来（MODULE_NOT_FOUND），
  产物落后时更糟：全绿但测的是旧代码。三方口径矛盾（gitignore ∥ 测试 import ∥ 本文件旧说法）。
- 现行规则：`lib/` **不入库**（`.gitignore` 保持忽略，构建产物不进 git），
  `package.json` 的 `pretest:unit` / `pretest:integration` 先跑 `npm run build`，
  所以 `npm run test:unit` / `test:integration` 永远测的是当前源码。
  手工直接 `node --test tests/unit/...` 时要自己先 `npm run build`。
- 发布 / Git 安装：包必须声明 `"prepare": "node build.mjs"`。pnpm 安装 Git 依赖时只自动跑 `prepare`；缺失时 `lib/` 不会生成，dsh-market 会报 "nothing installable"（issue #3）。改完 `build` 脚本时必须同步检查 `prepare`。
- 反例（勿回退）：靠"记得 git add lib/"来保证一致性——漏一次就得到假绿。
- 本仓库 `test:unit` 脚本硬编码文件列表（package.json scripts）：新增单测文件需改
  package.json（红线需用户确认），新断言优先复用现有测试文件，不要为此动 package.json。

## 单测里 fire stub 的默认行为
- `tests/unit/pendingDeletes.unit.test.js` 的 `makeDeps()` 默认 `fire` 返回 `{ ok: true }`。
  测 failed/cleanup 状态时若不覆盖 fire，断言会拿到"成功清除"而非预期状态——写新用例前先想清楚 fire 要返回什么。

## 浏览器模块身份 = 包名，PLUGIN_ID 必须从 package.json 派生（2026-09-12）
- 现象：dsh 0.1.5 web 全页报 `loaded without registering "@wsxwj123/dsh-session-manager"
  via __ModuleLoader__.load`，仅此一个 scoped 插件失败。
- 契约：宿主把 Loader 条目解析到包后，用 **manifest 包名** 作为 boot-graph 行 id
  （`dsh-client-modules/lib/index.js` 的 `graphRow(packageName, ...)`）；
  浏览器侧 `arrive(row)` 要求 bundle 执行时 `window.__ModuleLoader__.load`
  注册**完全相同**的 id，缺了即抛上述错误。非 scoped 包名恰与短 id 相同所以从不暴露。
- 根因：commit 52b518d 把包改名为 `@wsxwj123/…` 时没同步 tsdown.config.mjs 里
  硬编码的 `PLUGIN_ID = 'dsh-session-manager'`。
- 现行规则：`PLUGIN_ID = requireFromHere('./package.json').name`——**永远不要硬编码
  插件 id**，重命名包名时构建产物身份必须自动跟随。`data-plugin`/`data-plugin-css`
  标签 id 也由它派生，与 genui 的全名约定一致。
- 完整取证见 `.devflow/DIAGNOSIS-20260912.md`。
