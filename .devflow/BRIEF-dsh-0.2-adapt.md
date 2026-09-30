# BRIEF — 桌面端 DSH 0.2 适配（dsh-turn-scrubber / dsh-composer-tools / dsh-appearance-gallery）

任务日期：2026-09-30 ｜ 工作区：`~/Desktop/app/dsh-plugins-wt-0.2`（worktree，分支 `fix/dsh-0.2-adapt`，基线 `aea84ea`）
任务分级：标准任务（多模块 + 发布 + 外部网络）｜ 走 dev-flow，修 bug 模式为主

---

## 1. 要解决的问题

三个自研 DSH 插件在 DeepSeek Harness **桌面版 0.2.0-rc.2** 上存在问题，目标是修好并推到 GitHub。

| 包 | 现象 | 类型 |
|---|---|---|
| `packages/dsh-turn-scrubber` | 启动即挂：`Error: cannot get property "webServer" without inject`（`lib/index.js:216` 调 `ctx.connection.rpc.handle`） | 修 bug |
| `packages/dsh-composer-tools` | 「指令/提示词」面板显示「无当前会话目录」，读不到全局 `~/.dsh/AGENTS.md` | 修 bug |
| `packages/dsh-appearance-gallery` | 能加载，但 3 个 `@deepseek-ai/dsh-client-ui-*` peer 写死 `^0.1.0-rc.6`，需 profile 版本豁免才能装 | 适配（去掉豁免） |

## 2. 输入与产出

- 输入：`ctx.sessions.list` 快照（会话 id + cwd 元数据）、DSH webServer RPC 通道、插件 peer 声明
- 产出：三个包的新版本（同一分支同一 PR），装进本机 desktop profile 后**真机可用**

## 3. 成功标准（用户已拍板：真机 UI 实测）

1. `dsh-turn-scrubber`：桌面版启动审计 0 条 `did not activate`；会话内 turn 索引功能可用（前端能取到索引数据）
2. `dsh-composer-tools`：真机点开「指令 / 提示词」面板，**能看到 `~/.dsh/AGENTS.md`**（global 级）并能在编辑器里打开
3. `dsh-appearance-gallery`：**去掉 profile 版本豁免后仍能加载**；真机点开皮肤/主题面板能切换且生效
4. 不回归：三个包现有测试全绿；`dsh web`（0.1.5）下三个插件仍能正常工作
5. 脱敏：本次新增/修改的文件里不出现密钥、令牌、个人绝对路径、个人邮箱

## 4. 边界（不做什么）

- 不改 DSH 宿主本身（只改这三个自研包）
- 不重写 git 历史（未授权）；提交者邮箱保持原样
- 不碰 `dsh-pet-bridge`、`dsh-session-manager`（本次不在范围）
- 不动主 clone 里 composer-tools 的 3 个已改 `.devflow` 文件 + 1 个未跟踪文件（属另一条未完的线）

## 5. 敏感面声明（怎么做保证不越权/不泄露）

| 敏感面 | 保证方式 |
|---|---|
| 推 GitHub（远端写操作） | 走 SSH 别名远端；推前 `git ls-remote` 核实基线；不 `push -f`、不 `reset --hard`（红线） |
| 本机 profile 安装（link 依赖） | 只用 `dsh plugin --profile desktop add/remove`，不在 profile 目录跑 `pnpm install`；装完按仓库 LEARNINGS 检查 `@deepseek-ai` 副本数 |
| 个人路径/邮箱泄漏 | 推前对 `git diff` 跑脱敏扫描（`\/Users\/<用户名>`、邮箱、`sk-`/`ghp_`/私钥），命中即改 |
| 用户既有 AGENTS.md 内容 | 只读不改；不在任何产物里复制其内容 |

## 6. 已证实的关键事实（来自三份独立调研，详见 `.devflow/RESEARCH-*-0.2.md`）

1. **0.2 的 `sessions.list` 快照删掉了 `current` 字段**（`byId[id].cwd` 仍在）。composer-tools 的 `snapshot.current` 恒为 `undefined` → cwd 恒 `undefined`。0.2 正确取法是 session 作用域标准 prop `sessionId`。
   - **两个症状同一根因（盲审 I1 要求闭合因果链，证据已核）**：`packages/dsh-composer-tools/src/client/InstructionsTab.tsx:80-84` 里 `if (cwd === undefined) { setFiles([]); setCanCreateRootAgents(false); setCanCreateGlobalAgents(false); setPhase('no-cwd') }` —— cwd 为 undefined 时**整个列表（含 global 文件）既不渲染也不请求**，所以「看不到全局 AGENTS.md」与「显示无当前会话目录」是同一个短路造成的，修 `sessionId→cwd` 一处即覆盖两者，不设第二个修复点。
   - 旁证：host 侧的发现函数本身是好的——主会话直接调用 `discoverInstructions({cwd, dshHome:'~/.dsh'})` 能正确返回 `~/.dsh/AGENTS.md`（`level: global`，9067 字节）。
2. **0.2 的 `rpc.handle()` → `register()` 无条件读调用方上下文的 `webServer`**（`dsh-client-connection/lib/index.js:656`），0.1.5 有 `this.webCtx` 回退（`:618`）所以旧版不需要注入。修法：inject 加 `'webServer'`，两版都安全。
3. **appearance-gallery 消费的 5 个 API 在 0.1.5→0.2 全部未变**，只要把 peer 范围改到 `^0.2.0-rc.1`，代码不用动。

## 7. 约束

- 双版本兼容（0.1.5 与 0.2.0-rc.2 都要能跑）
- 构建：各包用自带 `build.mjs`（产物 `lib/`）；改完必须重新构建再验证
- 遵循仓库 `LEARNINGS.md` 与根 `.devflow/` 既有约定

## 8. 卡点1 用户补充决策（2026-09-30）

1. **版本号 bump patch**：三个包各 bump 一个 patch（`dsh-turn-scrubber` 0.2.0→0.2.1、`dsh-appearance-gallery` 1.0.1→1.0.2、`dsh-composer-tools` 0.1.0→0.1.1），让"适配 0.2"在版本上可见。
2. **脱敏固化为自动闸门**：在仓库里加推送前自动扫描（`\/Users\/<用户名>`、邮箱、`sk-`/`ghp_`/私钥等模式），命中即拦下，不再依赖人工记得。这是用户明确授权的配置改动（超出方案代理默认的"不采纳 S5"）。
3. turn-scrubber 死参数 `{authority:'loopback'}`：**采纳方案**，删掉并补 A7 运行时断言。
