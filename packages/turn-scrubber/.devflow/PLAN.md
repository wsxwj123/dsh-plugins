# PLAN — 回合刻度显示所有回合（dsh-turn-scrubber）

> 范围：本方案只新增「数据通路 + 刻度扩展」，不重构现有已工作的交互（悬停波形、tooltip、
> 已加载回合平滑滚动）。所有架构结论均基于对 `~/.dsh/profiles/node_modules/@deepseek-ai/`
> 下源码的实读（API 名/文件位置见各节引用），不臆测。

---

## 1. 架构与技术选型

### 1.1 核心事实（勘察结论）

> **spike #0 / #0.5 已于 2026-08-15 实测通过**（本机真实会话存档验证）：
> - `ctx.sessionPersistence` 服务存在（`SessionPersistence`，`inspect(id, signal) → {meta, events}`）；
>   本机已装 `dsh-session-persistence-jsonl` 后端，存档在 `~/.dsh/sessions/<cwd>/<sessionId>/session.jsonl.zstd`。
> - 实测解压 4 个真实会话：`turn/start` 是回合权威，**turn 号从 1 开始连续**；`compaction/summary`
>   遮蔽 `user/message` 节点，`shadowedSeqs` 判定在 276 回合会话上正确识别 269 个压缩回合；
>   `compaction/prune` 只遮蔽 `tool/result`，不影响回合判定。
> - 实测修正两点：**preview 应取回合内最后一条 user/message**（首条多为系统注入）；**压缩回合的
>   preview 用 `compaction/summary.data.summary` 摘要文本**。
> - `connection.rpc` 协议实测确认：POST `{origin}{channel}/{endpoint}` + client-request 信封，
>   method 必须等于 endpoint；403/404/415/400/500 与 `ok:false` 语义见 INTERFACE §1.1/§1.4。

- **DSH web 是两半区架构**：node/host 半区（`src/index.ts`）与 browser/client 半区（`src/client/*`）。
  跨半区**不能 import 对方的 `@deepseek-ai` 值**（client 侧有 purity gate，见 `tsdown.config.mjs`
  `purityGatePlugin`：只允许 `CLIENT_EXTERNALS` + `INLINE_SAFE`），协作只能走 **cordis 服务注入、
  RPC、或 HTTP route**。
- **host 能提供任意会话（含未加载、含已 compaction）的完整事件日志**：
  - `ctx.sessionPersistence.inspect(id) → {meta, events}`（`dsh-session-persistence/README.md` 的
    `inspect`，一次读回该会话完整 `events`，**不修复、不 resume、不发布/加载进内存**）。
  - `ctx.sessions.get(id)`（`dsh-session` live store）给实时内存 session，其 `session.events`
    是 append-only 全量事件快照。
  - 现有 `session.history` RPC 内部走的正是 `historySourceFor`（`dsh-host-apiproxy/lib/index.js`
    `L2043`）= live `ctx.sessions.get` 优先，否则 `persistence.inspect`（冷读）。说明对**主 agent
    会话**打开会话时持久化后端必然已配置（否则用户根本无法「加载更早」）。
  - `ctx.sessionQuery` 也提供 `readSession/readSurface`，但依赖 `dsh-session-query-sqlite`（需要
    SQLite）且只对读历史有用，非必需——本方案不依赖它，只在没有它时用 persistence 直读。
- **「回合」在日志里的权威定义 = `turn/start` 事件**（`dsh-session/README.md`：`turn/start` carries
  only the turn number）。从完整 `events` 按 `type==='turn/start'` 计数 = **会话总回合数**，
  压缩不改变 turn 编号、不改变 `turn/start` 数量（compaction 纯追加，只做 surface 指针重写，
  `dsh-compaction-basic` 报告确认全部 `turn/start` 永远留在日志）。
- **compaction 的可识别性**：每次压缩在日志追加 `compaction/summary`（log-only）事件，其
  `shadowedSeqs`（被遮蔽的 surface 节点 seq 数组）是最权威标记；该回合首条 `user/message` 的
  `seq ∈ 任一 compaction/summary.shadowedSeqs` ⇒ 该回合被压缩 ⇒ 渲染为灰色占位。
