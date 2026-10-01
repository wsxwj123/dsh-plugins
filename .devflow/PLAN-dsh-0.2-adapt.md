# PLAN — 桌面端 DSH 0.2 适配（dsh-turn-scrubber / dsh-composer-tools / dsh-appearance-gallery）

> 基线：worktree `fix/dsh-0.2-adapt` @ `aea84ea`。任务分级：标准任务·修 bug 模式（BRIEF §0）。
> 本文所有结论基于三份调研报告（`.devflow/RESEARCH-*-0.2.md`），不凭记忆猜 API。
> 对外接口详细契约见 `.devflow/INTERFACE-dsh-0.2-adapt.md`。

## 1. 架构与技术选型

总原则：三个改动各自都是「一处根因、一行/一字段修复」，不新增模块、不重构、不引入扩展点。

### 1.1 dsh-turn-scrubber —— inject 补 `webServer` + 删死参数

**修法**（`src/index.ts`，共 3 处同文件改动）：
1. `inject` 数组加 `'webServer'`（`['connection','sessionPersistence','sessions','webServer']`）。
2. `NodeContext.connection.rpc.handle` 的类型签名删掉 `options?` 形参。
3. `apply()` 里 `rpc.handle('/turn-scrubber', turnIndexHandler(ctx), { authority: 'loopback' })` 删掉第三参。

**为什么选这个修法（而不是别的）**：
- 根因是 0.2 的 `register()` **无条件**读 `owner.webServer`，而 `owner` 经 cordis `createTraceable` 被覆写为**调用方 ctx**，所以调用方必须注入 `webServer`（RESEARCH-turn-scrubber-inject-0.2.md:11-12、:38、:59-109）。
- 「加 inject」即充分：`owner.webServer` 命中 `dsh-host-webserver` 提供的服务，`.register(route)` 正常挂 `/turn-scrubber` 前缀路由（RESEARCH:115-139）。
- **不换 API**：`rpc.handle` 是「专用 RPC 通道」的唯一注册入口，客户端 `connection.rpc.call('/turn-scrubber', …)` 正依赖它，0.2 无 deprecation 标记（RESEARCH:169）。
- **不选 RESEARCH:286-303 的 §5.2 子上下文注入**：5.1 更短、与 0.1.5 双向兼容，是首选（RESEARCH:303）。
- **0.1.5 安全**：旧版 `register()` 用 `(this.webCtx ?? owner).webServer` 回退，本就不需要注入；多加一个已存在的 `webServer` 服务与回退**并存不冲突**（RESEARCH:198、:213-220）。

**死参数 `{ authority: 'loopback' }` 的明确决定：本次删除**。理由：(a) 0.1.5/0.2 的 `handle` 都是二参签名，第三参被静默忽略（RESEARCH:173-182）；(b) 保留会误导读者以为有 authority 级隔离，而真实 loopback 隔离由宿主 RPC 通道边界决定，与该参数无关；(c) 删它与本次改动同文件同函数（正好要改这一行调用），是「清理本次触及的死代码」而非扩大面；(d) 调研 §5.1 明确建议一并删（RESEARCH:265-270）。同步删类型签名里的 `options`，避免 tsc 类型面失真。

### 1.2 dsh-composer-tools —— sessionId 改读标准 slot prop

**修法**（2 文件）：
1. `src/client/ComposerEntry.tsx`：`EntryProps` 加 `sessionId?: string`；`const sessionId = snapshot.current` 改为 `const sessionId = props.sessionId ?? snapshot.current`。第 180 行 `cwd` 推导不动。
2. `src/client/context-types.ts`：`SessionSummary.cwd` 改可选；`SessionListSnapshot.current` 标注 0.1.5-only；补 `parentId?`、`retainedBy?`（0.2 新增字段的类型对齐，不改变运行时行为）。

