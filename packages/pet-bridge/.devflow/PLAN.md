# dsh-pet-bridge 方案定稿

让 cc-pet 桌面宠物的气泡实时显示 dsh（DeepSeek Harness）会话状态。本方案基于 spike 已实证事实（见 BRIEF「技术事实」），不引入未验证假设；关键未验证点列为「待 spike 项」。

## 1. 架构

单进程内一条单向数据流水线，dsh 是唯一源，pet 是唯一汇：

```
dsh agent loop                     pet-bridge 插件                     cc-pet
─────────────────                ────────────────                    ───────────
turn/start / tool/call    →   ctx.on("agent/created")           →   HookServer 7779
tool/result / turn/end       采集 agent → 轮询 session.events      POST /bubble
assistant/message             增量(seq 游标, 250ms)               气泡显示
                              ↓
                        事件→kind + tool_input 精简摘要提取
                              ↓
                        http.post 127.0.0.1:7779/bubble
```

一句话人话版：插件挂在 dsh 进程里，盯着每个会话的事件流，把「开始思考/调了哪个工具/完成」转成 pet 能懂的消息，回环 POST 到宠物，宠物顶气泡显示。

### 1.1 轮询 vs 其他订阅方式——选轮询，理由

- 已实证 `ctx.on("agent/created")` 拿 agent 实例、`agent.session.events` 带 `seq` 字段可增量取。这是唯一验证过的事件获取通道，零新假设。
- event emitter 类订阅（如 agent 上是否有工具调用事件）未实证，去 spike 属于扩大验证面、增加不确定性；为一个 250ms 的本地回环小工具不值。
- 轮询成本：本地内存数组 + 每 tick 扫增量，几乎无开销；250ms 满足推送延迟 ≤1s 标准。
- 有更轻的真实事件订阅（如 agent 已暴露 `dispatch.on('agent/status')`？）时再考虑替换，但**不在本期做**——列为待 spike 项而非本期能力。

### 1.2 agent_source 命名

**固定为 `"dsh"`**（用户拍板，不使用 spike 的 `dsh-spike` 或任何其他名字）。多会话并发时气泡显示始终是 `dsh`（单个名字），符合 BRIEF「非目标：不做会话级聚合，取最新活跃会话」。不设可配置项，常量写死。

### 1.3 多会话并发策略

- **取最新活跃**：每个 agent 各自维护一个 `seq` 游标 + 一个「上次推送时间戳」；收集函数选**事件最近发生**的会话作为唯一推送源，推送后记该会话时间戳。
- 不合并、不去重跨会话，不维护会话队列——BRIEF 明确非目标，不提前做。
- **明示权衡**：若用户正在看的会话 A 在工作、背后会话 B 更晚发生工具调用，气泡会显示 B 的工具名（BRIEF「非目标」已接受此覆盖行为）。collector 单测固定「按最近事件时间戳选唯一源」的选择逻辑，避免实现走样。

### 1.4 tool_input 精简安全摘要提取——按工具分类的规则表

**变更（用户拍板）**：气泡从「中文分类文案」改为「详细工具气泡」（claude codex 同款）——`tool_name` 传**原始工具名** `ev.data.name`，不再中文化；`tool_input` 转为从 arguments 提取的**精简安全摘要**。

**判断：工具集合是开放的。** dsh 工具集会持续新增（包持续更新），逐工具枚举硬编码不可取。采用**分类规则表**：`tool_name → { 前缀匹配 → 摘要提取规则 }`，提取对象缺省/类型不符/未命中的分支回 `null`（pet 兜底「运行中」）。规则面朝「工具类别」而非「具体工具」。

摘要规则（第一版，按工具名前缀匹配，未命中回 `null`）：