- **client 已加载回合 = 会话 `snapshot.chat.locations.turns`**（`Map<turn号, nodeKey[]>`，`dsh-client-runtime`
  的 `ConversationLocationIndex`），只覆盖已加载进窗口的可见节点；`loadOlder` 前插后增长、node key 稳定。
  `data-chat-anchor-key === node.key`（排序/定位用 `.anchorSeq`，等于 host 事件 seq）。
- **client loadOlder 现成可用**：`ctx.sessions.binding(id).session.loadOlder()`（无参，
  内部调 `history({beforeSeq: this.baseSeq, maxMessages: 50})`，`hasMore` **唯一权威 = host**；
  client 的断档兜底置 false **仅作异常兜底，不作为正常停止依据**，触发时记 warning 并滚到窗口最前）。
  binding 快照含 `hasMore`/`loadingOlder`/`openState`。
  - **修订：**（重要 4）`hasMore` 语义收敛为 host 唯一权威，client 兜底 false 不得用来正常结束加载循环。
- **跨半区只读查询的最简机制 = 通用 connection.rpc**（路径 B）：node 半区
  `ctx.connection.rpc.handle('/channel', (endpoint, payload, signal) => result)`；client 半区
  `ctx.connection.rpc.call('/channel', 'endpoint', payload)`。零 schema、零生成器、零 Typert/class。
  `ctx.connection` 是 cordis 服务（node 侧 `HostConnectionService`、client 侧 handle），client 侧
  仅「注入」不 import 值，天然过 purity gate（详见 `dsh-client-connection/lib/index.js` 与 `lib/client.js`）。

### 1.2 数据源选型结论

| 候选 | 结论 | 理由 |
|---|---|---|
| 新建 node 半区 `connection.rpc` 端点返回「全回合索引」 | **选中** | host 侧数据本就齐备（persistence 直读），一次性返回总回合数 + 每回合 `{preview, compacted}`；client 侧只注入 `ctx.connection`，跨半区最干净、最自洽，不改任何全局面 |
| client 用现有 `session.history` 翻页数回合 | 否决 | 要拿全量必须逐页翻到最老，O(总消息数) 次 RPC 往返，数百回合下很重；且拿不到「compacted」标记与统一的每回合摘要 |
| client 用 `session.list` 的 projections 扩展示 | 否决 | 投影是全局面，一次注册进所有会话 list，属侵入式全局改造；且只给计数，给不了每回合 preview/compacted 明细 |
| 纯 client 估算（已加载 + 页数估算） | 否决 | 不满足成功标准「刻度数 = 全部回合数、不跳变」，给不出 compaction 灰色占位 |

> 反向审校：是否需要 node 半区？——需要，因为「总回合数、compacted 标记、未加载回合摘要」只存在于
> host 日志，client 无从获得。但新增的 node 面极小（一个只读查询函数），不引入新依赖、不碰持久化写
> 路径、不共享全局状态，符合最小改动原则。host 数据**拿得到**（persistence 冷读），因此无需降级方案。

### 1.3 未加载回合列表的获取与缓存

- **获取**：node 半区 `turnIndex` 端点，输入 `{sessionId}`，输出全回合索引（见 INTERFACE.md）。
  host 侧数据来源（优先→fallback）：
  1. `ctx.sessions.get(sessionId)` 存在 ⇒ 用其 `events`（实时内存快照，最省）；
  2. 否则 `ctx.sessionPersistence.list()` 找到该 id ⇒ `ctx.sessionPersistence.inspect(sessionId).events`
     （冷读全量）；
  3. 都没有 ⇒ 返回 `session-not-found`。