**为什么选这个修法（而不是别的）**：
- 根因：0.2 的 `sessions.list` 快照**删除了 `current` 字段**（不是改名），`byId[id].cwd` 仍在；插件 `snapshot.current` 恒 undefined，三元在查 `byId` 前短路返回 undefined（RESEARCH-ct-cwd-0.2.md:12-14、:83-92、:157-164）。
- 正确取法 = 读 session 作用域标准 slot prop `sessionId` → `byId[sessionId]?.cwd`，这是**官方 UI 自己的写法**，且 `sessionId` prop 在 0.1.5/0.2 都由 `dsh-client-ui-session` 提供（RESEARCH:203-244、:301）。
- **两个症状共用同一根因（I1 因果链已闭合，主会话读源码证实）**：`src/client/InstructionsTab.tsx:80-84` 在 `cwd === undefined` 时直接 `setFiles([])` 并 `setPhase('no-cwd')`、`return`——即**整个列表（含 global `~/.dsh/AGENTS.md`）根本不会被渲染或请求**。「无当前会话目录」与「读不到全局 AGENTS.md」是同一处 `cwd === undefined` 短路的下游结果，**不存在第二个独立 bug**，一行修复（sessionId→cwd）同时覆盖两条症状，无需把全局 AGENTS.md 列为独立修复点。
- 兜底 `snapshot.current` 仅在 `props.sessionId === undefined` 时执行；但 0.1.5 也由 `dsh-client-ui-session` 提供 `sessionId` prop（RESEARCH:239-244），故正常运行时该分支在两版都是**死代码**，仅作「sessionId prop 未下发」的防御兜底（RESEARCH:333-334）。**S4 弃用 TODO**：改代码时在此处及 `context-types.ts` 的 `current` 字段标注旁加 `// TODO(0.3): drop snapshot.current fallback — dead on 0.1.5/0.2 since sessionId prop is always provided`。
- 对比表结论（RESEARCH:392-396）：不用 `retainedBy.mainView` 派生（0.1.5 无 `retainedBy`，需双分支，行 C）；不用 `remote.session.list` RPC（多一次往返且无「当前会话」概念，行 D）；不用 `scopeOf(ctx)`（根 ctx 无 sessionId tag，行 E）。

### 1.3 dsh-appearance-gallery —— 只改 peer 范围，代码零改动

**修法**（`package.json`，3 处 peer 同步改）：
```
@deepseek-ai/dsh-client-ui-theme    ^0.1.0-rc.6  →  ^0.1.0-rc.6 || ^0.2.0-rc.1
@deepseek-ai/dsh-client-ui-settings ^0.1.0-rc.6  →  ^0.1.0-rc.6 || ^0.2.0-rc.1
@deepseek-ai/dsh-client-ui-slots    ^0.1.0-rc.6  →  ^0.1.0-rc.6 || ^0.2.0-rc.1
```
`cordis`（`^4.0.1`）/ `react`（`^18.0.0 || ^19.0.0`）/ `peerDependenciesMeta` 不动。

**为什么选这个修法（而不是别的）**：
- 插件运行时消费的 5 个 API（`theme.overrideTokens`、`slots.inject/register`、`settings.general.item` 槽名、`modules`、`__ModuleLoader__`）在 0.1.5→0.2 **全部存在、签名未变、语义未变**，故代码不动（RESEARCH-appearance-gallery-0.2.md:131-133、:195）。
- **peer 双区间是确定答案（I4 已解决，主会话实测 DSH 判定）**：DSH 自己的兼容性检查在 `app.asar/dsh/node_modules/@deepseek-ai/dsh-app-boot/lib/index.js:300` 用的是 `semver.satisfies(runtimeVersion, requirement, { includePrerelease: true })`。按此模式复算：`^0.1.0-rc.6` → 0.1.5-rc.2 ✓ / 0.2.0-rc.2 ✗；`^0.2.0-rc.1` → 0.1.5-rc.2 ✗ / 0.2.0-rc.2 ✓；`^0.1.0-rc.6 || ^0.2.0-rc.1` → **两版都 ✓**。故写双区间同时满足成功标准 #3（0.2 免豁免）与 #4（0.1.5 正常），**不需要降级成功标准 #4**。
- **S2 核实：无其它 `@deepseek-ai/*` 版本敏感依赖**。`package.json` 除 3 个 ui-* peer 外，唯一 `@deepseek-ai/*` 声明是 `@deepseek-ai/cordis` `^4.0.1`（两版 cordis 一致，不改、不触发豁免）；`react` 非 `@deepseek-ai/*`；`dsh.client.inject` 的 3 个 ui-* 是**软提示**（0.2 对缺失包 `if (dependency !== void 0)` 静默跳过，RESEARCH-appearance-gallery §3），不参与 peer 匹配、不触发豁免。故只改 3 个 ui-* peer 即完整覆盖。
- **不顺手清理** `src/client.js` 里 `overrideTokens` 的多余第三参 `themeId` 与 `?? __DSH_MODULES__` 死分支——研究 §5.2 标为「非必须」，本次为最小改动**不动**，避免扩大代码面。