| 工具名前缀 | 提取字段 | 规则 |
|---|---|---|
| `read` | `{ file_path }` | `arguments.file_path` basename |
| `write`/`edit`/`insert`/`apply_patch` | `{ file_path }` | `arguments.file_path` basename |
| `bash`/`shell`/`exec` | `{ command }` | `arguments.command` 空格首词 |
| `grep`/`search` | `{ pattern }` | `arguments.pattern` 截断 24 字符 |
| `web_search` | `{ query }` | `arguments.query` 截断 22 字符 |
| 其余（glob/subagent/workflow/skill/未知） | `null` | pet 兜底「运行中」 |

落地要点：
- 规则表放独立模块 `toolLabels.ts`（职责 = 摘要提取），新增工具只改一张表，不碰主流程。
- **所有提取值 ≤24 字符**；**完整 `arguments` 从不上外发路径**。
- `argumentsJSON` 解析失败或对象缺字段 → 回 `null`，不抛错、不扩散到错误路径。

### 1.5 错误降级策略

全部静默降级——不报错、不影响 dsh、可随时卸载（BRIEF「边界与约束」+ 成功标准「无残留」）。

| 场景 | 行为 |
|---|---|
| pet 未运行 / 7779 无监听 | `http.request` error（ECONNREFUSED）→ 只记一次 debug 日志，不重试，不抛异常，不影响事件处理 |
| 推送失败（网络 / 非 2xx） | 同样静默降级；配置 `logger`（默认 dsh logger），按 debug 级别打 |
| 工具参数含敏感内容 | 见 §4.1 敏感面；`tool_input` 仅含精简摘要（≤24 字符），`tool_name` 只传工具名，完整 `arguments` 从不上外发路径 |
| 插件热重载 | cordis 卸载时 `ctx.offAll()` + 清全部 timer；重载重建，无残留 |
| `agent.session.events` 为 undefined | 该 tick 跳过（已有 guard），不再深挖结构 |
| **进程退出兜底（`agent/disposed`）** | 监听 `agent/disposed`（payload `{agent}`，与 `agent/created` 同源）；对销毁的 agent 补发一条 `kind:"stop"`（与 turn/end 相同 payload），并清理其轮询 timer/seq 游标。headless 一次性场景轮询可能来不及捕到最后的 turn/end 就退出，此兜底保证销毁前补发 stop，杜绝 pet 气泡残留 |

### 1.6 插件形态

cordis 插件（`exports.inject = []` + `exports.apply(ctx)`），纯 `node` 侧，无 client 侧（web 无需 UI 注入）。这与 turn-scrubber 的架构原则一致（不同点是它还有 client bundle，本项目**不需要**——非目标里没有 web UI 需求）。

## 2. 文件结构

```
packages/pet-bridge/
├── package.json          # name=dsh-pet-bridge, main=lib/index.js, private:true
├── cordis.patch.yml      # bundle patch：- insert: [{id, name}]
├── tsconfig.json         # 覆盖 src 的编译
├── build.mjs             # tsdown/tsc 构建驱动（对照 turn-scrubber）
├── src/
│   ├── index.ts          # 插件入口：exports.inject/apply，装配与热卸载
│   ├── config.ts         # config schema（端口/轮询间隔/开关）
│   ├── agentWatcher.ts   # 单 agent：seq 游标 + 增量轮询 → 派发 kind+tool
│   ├── collector.ts      # 多会话并发：选最新活跃会话作为唯一推送源
│   ├── bubble.ts         # POST /bubble 构造与发送 + 静默降级
│   ├── toolLabels.ts     # tool_input 精简安全摘要提取规则表（开放扩展点）
│   └── types.ts          # 事件形状 / 推送 payload 类型
├── lib/                  # 构建产物（Node 侧 ESM）
│   ├── index.js
│   ├── ...（对应 src 各模块）
├── test/
│   └── local.test     # 无 pet 时的降级/映射/游标单测（详见测试设计阶段）
└── .devflow/
    ├── BRIEF.md
    ├── PLAN.md
    └── INTERFACE.md
```

> 测试设计阶段由测试代理产出 `test/test-local.test.ts`（映射表、seq 游标、collector 并发选优）、`test/http.test.ts`（真实 7779 通断），本方案只定文件归属。不引入 mock 替身化核心逻辑（规则的「覆盖真实行为」要求）。