- **构造回合索引**（node，纯函数遍历 events 一次）：
  1. 扫 `turn/start` 事件，按序收集 turn 号；
  2. 每回合**最后一条** `user/message`（该 turn/start 与下一个 turn/start 之间）取 `data.content`
     文本前 `PREVIEW_LEN(120)` 字符做 `preview`（spike 实测：首条多为系统注入）；无则空串；
     被压缩回合的 preview 取对应 `compaction/summary.data.summary` 文本前 120 字符；
  3. 收集所有 `compaction/summary.shadowedSeqs` **与 `compaction/prune.shadowedSeqs`** 并成一个
     `Set<seq>`（`compaction/prune` 同样会遮蔽节点且带 `shadowedSeqs`，见
     `dsh-compaction/lib/types/types.d.ts`）；
  4. 该回合首条 `user/message.seq ∈ Set` ⇒ `compacted: true`（spike 实测验证通过）。
  5. 返回 `turns: [{turn, preview, compacted}]`（按 `turn` 升序，turn 0=最老）。
- **缓存**：
  - **client 侧**：按 `(sessionId, 快照回合变化指纹)` 缓存索引；会话切换/新增回合（快照
    `locations.turns.size` 或 `order.length` 变化）后重拉。索引小（几百条 × ~150B ≈ 几十 KB），
    单次 fetch。不随「加载更早」重拉（总回合数只随新回合增长）。
  - **修订：**（重要 3 会话切换漏态）`turnIndex` 响应须携带生成时所基于的 `sessionId`；client 缓存命中
    或收到响应后，**渲染前先核对该 `sessionId` 与当前绑定会话一致**，不符即丢弃（响应作废、重拉或回退），
    杜绝会话切换后拿旧索引画新线的竞态。
  - **node 侧**：可选，按 `(sessionId, asOfSeq)` 缓存最近一次构造的索引，热路径复用；不做强一致性
    承诺（这是只读视图，稍旧无害）。首版可不做 node 缓存，够用。

### 1.4 总回合数、摘要文本、压缩标记怎么拿到

- **总回合数** = host 端 `turnIndex.turns.length`。
- **摘要文本（preview）** = host 端每回合首条 `user/message.content` 截前 120 字符；compacted 回合
  的 preview 取 `<compacted-summary>` 事件内容留下的占位语义（可显示「已压缩」）。已加载回合的
  tooltip 文本仍优先读 client 快照原文（走现有 `collectTurns`），host preview 只作未加载点的 tooltip 兜底。
- **压缩标记** = host 端 per-turn `compacted` 布尔（见 §1.3 第 3-4 步）。

### 1.5 client 侧如何把「全索引」与「已加载」合并渲染（不破坏现有交互）

- 保留现有 `collectTurns` + `scrollToRow` + 波形/悬停/tooltip 全部逻辑不变。
- 新增一条**渲染管线**：以 `hostIndex` 为骨架，逐行判断状态：
  - `loaded`：`snapshot.chat.locations.turns.get(turn)` 非空且有可见 node ⇒ 用快照 key 平滑滚动/波形照旧；
  - `compacted`：`hostIndex[i].compacted` 且未 loaded ⇒ 灰色占位线，点击滚动到「加载更早」按钮区；
  - `unloaded`：其余 ⇒ 点击触发 `loadOlder` 循环直到该 key 进快照再滚动。
- **关键不变式（spike 修正）**：线位置 `i`（0 基、最老在上）↔ **turn 号 `i+1`**（spike 实测 turn 号
  从 1 开始），与快照 `locations.turns` 的 key（= host 事件 `data.turn`，同一编号体系）一致，
  二者顺序同向，故**无需重排**、仅做 `+1` 偏移映射即可（spike #0 已验证 client `payloadCoordinates`
  直接取事件 `data.turn`，与 host 存档同源）。
  - **修订：**（重要 5）该恒等是跨 host 索引 / client key 两套实现的**假设**，须在 spike #0 里专项验证
    （目标第二页回合，证 `index == host turn 号 == client locations.turns key` 三者一致）；若结果不一致，
    则引入**显式映射函数**（`turn → locations.turns` key / coreSeq）而非假定恒等，渲染管线改为经映射查表。