**0.1.5 兼容已定（不再是未决点）**：peer 双区间经 DSH includePrerelease 语义实测同时满足 0.1.5-rc.2 与 0.2.0-rc.2，成功标准 #4 无需豁免、无需降级。唯一残留是 pnpm 可能用 node-semver 默认模式打一条 peer WARN（外观警告，见风险 R5），不算失败。

## 2. 文件结构

| 文件 | 性质 | 改动内容 |
|---|---|---|
| `packages/dsh-turn-scrubber/src/index.ts` | 改 | inject 加 `webServer`；handle 类型签名删 `options`；`rpc.handle` 调用删第三参 |
| `packages/dsh-composer-tools/src/client/ComposerEntry.tsx` | 改 | `EntryProps` 加 `sessionId?`；`sessionId = props.sessionId ?? snapshot.current` |
| `packages/dsh-composer-tools/src/client/context-types.ts` | 改 | `cwd` 改可选；`current` 标 0.1.5-only；补 `parentId?`/`retainedBy?` |
| `packages/dsh-appearance-gallery/package.json` | 改 | 3 个 ui-* peer 范围 `^0.1.0-rc.6` → `^0.1.0-rc.6 || ^0.2.0-rc.1` |
| `packages/dsh-turn-scrubber/lib/*` | 重建产物（非手改） | `node build.mjs` 重新生成 |
| `packages/dsh-composer-tools/lib/*` | 重建产物（非手改） | `node build.mjs` 重新生成 |

**新增源码文件：无。** 新增的是本任务的 `.devflow/PLAN-dsh-0.2-adapt.md` 与 `.devflow/INTERFACE-dsh-0.2-adapt.md` 两个文档（属交付物，非代码改动）。

**明确不动**（边界，防 scope creep）：
- 根 `PROJECT.md`（当前已 modified，属另一条未完的线，BRIEF §4）。
- `packages/dsh-composer-tools/LEARNINGS.md`。
- `dsh.client.inject` 里指向不存在的 `@deepseek-ai/dsh-client-runtime`（软提示，缺失静默跳过，RESEARCH-ct-cwd:18-33，非本次范围）。
- appearance-gallery `src/client.js` 的 `themeId` 死参数与 `__DSH_MODULES__` 死分支。
- 不 bump 各包 `version` 字段（本地 profile 靠 `dsh plugin add` 重挂 + 重建 `lib/` 生效；仅发布 npm 才需要版本号，本次目标「推 GitHub」不涉及）。**S1 措辞统一**：BRIEF §2 的「三个包的新版本」指「改后重挂的新构建/新代码」，≠ bump `version` 字段；本次只推 GitHub 不发布 npm，故只改代码不改 version，两者不矛盾。

## 3. 对外接口约定

一句话指针：**详细契约见 `.devflow/INTERFACE-dsh-0.2-adapt.md`**（供测试设计代理盲写测试）。

## 4. 任务拆解

三个包互不依赖，**可并行**。顺序依赖仅出现在「各包内：改 → build → 校验 → 真机装」。

```
[可并行] A. turn-scrubber      [可并行] B. composer-tools     [可并行] C. appearance-gallery
  A1 改 src/index.ts(3处)         B1 改 ComposerEntry+context-types   C1 改 package.json peer(3处)
  A2 node build.mjs + tsc check   B2 node build.mjs + tsc check       C2 build(--check 不需重建) + 语义校验
  A3 单测(既有 turn-index 等)     B3 单测(既有 9 个 unit)             C3 单测(既有 11 个 unit)
  └──────────┬────────────────────┴───────────┬────────────────────────┘
             └────────────► D. 0.2 真机安装 + e2e（三包一次装上验证）◄────
                                  └────────────► E. 0.1.5(dsh web) 回归 + 脱敏 + push
```