### 构建

- `build.mjs`：`rm -rf lib && tsc/tsdown`，产出 `lib/` 下各 ESM 文件，`main: lib/index.js`。
- 校验产出：`node -e "import('./lib/index.js')"` 不报错、`exports.inject/apply` 存在。

## 3. 任务拆解（模块 + 顺序依赖）

```
M1 包骨架            M2 类型+配置          M3 映射表            M4 单会话观察       M5 多会话收集
package.json      types.ts           toolLabels.ts       agentWatcher.ts    collector.ts
cordis.patch.yml  config.ts (schema)                    (seq 游标,250ms)    (选最新活跃)
build.mjs
  │                    │                    │                    │                     │
  └────────┬───────────┘                    └────────┬────────────┘                     │
           │ (M1→M2→M3 链式)                          │                                  │
           ▼                                          ▼                                  ▼
        M6 bubble 推送  ←─────────── M4/M5 的输出 ─────────────┘
        bubble.ts(POST+降级)
              │
  M7 装配 index.ts (apply/inject/agent/created+disposed/热卸载/多会话注册)
              │
  M8 打包与产物校验 + 真机端到端(web profile 跑任务看 pet)
```

**依赖说明**
- M1→M2→M3 线性（骨架→类型配置→映射），可链式完成。
- M4（agentWatcher）只依赖 M2 的类型/配置，不依赖 M3；M5（collector）依赖 M4；两者输出喂给 M6（bubble）。
- M7 装配把所有模块接上，注册 `agent/created`、已有 agent、卸载清理。
- M8 端到端验收。

## 4. 风险清单

### 4.1 敏感面保证（BRIEF 每项配一句）

| BRIEF 敏感面 | 怎么保证不越权/不泄露 |
|---|---|
| 只读事件、只写 7779 | 插件 `apply` 只调用 `ctx.on("agent/created")` + `agent.session.events`（只读）；所有出站网络仅 `bubble.ts` 一个入口，且 URL 固定 `http://127.0.0.1:7779/bubble`（可配置端口默认 7779），不留通用 http 客户端 |
| 参数可能含敏感内容 | `tool_name` 传工具名；`tool_input` 仅含**精简摘要**（文件名/命令首词/搜索词，≤24 字符）；**完整 `arguments` 从不上外发路径**——摘要提取只在 `toolLabels.ts` 内完成、出站前不再拼回原始参数（见 INTERFACE §2.3） |
| 不读凭据/密钥/settings.yaml | 插件不访问文件系统、不读任何配置外的文件；只消费内存中的 session events；状态（禁用开关/端口）只来自 dsh config，不落盘敏感内容；`agent_source` 是固定常量 `"dsh"`，无外部输入 |
| 仅本机回环 | URL 硬编码 127.0.0.1（或本机 127.0.0.1 可配置），无外部地址、无 CORS、无公网监听；pe t 侧同为 127.0.0.1 监听 |

### 4.2 具体失败模式 + 缓解（每个非机械改动 ≥1，高风险项 ≥2）