- **主导航仅当 hostIndex 可用**；hostIndex 失败（`session-not-found`/持久化缺失/网络错）时**原样退化**为
  当前「只看已加载」行为，无回归（见 §5 风险）。

---

## 2. 文件结构

```
packages/turn-scrubber/
├── src/
│   ├── index.ts                      # node 半区：stub → 真实现
│   │                                  #   inject ['connection','sessionPersistence']
│   │                                  #   apply(): ctx.connection.rpc.handle('/turn-scrubber', handler)
│   ├── turn-index.ts                # (新增) 纯函数: events → 回合索引构造（可单测）
│   ├── client/
│   │   ├── index.tsx                 # 改：inject 增加 'connection'；把 hostIndex 拉取/缓存接入挂载
│   │   ├── TurnRail.tsx              # 改：以全索引渲染；只调 ensureTurnLoaded，自身不含循环逻辑
│   │   ├── hostIndex.ts             # (新增) 封装 ctx.connection.rpc.call → 类型化 turnIndex 拉取+缓存
│   │   ├── ensureTurnLoaded.ts      # (新增) ensureTurnLoaded({binding,turnId,token}) → 达成|到最老|超限；
│   │   │                              #        单飞加载循环/会话切换终止/终止条件全在此（可单测），TurnRail 只调用
│   │   ├── context-types.ts          # 改：SessionFace 增 loadOlder；SessionSnapshot 增 hasMore/loadingOlder
│   │   │                              #      Context 增 connection 类型
│   └── (rail.module.css)             # 小改：灰色占位 line 样式类（可选）
├── tsdown.config.mjs                # 不改（node/index + client 两个入口已存在）
└── package.json                      # 不改（无新依赖）
```

- node 半区 `src/index.ts` 从 no-op stub 变为一个注册通用 RPC channel 的最小实现；顺带新增
  `src/turn-index.ts` 纯函数便于测试。
- client 半区新增 `hostIndex.ts`（RPC 封装+缓存），改 `TurnRail.tsx` 的渲染数据源，改 `index.tsx`
  的注入与生命周期，改 `context-types.ts` 的类型。
- 不新增第三方依赖；不修改 tsdown 双入口结构；只补 CSS 一个灰色类。

### 依赖/注入关系

- **node 半区**：`inject: ['connection', 'sessionPersistence']`（`sessionPersistence` 由
  `dsh-session-persistence-jsonl` 之类后端提供；`connection` 由 `dsh-client-connection` 提供）。
  与 `ctx.sessions`（live）三者配合构造索引。
- **client 半区**：`inject: ['sessions', 'connection']`。`ctx.connection.rpc.call` 只读调用，
  无值 import，过 purity gate。

---

## 3. 接口约定

单独成文见 `.devflow/INTERFACE.md`（测试设计唯一方案输入）。要点索引：

- 数据获取：`POST {origin}/turn-scrubber/turnIndex`，入参 `{sessionId}`，
  返回 `{ok:true, asOfSeq, total, turns:[{turn,preview,compacted}]}` 或
  `{ok:false, error:{code,message}}`（code ∈ `session-not-found | unavailable`）。
- client 新增对外行为：刻度总数来自 host 索引；未加载点点击 = `loadOlder` 循环（终止条件 =
  目标 key 进入快照 或 `hasMore===false`，上限 `MAX_LOAD_PAGES`）；compacted 点点击滚到「加载更早」区。
- 全部字段/错误契约/终止条件详见 INTERFACE.md ~L1-2。

---

## 4. 任务拆解（按模块，标注顺序依赖）

| # | 任务 | 内容 | 依赖 |
|---|---|---|---|
| 0 | ~~spike：sessionPersistence 可注入性 + inspect 实读 + identity 恒等~~（门禁） | ✅ **已完成（2026-08-15）**：服务存在、jsonl 后端在工作、4 个真实存档解压验证 turn/start 权威 + 1 基编号 + compacted 判定 269/276 + preview 取最后一条 user/message + client locations key 与 host `data.turn` 同源 | — |
| 0.5 | ~~spike：connection.rpc 协议形态~~（门禁） | ✅ **已完成（2026-08-15）**：源码 `rpcFetchHandler`/`register` 实读确认 HTTP 形态/信封/method==endpoint/403-500 语义，已回填 INTERFACE §1.1/§1.4 | — |