- **A（turn-scrubber）** 验收：`inject` 含 `webServer`（静态）；`rpc.handle` 无第三参、`NodeContext` 无 `options`（静态）；0.2 启动审计 0 条 `did not activate`、无 `webServer without inject`；`rpc.call('/turn-scrubber','turnIndex',{sessionId})` 对真实会话返回 `{ok:true,value:{...}}`；**删第三参后从非 loopback/非可信上下文调 `/turn-scrubber` 被拒（I3 运行时断言，INTERFACE A7）**；既有单测全绿。
- **B（composer-tools）** 验收：`EntryProps` 含 `sessionId?`、取值 `props.sessionId ?? snapshot.current`（静态）；0.2 真机打开「指令/提示词」面板显示会话目录（非「无当前会话目录」）且能列出并打开 `~/.dsh/AGENTS.md`；空白新会话 cwd=undefined 不崩；**sessionId prop 随会话切换变化**（e2e console.log 实测，这是 research §7 唯一未证实的推测，必验）；0.1.5 面板仍显示目录（不断言兜底分支被执行，见 S3）；既有单测全绿。
- **C（appearance-gallery）** 验收：三个 peer 双区间同时满足 `0.1.5-rc.2` 与 `0.2.0-rc.2`（DSH includePrerelease 语义）；去豁免后 0.2/0.1.5 仍能加载、DSH 启动审计无 peer 告警（pnpm 在 0.1.5 可能打 WARN，属预期，见 R5）；通用设置出现「打开外观设置」入口；功能闭环 5 条（切主题/切皮肤/试穿回滚/自定义导入并应用/恢复默认）无残留 style/body 属性；既有单测全绿。
- **D（0.2 真机）**：三包一起 `dsh plugin --profile desktop add/remove` 重挂 → 重启 → 逐条走 A/B/C 的 e2e 验收；装完按 LEARNINGS 检查 `@deepseek-ai` 副本是 symlink 非真目录。
- **E（回归 + 发布）**：`dsh web`(0.1.5) 下三插件回归（A/B 的 0.1.5 断言 + C 的 0.1.5 去豁免回归，见 C5）；`git diff` 脱敏扫描；`git ls-remote` 核实基线后走 SSH 别名远端 push。

## 5. 风险清单

### 非机械改动的失败模式与缓解

**R1（appearance-gallery，已定）peer 双区间 `^0.1.0-rc.6 || ^0.2.0-rc.1`（I4 已解决，不再是未决风险）。**
结论：DSH 判定用 `semver.satisfies(runtimeVersion, requirement, { includePrerelease: true })`（app.asar `dsh-app-boot/lib/index.js:300`，主会话实测），双区间对 `0.1.5-rc.2` 与 `0.2.0-rc.2` **均满足**，成功标准 #3/#4 同时成立，**不降级 #4**。
原「施工前二选一确认」取消——peer 直接写双区间，无需读 0.1.5 实际版本或查匹配模式。

**R2（composer-tools，未证实推测）`props.sessionId` 经第三方注册链路不落地。**
失败模式：research §7 推测 #2（RESEARCH-ct-cwd:429-430）——第三方插件 `ctx.slots.register` + `{...props}` 是否真的把 `sessionId` 传进组件 props 是「推断」，若 0.2 上不落地 → `sessionId` 仍 undefined → cwd 仍取不到。
缓解：e2e 第一步在 `ComposerEntry` 顶部临时 `console.log(props.sessionId)`，0.2 切几个会话观察是否随切换变化；若不落地，回退到 `byId[id].retainedBy.mainView > 0` 派生（0.2-only）+ 保留 `current` 兜底的双分支，但当前调研倾向 prop 会落地，先验后定，不提前写双分支。

**R3（composer-tools）类型对齐引发下游 TS 报错。**
失败模式：`cwd` 改可选后，其它引用 `cwd` 处出现 `string | undefined` 未处理的 tsc 报错。
缓解：`cwd` 下游已有 `sessionId === undefined ? undefined : ...` 兜底；`check`（tsc）作为验收门禁，报错即修、不扩大改动。

**R4（turn-scrubber）把可选依赖变必选。**
失败模式：`webServer` 加进顶层 inject 后，若未来在无 webServer 的 headless 组合加载 → cordis 抛 `cannot get property "webServer" without inject`。
缓解：本次桌面宿主由 `dsh-host-webserver` 恒提供 `webServer`（RESEARCH:119-127），且与 0.2 官方插件同款写法；真要 headless 兼容再走 RESEARCH:286-303 的子上下文注入，本次不做。

**R5（appearance-gallery，低危·外观警告）pnpm 算 peer 用 node-semver 默认模式。**
失败模式：node-semver 默认 `satisfies`（无 `includePrerelease`）会判 `0.1.5-rc.2` **不满足**双区间 `^0.1.0-rc.6 || ^0.2.0-rc.1`；若 pnpm 装依赖时用默认模式，会对 0.1.5 打一条 peer 不匹配 WARN。
缓解：这是**外观警告、不是 DSH 的判定**（DSH 判定已证实用 includePrerelease）。不阻塞安装/运行；验收时**不把 pnpm WARN 当失败**，在验收记录里注明「0.1.5 下 pnpm 可能打一条 peer WARN，属预期、非 DSH 拒绝」。

