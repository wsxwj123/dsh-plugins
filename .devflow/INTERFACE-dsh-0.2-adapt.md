# INTERFACE — dsh-0.2 适配 对外接口约定（测试设计唯一输入）

> 本文供「测试设计代理」盲写测试用：不看实现代码也能照着写。所有判定顺序、错误码、文案均为契约。
> 本次是「适配」，**不新增/变更任何既有 RPC 业务契约**；本文定义「因适配而变化/新增的可观察点」+「必须不回归的既有契约」+「双版本差异」。
> **错误码已在本文明写全（§1.2 turn-scrubber、§2.2 composer-tools），不依赖 packages/*/.devflow/INTERFACE.md**。packages 下的 INTERFACE.md 仅作**非错误面**业务契约（成功响应字段语义、发现排序、client 状态机等）的完整参考，测试设计在需要精确字段形状时再查。

---

## 1. dsh-turn-scrubber

### 1.1 可观察行为契约

**静态断言（不看运行时，读产物/源码即断言）**
- `inject` 数组恰为 `['connection','sessionPersistence','sessions','webServer']`：新增 `webServer`，其余三个保持原序不变。
- `ctx.connection.rpc.handle('/turn-scrubber', …)` 调用**不再有第三参**；`NodeContext.connection.rpc.handle` 类型签名**无 `options` 形参**。

**0.2.0-rc.2 运行时**
- 输入/调用：宿主加载插件（执行 `apply`）；客户端调 `ctx.connection.rpc.call('/turn-scrubber', 'turnIndex', { sessionId })`。
- 观察到：
  1. `apply` 不抛 `Error: cannot get property "webServer" without inject`；启动审计中本插件 0 条 `did not activate`。
  2. `/turn-scrubber` RPC 通道注册成功：`rpc.call` 有响应（注册失败会表现为无响应/超时，见既有 INTERFACE）。
  3. 对存在且 `origin !== 'subagent'` 的会话，返回 `{ ok: true, value: { sessionId, asOfSeq, total, turns } }`（既有契约，不回归）。
  4. 对不存在会话或 subagent 会话，返回 `{ ok: false, error: { code: 'session-not-found', message: 'session not found', details: { sessionId } } }`（既有契约，不回归）。
  5. **删除第三参后通道仍 loopback-only（I3 运行时断言）**：从**非 loopback / 非可信上下文**发起的请求必须被宿主 trust fence 拒绝（HTTP 403 或等价「不可达」），**不得**返回任何 `turns[].preview` 会话文本；本机 loopback + 可信来源调用不受影响（仍返回 `{ok:true,...}`）。

**0.1.5 运行时（回归）**
- 观察到：`apply` 不抛任何 `webServer` 相关错误；`rpc.call` 行为与改前一致（第 1.1 节 3/4 两条同样成立）。

### 1.2 错误契约（完整错误码表，含每种非法输入 → 精确返回）

`/turn-scrubber` 通道（endpoint `turnIndex`）业务错误恒 HTTP 200 + `result.ok === false`；非 200 只在信封层出现。本次改动**不新增/不改变任何错误码**，仅令「改前唯一的 0.2 激活失败」消失。

| 入口 / 非法输入 | 判定 | 返回 |
|---|---|---|
| 0.2 上 `apply` 缺 `webServer` 注入 | 改前唯一错误，改后消失 | 改后不再抛 `cannot get property "webServer" without inject`、无 `did not activate` |
| `endpoint !== 'turnIndex'`（method 与 endpoint 不符） | handler 判定 | HTTP 200 `{"ok":false,"error":{"code":"bad-request","message":"sessionId is required","details":{}}}` |
| `payload.sessionId` 缺失 / 非 string / 空串 | handler 判定 | HTTP 200 `{"ok":false,"error":{"code":"bad-request","message":"sessionId is required","details":{}}}` |
| 会话在 live store 与持久化都找不到 / `origin==='subagent'`（subagent 路由管控） | resolveIndex | HTTP 200 `{"ok":false,"error":{"code":"session-not-found","message":"session not found","details":{"sessionId":"<id>"}}}` |
| 持久化后端未配置且会话不在内存 / 后端读失败 / 其它不可预期失败 | resolveIndex catch | HTTP 200 `{"ok":false,"error":{"code":"unavailable","message":"session history unavailable","details":{"sessionId":"<id>"}}}` |
| 非可信来源（非 loopback / 非本机） | 宿主 webServer trust fence（先于 handler） | HTTP **403**（纯文本或宿主等价拒绝），不进入 handler、不返回 `turns[].preview` |
| 信封层：体非 JSON / method 不匹配 / 未知 endpoint / content-type 非 JSON / handler 抛错 | 宿主 RPC 信封 | HTTP 400（体非 JSON）/ 404（未知 endpoint）/ 415（content-type 非 JSON）/ 500（handler 抛错）——调用方 bug，非业务契约 |

- `error.details` 恒为 `{}` 或仅含 `sessionId` 一个键，**绝不**含会话文本/摘要；`error.message` 稳定、不含会话内容。
- 调用方须知：`connection.rpc.call` 在 HTTP 非 200 时 throw（`transport failure … HTTP <status>`）；在 `ok:false` 时返回 `{ok:false,error}` 而不 throw。
- 理论分支（本次**不测**、不实现）：若宿主无 `webServer` 服务，cordis 在 `apply` 抛 `cannot get property "webServer" without inject` → `did not activate`。0.2 桌面版恒提供 `webServer`，此分支不出现。

### 1.3 双版本差异

| 版本 | `register()` 读 webServer 的方式 | 调用方是否需 inject | 本改动后行为 |
|---|---|---|---|
| 0.1.5 | `(this.webCtx ?? owner).webServer`，有 `this.webCtx` 回退 | 否（本就够） | 激活成功，RPC 可用（加 inject 并存不冲突） |
| 0.2.0-rc.2 | `owner.webServer` 无条件 | 是 | 激活成功，RPC 可用 |

测试必须对两版各断言一次「激活成功 + `rpc.call('/turn-scrubber','turnIndex',…)` 有响应」。

---

## 2. dsh-composer-tools

### 2.1 可观察行为契约

**静态断言**
- `EntryProps` 含 `sessionId?: string`。
- 「当前会话 id」取值表达式为 `props.sessionId ?? snapshot.current`（先标准 prop、后 0.1.5 的 `snapshot.current` 兜底）。
- `SessionListSnapshot.current` 保留为可选（标注 0.1.5-only）；`SessionSummary.cwd` 为可选 `string`。

**0.2.0-rc.2 运行时**
- 输入/调用：会话作用域标准 slot prop `sessionId`（由 `dsh-client-ui-session` 提供，`string`）；`ctx.sessions.list.getSnapshot()`（0.2 无 `current`，`byId[id].cwd` 存在）。
- 观察到：
  1. 打开「指令/提示词」面板，在**已绑定目录**的会话中：面板显示该会话工作目录，**不显示**「无当前会话目录」。
  2. 面板能列出 `~/.dsh/AGENTS.md`（`level: "global"`），并能点开编辑器读到其内容（`/ct/instructions.read` 成功）。
  3. 空白新会话（无 cwd）→ `cwd === undefined` → 面板显示空/无目录状态，**不抛错、不崩溃**。
  4. **`sessionId` 随会话切换自动更新**：切换会话后，面板 cwd 跟随新会话。这是本改动的核心验收点（研究唯一未证实的推测），须用 `console.log(props.sessionId)` 或等价手段在 0.2 真机确认「prop 随切换变化」。

**0.1.5 运行时（回归）**
- 观察到：面板仍显示目录、历史仍按 sessionId 隔离，行为与改前一致。
- **兜底分支 `snapshot.current` 的真实触发条件（S3/S4）**：该分支仅在 `props.sessionId === undefined` 时执行；0.1.5 也由 `dsh-client-ui-session` 提供 `sessionId` prop，故正常运行时**两版都不执行该兜底**，属死代码，仅作「sessionId prop 未下发」的防御。回归断言只验「面板仍显示目录」，不验「兜底分支被执行」；代码对该分支加弃用 TODO。

### 2.2 错误契约（完整错误码表；本次改动不新增/不改变任何 `/ct` 错误码）

**cwd === undefined 的精确行为（I2 必查项，已定）**：
- **客户端**：`InstructionsTab.tsx` 在 `cwd === undefined` 时**短路**——`setFiles([])`、`setPhase('no-cwd')`、`return`，**不发起任何 `/ct` 请求**，面板显示空/无目录状态，无错误码、无异常、无崩溃。
- **host 端点**：客户端从不会以 `cwd === undefined` 调 `/ct`（被短路拦截）。若调用方绕过客户端直接发 `/ct/instructions.list`（`cwd` 字段缺失/undefined/空串/非绝对路径）→ host 一律按「cwd 非法」判 **400** `{ok:false, code:'invalid-cwd', message:'invalid cwd: must be an absolute path string'}`。host **不区分**「undefined」与「非法字符串」，也没有「仅列 global」的特殊分支——**global 文件只在 list 用有效 cwd 调用时才会被列入 `files`**（这正是 I1「两个症状共用一根因」的 host 侧体现）。
- 因此本次改动**不新增错误面**：`invalid-cwd` 等全部错误码与文案逐字不变。

**`/ct` 传输层公共契约（所有端点，判定顺序即契约）**：

| # | 条件 | 响应 |
|---|---|---|
| 1 | trust fence 失败（非 loopback / `Sec-Fetch-Site: cross-site` / Origin 与 Host 不同源） | **403**，纯文本 `forbidden`，非 JSON |
| 2 | HTTP 方法非 POST | **405**，header `allow: POST`，纯文本 `method not allowed` |
| 3 | URL 无法解析出方法名 | **404**，纯文本 `not found` |
| 4 | body > `MAX_BODY_BYTES = 2097152`（2MB） | **413**，JSON `{ok:false, code:'payload-too-large', message:'request body exceeds 2097152 bytes'}` |
| 5 | body 流读取失败 | **400**，JSON `{ok:false, code:'bad-request', message:'request body read failed'}` |
| 6 | body 非空但不是合法 JSON | **400**，JSON `{ok:false, code:'bad-request', message:'invalid JSON'}` |
| 7 | 方法名不在端点表 | **404**，JSON `{ok:false, error:'not found'}`（字段名是 `error`，历史形态） |
| 8 | body 非对象（`/ct/prompts` 除外） | **400**，JSON `{ok:false, code:'bad-request', message:'body must be an object'}` |

**`/ct` 各端点领域错误码（HTTP 200 + `{ok:false, code, message}`，逐字不变）**：

| 端点 | 非法输入 / 领域拒绝 | code | HTTP |
|---|---|---|---|
| `instructions.list` | cwd 非「非空绝对路径 string」 | `invalid-cwd` | 400 |
| `instructions.read` | cwd 非法 | `invalid-cwd` | 400 |
| | path 非 string / 非绝对 / basename 不在 `{AGENTS.md, CLAUDE.md, AGENTS.local.md, CLAUDE.local.md}` | `invalid-path` | 400 |
| | path 不在发现集合 | `path-out-of-scope` | 200 |
| | 文件不存在 | `file-not-found` | 200 |
| | IO 失败 | `system-error` | 200 |
| `instructions.save` | cwd 非法 | `invalid-cwd` | 400 |
| | path 非法 | `invalid-path` | 400 |
| | content 非 string 或 >1048576 utf8 字节 | `invalid-content` | 400 |
| | expectedMtimeMs 非「有限非负数」 | `invalid-mtime` | 400 |
| | allowTruncatedBase 非 boolean | `invalid-allow-truncated-base` | 400 |
| | path 不在发现集合 / 写前变 symlink | `path-out-of-scope` | 200 |
| | 文件不存在 | `file-not-found` | 200 |
| | 文件 >1048576 字节且 `allowTruncatedBase!==true` | `file-truncated` | 200 |
| | mtime 不一致（`lstat.mtimeMs !== expectedMtimeMs`） | `mtime-conflict`（附 `currentMtimeMs`） | 200 |
| | IO 失败 | `system-error` | 200 |
| `prompts` | body 非对象（非空时） | `bad-request` | 400 |
| | 数据文件不可读/解析失败 | `system-error` | 200 |
| `instructions.create` | cwd 非法 | `invalid-cwd` | 400 |
| | scope 非 `project`/`global` | `invalid-scope` | 400 |
| | scope=project 且无真项目根（cwd→fs 根链无 `.git`） | `no-project-root` | 200 |
| | realpath 复核无 `.git` / 目标在范围外 | `path-out-of-scope` | 200 |
| | realpath/IO 失败 | `system-error` | 200 |
| | 目标已存在（EEXIST，`wx`） | `path-exists` | 200 |
| `instructions.delete` | cwd 非法 | `invalid-cwd` | 400 |
| | path 非法 | `invalid-path` | 400 |
| | path 不在发现集合 / 父目录链越界 / 写前变 symlink | `path-out-of-scope` | 200 |
| | 文件不存在（列出后被删 / ENOENT） | `file-not-found` | 200 |
| | IO 失败 | `system-error` | 200 |

领域错误码全集（13 个）：`invalid-cwd` / `invalid-path` / `invalid-content` / `invalid-mtime` / `invalid-allow-truncated-base` / `invalid-scope` / `path-out-of-scope` / `file-not-found` / `file-truncated` / `mtime-conflict` / `no-project-root` / `path-exists` / `system-error`。传输层另有 `payload-too-large`（413）与 `bad-request`（400）。

### 2.3 双版本差异

| 版本 | `snapshot.current` | sessionId 实际来源 | 行为 |
|---|---|---|---|
| 0.1.5 | 存在（当前会话 id） | `props.sessionId ?? snapshot.current`；prop 正常时二者一致，兜底 `snapshot.current` 为死代码 | 面板显示目录，与改前一致 |
| 0.2.0-rc.2 | 恒 `undefined`（字段已删） | 完全来自 `props.sessionId` | 面板正确显示 cwd |

> ⚠ 未证实的推测：`sessionId` 经第三方插件 `ctx.slots.register` + `{...props}` 是否落地到组件 props，是研究的「推断」（RESEARCH-ct-cwd §7 推测 #2）。若 e2e 证实不落地，本次方案需回退到 `retainedBy.mainView > 0` 派生（0.2-only）+ `current` 兜底的双分支——测试设计应把「sessionId prop 随切换变化」列为**首验项**，不通过即上报，不硬写后续断言。

---

## 3. dsh-appearance-gallery

### 3.1 可观察行为契约

**静态断言（读 `package.json`）**
- 三个 `peerDependencies` 范围改为 `^0.1.0-rc.6 || ^0.2.0-rc.1`：`@deepseek-ai/dsh-client-ui-theme`、`-settings`、`-slots`。
- `@deepseek-ai/cordis`（`^4.0.1`）、`react`（`^18.0.0 || ^19.0.0`）、`peerDependenciesMeta`（全部 optional）**不变**。
- `src/` 与 `lib/`（除 peer 外）**零改动**（代码不因本适配变化）。

**0.2.0-rc.2 运行时**
- 输入/调用：宿主加载插件（`cordis.patch.yml` 的 `insert` 挂 bundle row；客户端 `slots.inject('settings.general.item', …)` 注册入口）。
- 观察到：
  1. 去掉 profile「精确版本豁免」后，插件仍能加载；启动审计**无 peer 冲突告警、无 `did not activate`**。
  2. 「通用设置」出现「打开外观设置」入口（`order: 11`，与原生「外观」`order:10`、「字号」`order:11` 并列）。
  3. 功能闭环 5 条（逐条触发，无异常、无残留 DOM）：① 切主题 → token override 生效；② 切皮肤 → 皮肤 CSS 生效；③ 试穿 → 回滚后恢复原外观；④ 自定义皮肤导入并应用 → 生效；⑤ 恢复默认 → 皮肤卸载、无残留 `<style data-plugin>` 与 `data-dsh-*` body 属性。

### 3.2 错误契约

- 本改动无运行时代码，不新增任何输入/输出错误面。
- peer 不匹配时的行为（装到不支持的宿主版本是否拒绝/要求豁免）**由 DSH 安装器的 peer 匹配语义决定（includePrerelease），非本插件契约**。本改动消除「0.2.0-rc.2 需要豁免」并同时保持「0.1.5-rc.2 免豁免」（双区间，见 3.3）；对双区间之外的其它版本不作出任何承诺。

### 3.3 双版本差异（已定）

peer 写双区间 `^0.1.0-rc.6 || ^0.2.0-rc.1`。DSH 自己的兼容性判定用 `semver.satisfies(runtimeVersion, requirement, { includePrerelease: true })`（app.asar `dsh-app-boot/lib/index.js:300`，主会话实测），据此：

| 宿主版本 | 双区间 `^0.1.0-rc.6 \|\| ^0.2.0-rc.1` 是否满足（DSH includePrerelease 语义） |
|---|---|
| 0.2.0-rc.2 | ✅ true |
| 0.1.5-rc.2 | ✅ true |
| （对照）node-semver 默认模式判 0.1.5-rc.2 | ❌ false（pnpm 装依赖可能据此打一条 WARN，外观警告、非 DSH 判定） |

**结论（测试设计据此定断言）**：本改动**同时承诺**「0.2.0-rc.2 免豁免可装」与「0.1.5-rc.2 免豁免可装」，成功标准 #3/#4 都成立，**无开放项、无 R1 二选一**。0.1.5 回归=「代码不回归 + 去豁免后仍能加载」，不再按「与现状一致（需豁免）」落笔。pnpm 在 0.1.5 下可能打一条 peer WARN，属预期外观警告，不算失败。

---

## 4. 本次必须验证的外部可观察点（验收测试设计清单）

**A. turn-scrubber**
- [ ] A1（静态）`inject` 含 `webServer` 且原三项不变。
- [ ] A2（静态）`rpc.handle` 无第三参、`NodeContext.handle` 无 `options`。
- [ ] A3（0.2）启动审计 0 条 `did not activate`、无 `webServer without inject`。
- [ ] A4（0.2）`rpc.call('/turn-scrubber','turnIndex',{sessionId})` 对真实会话返回 `{ok:true,value:{total≥0}}`。
- [ ] A5（0.1.5 回归）`apply` 不抛 webServer 错、RPC 仍可用。
- [ ] A6 既有单测全绿（`node --test tests/unit`）。
- [ ] A7（0.2，I3 运行时断言）删第三参后通道仍 loopback-only：**从非 loopback/非可信上下文**（非 127.0.0.1 来源、或带 `Sec-Fetch-Site: cross-site`/异源 Origin 的原始 HTTP 打到 `/turn-scrubber/turnIndex`）→ 被宿主 trust fence 拒绝（HTTP 403 或等价「不可达」），**不得**返回任何 `turns[].preview` 会话文本；对照：本机 loopback + 可信来源仍返回 `{ok:true}`。

**B. composer-tools**
- [ ] B1（静态）`EntryProps` 含 `sessionId?`；取值 `props.sessionId ?? snapshot.current`。
- [ ] B2（0.2）面板显示会话目录（非「无当前会话目录」）。
- [ ] B3（0.2）面板列出并打开 `~/.dsh/AGENTS.md`（global）。
- [ ] B4（0.2）空白新会话 cwd=undefined、不崩。
- [ ] B5（0.2）**`props.sessionId` 随会话切换变化（首验项，不通过即上报）**。
- [ ] B6（0.1.5 回归）面板仍显示目录、历史按 sessionId 隔离，行为与改前一致（不断言「兜底分支被执行」——该分支仅 `props.sessionId===undefined` 时触发，两版正常运行时均为死代码）。
- [ ] B7 既有单测全绿（`node --test tests/unit`）。

**C. appearance-gallery**
- [ ] C1（静态）三 ui-* peer = `^0.1.0-rc.6 || ^0.2.0-rc.1`；`cordis`（`^4.0.1`）/`react`/`peerDependenciesMeta` 不变。
- [ ] C2（0.2）去豁免后能加载、审计无 peer 告警、无 `did not activate`。
- [ ] C3（0.2）「打开外观设置」入口出现。
- [ ] C4（0.2）功能闭环 5 条全部通过、无残留 style/body 属性。
- [ ] C5（0.1.5 回归，已定）去豁免后仍能加载（双区间覆盖 0.1.5-rc.2）；若 pnpm 打一条 peer WARN 属预期外观警告、不算失败。
- [ ] C6 既有单测全绿（`node --test "tests/unit/*.test.mjs"`）。

**D. 跨包（发布面）**
- [ ] D1 `git diff` 脱敏扫描通过（无 `/Users/wsxwj`、邮箱、`sk-`/`ghp_`/私钥）。
- [ ] D2 三包 `lib/` 均已重建（源码改动的包），产物与 `src/` 一致。