> **门禁（重要 1/2）**：spike #0 与 #0.5 **先行、独立成 gate**。#0 通过才继续 #1（host 索引纯函数）及后续；
> #0 不通过则走 **fallback**：用现有 `session.history` 翻页数回合数，或标注「依赖本地持久化后端，缺失时本地
> 降级」。#0.5 的真实信封/URL 必须回填 INTERFACE §1.1 后才允许写 #2（node RPC 端点）与 curl 测试。

| 1 | host 索引纯函数 | `src/turn-index.ts`：events→`{turn,preview,compacted}[]`（turn/start 分段、shadowedSeqs 判定） | #0 通过 |
| 2 | node RPC 端点 | `src/index.ts`：inject `['connection','sessionPersistence']`，`connection.rpc.handle('/turn-scrubber', turnIndexHandler)`，handler 内部走 live→persistence 直读 + 调 #1；按 #0.5 回填的真实 envelope 实现 | #1 #0.5 |
| 3 | client RPC 封装+缓存 | `src/client/hostIndex.ts`：`loadTurnIndex(sessionId)` + 按 `(sessionId,指纹)` 缓存；渲染前核对响应 `sessionId`（重要 3） | #2 #0.5 |
| 4 | 类型扩展 | `context-types.ts`：`SessionFace.loadOlder()`、`SessionSnapshot.hasMore/loadingOlder`、`Context.connection`；`ensureTurnLoaded` 结果类型 | #0 通过 |
| 5 | ensureTurnLoaded 模块 | `src/client/ensureTurnLoaded.ts`：`ensureTurnLoaded({binding,turnId,token})→达成|到最老|超限`；单飞加载循环/会话切换终止/终止条件全置此（可单测）；`hasMore` 仅当 host false 才停（重要 4） | #4 |
| 6 | TurnRail 全索引渲染 | `TurnRail.tsx`：以索引为骨架逐行定态（loaded/compacted/unloaded）、compacted 灰线、未加载点**只调用** ensureTurnLoaded、退化路径；键不一致时走显式映射（重要 5） | #3 #4 #5 |
| 7 | 挂载接线 | `index.tsx`：inject `['sessions','connection']`；会话切换/回合增长时拉取+刷新索引；响应 sessionId 核对，会话切换丢弃旧索引（重要 3）；清理 | #3 #5 |
| 8 | CSS | `rail.module.css` 补 `.line.compacted` 灰态类 | #6 |

顺序：0/0.5 门禁**先行**→0 与 0.5 可并行；1 需 0 通过，2 需 1+0.5；3 需 2+0.5；4 需 0；5 需 4；6 需 3+5；
7 需 3+5；8 随 6。整体：#0/#0.5 → #1 → #2 → #3 → #4 → #5 → (#6,#8,7)。

---

## 5. 风险清单

> 每个非机械改动 ≥1 失败模式 + 缓解；高风险（跨半区、冷数据、分页竞态）≥2。条目格式 What/Why/Where/Risk/How 已并入各条（粗体=失败模式，→=缓解）。

### A. 数据获取/完整性

1. **host 拿不到完整历史 / 会话未持久化**（**修订：在 spike #0 门禁中前置验证**）
 - 失败模式：`ctx.sessionPersistence` 未配置，或该 session 仅存在于内存且恰逢 dispose，`turnIndex`
   拿不到全量事件 → 刻度数失真。
 → 缓解：#0 门禁先行验证 `sessionPersistence` 可注入 + 对真实主会话 `inspect` 可取含 `turn/start` 的
   完整 events，通过才继续；不通过则 **fallback**（用现有 `session.history` 翻页数回合数，或标注
   「依赖本地持久化后端，缺失时本地降级」）。host 侧优先读 live `ctx.sessions.get(id).events`；
   持久化缺失时返回 `{ok:false, code:'session-not-found'}`；client 收到失败**整体退化**为现有
   「只看已加载」行为（不显示全量刻度、不改变任何既有交互），回归面=0。
