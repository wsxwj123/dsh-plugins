# Project learnings

- Theme family selection and appearance mode are separate concerns: the plugin selects a family with `overrideTokens()`, while DSH owns Light, Dark, and Follow system.
- Every public family must provide complete `{ light, dark }` token pairs; do not expose single-mode families when native system following is required.
- Keep the public gallery small and visually distinct. Editor syntax-theme differences often collapse into near-duplicate conversational UI palettes.
- Public package metadata, theme IDs, generated data, documentation, and Git authorship must remain source-neutral and privacy-safe.

## dsh-session-manager 开发教训（2026-08-14）

- **同一仓库并行开发两个插件分支（theme-gallery 的 feature/full-skin-replica 与 dsh-session-manager 的 feat/）会互相"顶掉"工作树**：切换分支后另一分支的未跟踪目录会"消失"，已提交文件则随分支切换不见，容易误判为丢失。已发生两次（子代理会话开始时工作树被切到 main / feature/full-skin-replica）。缓解：并行开发前先确认当前分支；用 `git reflog` 排查"文件消失"；分仓库或 worktree 隔离更稳。
- **`node --test <目录>` 会把目录当模块报 MODULE_NOT_FOUND**（node v25），必须用 glob（`node --test "tests/**/*.test.js"`）或 `node --test` 自动发现。
- **官方 `connection.rpc.handle` 是 envelope 协议（{type,rpcId,method,payload}），不是裸 HTTP**——自定义 HTTP 契约的插件要么走裸路由+自实现 fence，要么重写契约迁就官方协议，二者不可兼得（本插件选了前者）。
- **DSH 真实会话目录名是编码名（projectKey→`--…--`、encodeSegment→`~XXXX`），字面 join(root,cwd,id) 定位不到**——按契约写的路径解析必须在真实环境联调验证。

## [LRN-20260817] client 懒加载入口包必须自带 __ModuleLoader__ 注册壳（skin-gallery 实爆）
- 现象：dsh 启动报 `failed to import loader entry (dsh-skin-gallery): client-modules: bundle loaded without registering "dsh-skin-gallery" via __ModuleLoader__.load`，皮肤设置项不加载。
- 根因：懒加载拆分重构（9d4743a/ce1151f）后 lib/client.js 手工产出，丢了包装壳。dsh 校验的是 bundle 执行后必须调 `window.__ModuleLoader__.load({ id: "<包名>", factory: (require) => {...} })` 自注册；壳内还需 `const React = require('react')`（裸代码直接用 React）。
- 铁律：**lib/client.js ≠ src/client.js**——lib 版必须比 src 多包一层壳（参照 theme-gallery / skin-runtime 的 lib/client.js 头尾）。"align source with built bundle" 时严禁把 lib 直接覆盖成 src 原文。
- 已修：2026-08-17 给 lib/client.js 补壳（未提交，见 git diff）。