### BRIEF §5 敏感面声明 → 逐项保证

| 敏感面 | 本次怎么保证不越权/不泄露 |
|---|---|
| 推 GitHub（远端写） | 只走 SSH 别名远端（`git remote -v` 先核实），推前 `git ls-remote` 核对基线 `aea84ea`；不 `push -f`/`reset --hard`（红线）。本次 diff 仅 3 个源文件 + 1 个 package.json，可一眼审完。 |
| 本机 profile 安装 | 只用 `dsh plugin --profile desktop add/remove`，不在 profile 目录跑 `pnpm install`；装完 `ls -la` 核对 `@deepseek-ai` 是 symlink 非物理副本，出现真目录就 `mv`（LEARNINGS 红线）。 |
| 个人路径/邮箱泄漏 | 推前对 `git diff` 跑脱敏扫描（`\/Users\/<用户名>`、邮箱、`sk-`/`ghp_`/私钥），命中即改。本次改动内容（inject 数组、prop 读取、peer 版本号）本就不含任何个人路径/邮箱字面量。 |
| 用户既有 AGENTS.md | 只读不改。composer-tools 改动只碰「sessionId 从哪来」，不读取、不复制、不落盘 AGENTS.md 内容；测试 fixture 用假路径/假正文，不夹带用户真实 AGENTS.md。 |

## 6. 审查意见处置（I1-I4 / S1-S6）

| 编号 | 级别 | 处置 | 落点 |
|---|---|---|---|
| I1 | 重要 | **采纳**。因果链已闭合：主会话读源码 `InstructionsTab.tsx:80-84` 证实 `cwd===undefined` 时整个列表（含 global）短路不渲染，两症状同一根因，不设独立修复点。证据已写进本文 §1.2。 | §1.2 |
| I2 | 重要 | **采纳**。INTERFACE §2.2 已写全 `/ct` 错误码表 + `cwd===undefined` 的客户端短路 / host `invalid-cwd` 精确行为，不再 defer 给 packages INTERFACE。 | INTERFACE §2.2 |
| I3 | 重要 | **采纳**。删 `{authority:'loopback'}` 后补运行时断言 A7：从非 loopback/非可信上下文调 `/turn-scrubber` 被拒、不返回 turn 内容。 | §4 A、INTERFACE §1.1/§4 |
| I4 | 重要（已解决） | **采纳**。R1 由「需用户降级 #4」改写为「已定：双区间 `^0.1.0-rc.6 \|\| ^0.2.0-rc.1`」，成功标准 #4 不降级。 | §1.3、R1 |
| S1 | 建议 | **采纳**。措辞统一：BRIEF §2「三个包的新版本」=「改后重挂的新构建/新代码」，≠ bump `version` 字段。BRIEF 属只读需求定稿本次不改，统一说明落在本文 §2。 | §2 |
| S2 | 建议 | **采纳**。核实：appearance-gallery 无其它 `@deepseek-ai/*` 版本敏感依赖（仅 3 个 ui-* peer + `cordis ^4.0.1` 不变；`react` 非 @deepseek-ai；`dsh.client.inject` 3 个 ui-* 是软提示不参与 peer 匹配）。 | §1.3 |
| S3 | 建议 | **采纳**。B6 改断言「面板仍显示目录」，明确兜底分支真实触发条件=`props.sessionId===undefined`（两版正常运行时均为死代码）。 | §4 B、INTERFACE §2.1 |
| S4 | 建议 | **采纳**。`snapshot.current` 兜底 + `0.1.5-only` 标注加弃用 TODO。 | §1.2 |
| S5 | 建议 | **不采纳**。脱敏扫描保持一次性人工动作：本次 diff 仅 3 源文件 + 1 package.json，人工 `git diff` 扫描已够；固化 pre-push hook/CI 涉及改 `.git/hooks`/`.github/workflows`（配置红线，需用户明确同意），超出本修 bug 范围。记入 LEARNINGS 待办。 | 本节 |
| S6 | 建议 | **采纳（记待办，不在本次改）**。`dsh.client.inject` 指向不存在的 `@deepseek-ai/dsh-client-runtime` 留债记为 LEARNINGS 待办：`composer-tools` 的 `dsh.client.inject` 与 `context-types.ts` 注释引用了不存在的 `@deepseek-ai/dsh-client-runtime`（缺失静默跳过，软提示无害），下次碰 composer-tools 时顺手清掉。 | 本节 |