2. **数据量过大（数百回合）导致 payload 臃肿/首屏慢**
 - 失败模式：全量索引含每回合完整文本，几百回合下 JSON 数十~上百 KB，拖慢挂载。
 → 缓解：`preview` 严格截断 120 字符；索引单次拉取 + client 按会话缓存；node 侧按 `asOfSeq` 缓存可选；
   已加载回合 tooltip 仍走快照原文，host preview 只兜底未加载点。
   （**备注：** 建议 3/4 —— total 上界 / 双缓存收敛保持原样采纳：**首版不做规模上界，超长会话（>1 万事件）
   留给后续**，本条目缓解只针对常规规模。）
3. **compaction 边界判定错误**
 - 失败模式：`compaction/summary.shadowedSeqs` 与「该回合首条 user/message seq」求交时，若某回合同时
   被两轮压缩覆盖、或 seq 恰为占位 user/message 自身，误标 compacted 或漏标。
 → 缓解：以 `shadowedSeqs`（完整 seq 数组）为唯一判据，用首条 user/message 的 `seq` 求交；不依赖
   `surfaceOp`/次序；对「无法判定」的回合约退为非 compacted；占位 user/message（带 `<compacted-summary>`）
   仅作展示提示，不参与 compacted 判定。若发现判定不可靠，降级为「按 turn/start 全显、灰色仅靠
   preview 为空提示」，不阻塞全量刻度主功能。
4. **subagent/子会话**（`dsh-api-remotes` 报告：subagent 属主的 session 被 `agent-busy` 栅栏挡住）
 - 失败模式：当前会话若是 subagent 子会话，persistence 直读/`ctx.sessions.get` 拿不到完整血缘日志，
   `turnIndex` 只能给部分或失败。
 → 缓解：handler 对 subagent 属主按 `session-not-found` 处理；client 该会话退化为已加载刻度；
   主会话（默认 UI 显示的主体）不受影响；BRIEF 未要求子会话刻度，属明确不适用的正常范围。

### B. 分页加载竞态/交互正确性

5. **连续点击多个未加载点，loadOlder 并发/竞态**（含**会话切换漏态**，重要 3）
 - 失败模式：用户在加载循环进行中又点别的未加载点，两个 `loadOlder` 循环互相覆盖 `loadingOlder`
   状态（store 有 `loadingOlder` 互斥），导致目标串位或停不下来；或加载循环进行中**切换会话**，旧循环
   继续往新会话窗口写数据。
 → 缓解：加载循环统一收进 `ensureTurnLoaded`（**单飞**，同一时刻一个 loop；sessionToken 绑定发起时的
   `sessionId`），每次 `loadOlder` 回调前断言 token 仍对应当前会话，**会话切换立即终止循环并清理**；
   `loadOlder()` 本身在 `loadingOlder` 时直接 no-op（store 语义），循环以「目标 key 现形 或
   `hasMore===false`（host 权威）」为终止，并加 `MAX_LOAD_PAGES`（如 40）硬上限防死循环；超限后照旧滚到已加载最前。
6. **加载更早改变窗口导致刻度闪烁/跳变**
 - 失败模式：`loadOlder` 前插后，已加载回合集合变化，若刻度刷新逻辑按「已加载数」推导会闪。
 → 缓解：总回合数**只**来自 host `turnIndex`（不随加载变化，满足成功标准 1）；已加载/未加载状态逐行
   判定是「加速」而非「重排」，dom 用 key 稳定，避免 react 重挂导致闪烁。

### C. 安全/敏感面（对照 BRIEF 声明逐条）