| 改动 | 失败模式 | 缓解 |
|---|---|---|
| **M4 agentWatcher（轮询/seq 游标）** | 会话事件数组在轮询间隙被清空/重排（`events` 引用变化或 seq 回绕），导致漏事件或重复推送 | 处理前先取 `sess.events` 快照引用再遍历；用 `seq` 单调判断 `ev.seq <= lastSeq` 跳过；游标只增。若结构异常（events 为 undefined）该 tick 跳过，见 1.5 |
| **M4（同上）** | 轮询长驻 timer 在插件卸载后未清理 → 泄漏 + 卸载后仍在推送（违反「无残留」） | `apply` 返回 `dispose` 或 `ctx.offAll()` + 显式 `clearInterval`/`timer.unref`（对照 spike 已用 `timer.unref?.()`）；卸载路径唯一化 |
| **M3 toolLabels（摘要提取）** | 摘要越界：字段名拿错 / basename 或首词切分不当 / 提取值超长 → 泄出过宽参数或气泡文案难看 | 字段名按表固定（file_path/command/pattern/query 的替代 key 兜底），basename 取末段、首词按空格切、所有值再强制 `slice(0,24)`；**完整 `arguments` 从不外发**；单测覆盖 read/bash/web_search/grep + 未知工具 + 非法 JSON |
| **M6 bubble 推送** | pet 未运行→ECONNREFUSED→若未 catch 会抛异步异常，污染 dsh 进程（违反「不影响 dsh」） | http request error 事件全部 `catch(()=>debug log)`；发送用 fire-and-forget，不 await 返回值；配置可关 |
| **M5 collector 并发** | 多会话同时活跃，选「最新活跃」逻辑若只按事件序而非时间序，可能取到旧会话覆盖新会话气泡 | 「最新活跃」按会话的最近事件时间戳排序取最大；推送后固化该会话时间戳，避免同 tick 抖动 |
| **M7 装配** | 插件热重载时 `agent/created` 对旧 agent 仍挂着观察者 → 重复推送或残留 | 卸载回调里对每个 agent 调 `disposeWatcher`；重载幂等（重跑 apply） |
| **M7 装配（`agent/disposed` 兜底）** | headless 一次性场景进程退出前轮询捕不到最后的 `turn/end` → stop 漏发、pet 气泡残留 | 必监听 `agent/disposed`（payload `{agent}`，与 created 同源），对销毁 agent 补发 `stop`（同 payload）并清其轮询 timer/seq 游标；若销毁前 stop 已发，补发 stop 是幂等无害的 |
| **M8 部署/卸载** | 卸载后 profile 仍引用插件、node_modules symlink 残留 | 卸载 = 移除 bundle patch 条目 + `mv` 掉 symlink（保留可回退）；凡删除用 `mv` 而非 `rm -rf`，符合全局规则 |

### 4.3 待 spike 项（不当作已验证事实）

- `agent` 上是否存在更轻的真实事件订阅（如 agent emitter 发出 tool 事件），可替代 250ms 轮询——**不影响本期方案成立**，仅作优化候选。
- **【必做 spike · 测试设计阶段前置】pet `stop` 之后「完成」显示能否自动消失**（pet 侧固有行为，未验证）。动作：`curl -X POST http://127.0.0.1:7779/bubble -d '{"kind":"stop","agent_source":"dsh"}'` 目视确认气泡「完成」显示后是否自动消失。
  - 若验证存在自动消失 → 成功标准「完成→消失」成立，M8 按三段序列验收。
  - **若验证不存在自动消失** → M8 成功判定改为目视确认「气泡从工具名回到隐藏态」，并在 PLAN 写明；不额外加控制（YAGNI，见 #4）。

## 5. 反向拷问（对 BRIEF/方案自身的盲点检查）

- **「思考中→工具名→完成」三段是否都能由 dsh 事件保证？** 可：`turn/start`→「思考中」(`user`)，`tool/call`→「工具名」(`pre`)，`turn/end`→「完成」(`stop`)。但 LLM 中途放弃（无 turn/end）可能卡在工具名——**决定：dsh 侧不做 auto-stop（YAGNI）**，气泡恢复依赖 pet 侧行为（见 §4.3 #1 spike 验证 pet 的 stop/超时行为）；pet 侧 OpenCodeProvider 也已在 `stop` 兜底释放状态（见其 `finish` 注释）。落点见 INTERFACE §2.4。
- **卸载 UI 在非 web profile 是否仍装？** 插件挂整个 profile；BRIEF 限定 web profile 为主要场景，headless 仅作测试环境，未要求护其他 profile——按 4.2 M8 的幂等重载即可，不特判 profile 类型。

> 最小化立场：不设「插件服务端另起常驻线程」「跨会话持久化」「消息队列/背压」等预扩展。本地单机 250ms 回环，YAGNI。