7. **读会话历史越权/泄露他用户数据**
 → 只读本会话（`sessionPersistence.inspect(sessionId)` 仅接受来自 RPC 的 `sessionId`，且走既有
   `session-not-found`/cwd 校验语义）；返回字段仅 `turn/preview/compacted`，不含原始会话模型以外信息，
   与「用户自己的会话数据」范围一致，无跨用户读取路径。
8. **新增外部网络请求 / 数据外发**
 → 数据只在 host↔client **本机**范围内流动：`connection.rpc.call` 的路由挂在 `webServer` 本机
   loopback，且仅 POST 我们自己的 `/turn-scrubber/*` channel（`HostConnectionService` 默认 loopback
   fence + `isTrustedApiRequest`）。不引入任何第三方/远端 URL 调用。
9. **记录/输出会话内容到日志**
 → node 半区不 `logger` 输出 preview/文本，只输出必要错误码/ids；client 沿用现有不落盘原则。
   `turn-index.ts` 纯函数不产生任何输出。BRIEF「不输出任何会话内容到日志」全量遵守。

### D. 其他

10. **purity gate 误拦/编译失败**
 - 失败模式：client 侧若误 import 了 `dsh-host-apiproxy` 等值或新增非白名单依赖，构建炸。
 → 缓解：client 只用 cordis 注入（`ctx.connection`/`ctx.sessions`），零新 import；`tsdown.config.mjs`
   白名单不动；新增纯类型（context-types）不触发 gate。构建期用现成 `node build.mjs` 校验。
11. **onOpenState 变化（会话未 open）时 loadOlder no-op**
 → `loadOlder()` 在 `openState!=='open'` 直接返回；加载循环先断言 `openState==='open'`，否则不作
   未加载跳转并提示（加载更早按钮本来也不可用）。已加载点的跳转不受影响。

---

## 附：关键勘察证据（API 名 / 文件位置）

| 事实 | 来源 |
|---|---|
| 跨半区只能 cordis/RPC/HTTP，client 有 purity gate | `tsdown.config.mjs` `purityGatePlugin`、`CLIENT_EXTERNALS`/`INLINE_SAFE` |
| host 冷读全量日志：`ctx.sessionPersistence.inspect(id)→{meta,events}`；`list()`；live `ctx.sessions.get(id)` | `dsh-session-persistence/README.md`（inspect）；`dsh-session/README.md`（SessionStore/sessions） |
| `session.history` 内部 = live→persistence 的 `historySourceFor` 冷读 | `dsh-host-apiproxy/lib/index.js`（`historySourceFor` L2043、`inspectApiRemoteSession` L81-92） |
| 回合权威 = `turn/start` 事件；turn 号在 `data.turn` | `dsh-session/README.md` |
| compaction 追加 `compaction/summary` + `shadowedSeqs`；纯追加不删旧事件；`turn/start` 恒在 | `dsh-compaction-basic/lib/index.js`（583-630）；`dsh-compaction/README.md` |
| client 已加载回合 `snapshot.chat.locations.turns = Map<turn,nodeKey[]>`；`data-chat-anchor-key=node.key` | `dsh-client-runtime/lib/client.js`（`ConversationLocationIndex`、`buildSnapshot`、`chatNode` anchorSeq=seq） |
| client `loadOlder()` 现成：`binding.session.loadOlder()` → `history({beforeSeq,maxMessages:50})`；`hasMore` host 权威 | `dsh-client-runtime/lib/client.js`（`loadOlder` L7389、`buildSnapshot` 含 hasMore）；`dsh-client-ui-conversation/lib/client.js`（`conversation.loadOlder` L249, `binding.session.loadOlder` L257） |
| 通用跨半区只读 RPC：node `ctx.connection.rpc.handle(channel,h)`；client `ctx.connection.rpc.call(channel,ep,payload)` | `dsh-client-connection/lib/index.js`（`HostConnectionService.rpc.handle`）、`lib/client.js`（`createWebConnectionRpc.call`、`handle.rpc`) |
| HTTP route 注册接口 `ctx.webServer.register({kind,path,handler})` | `dsh-host-webserver/lib/index.js`（`WebServer.register`） |
