# INTERFACE — 回合刻度显示所有回合：对外接口约定

> 本文件是测试设计的**唯一方案输入**。只看本文件即可照着写测试，不需要看 PLAN 全文。
> 描述到「实现细节无关、行为可验证」的程度。

---

## 1. 数据获取接口：回合索引

### 1.1 通道

一个**新增的本机 HTTP RPC 端点**，走 cordis 通用 `connection.rpc` 通道。

> **修订：（重要 2 / spike #0.5）** 下表 URL / Channel / Endpoint / 载荷是对**真实 `connection.rpc`
> 协议形态的既定假设**。真实 URL 信封（path 是否已含 endpoint、body 里 method 与 endpoint 的取法、
> 非 200 的错误语义）须由 spike #0.5（node `rpc.handle('/spike-echo')` + client
> `call('/spike-echo','echo',…)`）**实测回填**后再锁定；下面 curl 是回填前的占位示意。

| 项 | 值 |
|---|---|
| Method | `POST` |
| URL | `{origin}/turn-scrubber/turnIndex` |
| Content-Type | `application/json` |
| Channel（node 侧注册路径前缀） | `/turn-scrubber` |
| Endpoint | `turnIndex` |
| 载荷范围 | 仅宿主进程本机 loopback（`webServer` 默认 loopback fence + `isTrustedApiRequest`）；无外部网络 |

**修订：（建议 5 / preview 信任边界）** 本端点返回的 `turns[].preview` 及未加载回合摘要属于**会话内容**。
该端点只允许**本机可信来源**调用：loopback 地址 + `isTrustedApiRequest` 校验来源（沿用 `HostConnectionService`
默认 fence）；handler 侧核对调用来源，非本机可信来源一律拒绝（HTTP 403 或业务 `unavailable`），不给
会话文本预览。

`curl` 等价示意（测试可直接用）：
```bash
curl -X POST http://127.0.0.1:{port}/turn-scrubber/turnIndex \
  -H 'content-type: application/json' \
  -d '{"type":"client-request","rpcId":"test-1","method":"turnIndex","payload":{"sessionId":"<id>"}}'
```
> 客户端实际经 `ctx.connection.rpc.call('/turn-scrubber','turnIndex',{sessionId})` 调用，签名
> `call(channel, endpoint, payload, signal?)`，返回值为 endpoint 的返回值（即 §1.3 的 result 字段本身，
> 不包 `{ok}`）。测试既可发 HTTP，也可用 cordis 注入的 `connection.rpc.call`。

### 1.2 入参（payload，JSON）

```jsonc
{ "sessionId": "<会话 id 字符串>" }   // 必填；取值 = 会话绑定的 sessionId
```

### 1.3 出参（result 字段，JSON）— 成功

```jsonc
{
  "ok": true,
  "sessionId": "<会话 id 字符串>", // 生成索引所基于的会话 id（供 client 渲染前核对，重要 3）
  "asOfSeq": 123,          // 构造索引所依据的最后一个事件 seq；会话无事件时为 -1
  "total": 27,             // 该会话总回合数 == turns.length（按 turn/start 计，含未加载与已压缩）
  "turns": [               // 按 turn 号升序，turn 0 = 最老的回合
    { "turn": 0, "preview": "…首条用户消息前120字符…", "compacted": false },
    { "turn": 1, "preview": "",                             "compacted": true },  // 该回合被压缩
    // …共 total 项，turn 号连续 0..total-1
  ]
}
```

字段与语义：

| 字段 | 类型 | 语义 |
|---|---|---|
| `ok` | boolean | 恒 `true`（成功分支） |
| `sessionId` | string | 本索引基于的会话 id，等于请求入参 `sessionId`。client 渲染前必须与当前绑定会话核对，不符即丢弃/重拉（重要 3 会话切换漏态） |
| `asOfSeq` | number | 本索引基于的事件 seq；无事件为 `-1` |
| `total` | number | 会话总回合数（= `turns.length`）。**权威口径 = 日志里 `turn/start` 事件的数量**，不因「加载更早」或 compaction 变化，只随新增回合增长 |
| `turns` | array | 全量回合索引，按 `turn` 升序、`turn` 值连续 `0..total-1` |
| `turns[].turn` | number | 回合号（与 `turn/start.data.turn` 同一编号体系）。**spike 实测：从 1 开始连续递增**（非 0 基）；`total` 个回合 = turn `1..total` |
| `turns[].preview` | string | 该回合**最后一条** `user/message` 的文本（spike 实测：回合内首条 user/message 多为系统注入，最后一条才是用户输入），截断到 **120 字符**；回合内无 user/message 时为空串 `""`；已压缩回合为压缩摘要文本（`compaction/summary.data.summary`，同样 ≤120 字符截断；测试只检查「存在 preview 字段、类型 string、长度 ≤120」） |
| `turns[].compacted` | boolean | 该回合是否被 compaction 遮蔽（判定依据：该回合首条用户消息的 `seq` 落在任一 `compaction/summary.shadowedSeqs` 或 `compaction/prune.shadowedSeqs` 集合内）。无压缩会话恒为 `false` |

### 1.4 出参 — 错误契约

| 触发条件 | `result` 形状 | `error.code` |
|---|---|---|
| 会话 id 在 live store 与持久化中都找不到 / 无可用 cwd / 属性属于 subagent 路由管控 | `{"ok":false,"error":{"code":"session-not-found","message":"<含 sessionId 的说明>","details":{}}}` | `session-not-found` |
| 持久化后端未配置且会话不在内存 / 后端读取失败 / 其它不可预期失败 | `{"ok":false,"error":{"code":"unavailable","message":"<稳定、不含会话内容>","details":{}}}` | `unavailable` |
| 请求体不是合法 JSON client-request 信封 / method 与 endpoint 不符 | 信封非法 → HTTP `400`；method≠endpoint → HTTP 200 + `{"ok":false,"error":{"code":"bad-request",...}}` | `bad-request` |
| 非可信来源（loopback authority 且请求非本机） | HTTP `403` | — |

- **业务错误恒 HTTP 200**，以 `result.ok===false` 区分（与 DSH 既有 `session.history` 一致）。
- **非法信封 / method 不匹配 / 非 JSON 体才出现非 200**：`404`（未知 endpoint）、`415`（content-type
  非 JSON）、`400`（体非 JSON）、`500`（handler 抛错）。这些属于调用方 bug，不在业务契约内。
- **修订：（建议 2a）`sessionId` 缺失或为空串** 属于调用方 bug，HTTP `400`（不返回业务 `ok:false`）。
- **修订：（建议 2b）`error.details` 形状** 定义为 `{}` 或仅含 `sessionId` 一个键（以便定位是哪个会话
  失败）；**绝不**含会话文本/摘要等内容字段。测试不断言 details 内部，只断言其为 object。
- `error.message` 绝不携带会话内容（文本/摘要）。测试只断言 `code` 与 `ok`，不断言 message 文案。
- **注意**：`connection.rpc.call` 在 HTTP 非 200 时会 throw（`transport failure … HTTP <status>`）；
  在 `ok:false` 时返回 `{ok:false,error}` 而**不** throw。行为测试应分别覆盖这两种情形。

---

## 2. client 侧新增对外行为

### 2.1 刻度总数来源

- 刻度**总行数** = `turnIndex.turns.length`（即 `total`），来自 host，**不得**从已加载 DOM 推导。
- 因此：**「加载更早」操作不会改变刻度总数**（成功标准 1）。仅当会话新增回合（用户发送新消息）时总数 +1。
- **修订（重要 3 会话切换漏态）：** 渲染前先核对 `turnIndex.sessionId === 当前绑定会话 id`；不符（拿到的
  是另一个会话的索引）→ 则该响应作废，丢弃并重试/回退，**不得**用旧索引渲染当前会话刻度。

### 2.2 每一根刻度的三态判定（client 渲染依据）

对索引第 `i` 根线（0 基下标；**对应 turn 号 `i+1`**，spike 实测 turn 号 1 基）：

| 状态 | 判定 | 悬停/点击行为 |
|---|---|---|
| `loaded` | `snapshot.chat.locations.turns.get(i + 1)` 非空且含可见节点（turn 号 1 基） | 波形放大 + tooltip（文本取 client 快照原文，走既有路径） + **点击平滑滚动**到该回合首节点的 `[data-chat-anchor-key]`（既有 `scrollToRow`） |
| `compacted` | 未 loaded 且 `turnIndex.turns[i].compacted === true` | 渲染为**灰色占位线**；tooltip 显示「已压缩」类提示；**点击滚动到「加载更早」控件附近**（不跳原文；加载更早控件不可用时滚动到已加载窗口最前一行） |
| `unloaded` | 未 loaded 且 `compacted === false`（即还有未加载的历史回合） | tooltip 显示 `preview`（≤120 字符，空则「(空消息)」）；**点击自动连续加载更早历史直到该回合出现在已加载窗口，再平滑滚动**到其 key（见 §2.3 加载循环） |

> 三态互斥；`loaded` 优先于 `compacted`/`unloaded`（同一回合已加载时按 loaded 处理）。
> **修订（重要 5）：** 上述 `i`（线索引 = host 索引下标）与 `locations.turns` 的 key（turn 号）默认假定
> 恒等（spike #0 验证三项一致）；**若实测键不一致**，三态判定与滚动一律走**显式映射函数**
> `turn → locations.turns key`（或反之），不假定下标恒等。测试覆盖「键一致」与「键不一致（映射后）
> 」两种场景。

### 2.3 未加载回合点击的调用链（加载循环）

1. `turnId = i`（点击的线索引）。
2. 若 `snapshot.chat.locations.turns.get(turnId)` 已存在 → 直接平滑滚动到该 key，结束。
3. 否则进入**单飞**加载循环（同一时刻只允许一个循环；若已有循环在跑，本次点击排队或取消，实现自定，
   但**不得出现两个并发 `loadOlder` 交叠写窗口**）。**修订（重要 3）：** 循环带 `sessionToken`（绑定发起时
   当前会话的 `sessionId`）；**每次 `loadOlder` 回调返回前先核对 token 仍是当前会话**，一旦会话切换立即
   终止循环并清理（后续响应丢弃，不写当前窗口）：
   - a. 若 `openState !== 'open'` 或 `hasMore === false`（host 权威）→ 无法再加载更早，滚动到已加载窗口最前一行，结束。
   - b. 调用 `binding.session.loadOlder()`（无参，内部拉一页约 50 条历史前插进窗口）。
   - c. 重新读取 `snapshot.chat.locations.turns`：
      - 若 `get(turnId)` 现已存在 → 平滑滚动到该 key，结束。
      - 若 `hasMore === false`（host 权威 false）→ 已到最老仍未现形 → 滚动到窗口最前，结束。
   - d. 循环计数 +1；超过 **`MAX_LOAD_PAGES = 40`** → 强制停止，滚动到窗口最前，结束。
   - e. 未超限 → 回到 b。
4. 加载多页耗时较长时，UI 应显示轻量「加载中…」状态（实现自定），不得阻塞已加载线的悬停/滚动。

### 2.4 加载循环终止条件（可测试断言）

循环在以下任一条件满足时**终止**：
1. 目标 `turnId` 的 key 已出现在 `snapshot.chat.locations.turns`（目标达阵）；或
2. `hasMore === false` **且该 false 来自 host 权威**（已拉到最老）——这是唯一的正常停止依据；或
3. 已执行 `loadOlder` 次数达到 `MAX_LOAD_PAGES (40)`；或
4. `openState !== 'open'`（会话未打开，无法加载更早）。

> **修订（重要 4/语义收敛）：** `hasMore` **唯一权威 = host**。client 侧断档时的兜底置 `false`
> （并不可靠）**不作为正常停止依据**：若循环里 `hasMore` 变 false 但服务端没有明确给出最老信号（即疑似
> 断档兜底），只按**异常兜底**处理——记录一条去敏 warning 并滚动到窗口最前结束，不得把它当作「已到最老」的正常路径。
> 测试断言：正常场景以 host 权威 false 结束；非 host 信号不触发「正常结束」分支。

> 测试建议：用一个只有一页历史的小会话，或用一个「目标刚好在第二页」的边界用例，验证循环恰好加载
> 到目标出现为止（不超载）、并在 `hasMore=false` 时停止。竞态用例：连点两个未加载点，最终只有一个
> 活动循环，且窗口不被并发写坏。**修订（重要 3）：** 补一条「**加载循环进行中切换会话**」的竞态用例：
> 切换后旧循环立即终止、不再写回新窗口，`turnIndex.sessionId` 与当前会话不符的响应被丢弃。

### 2.5 失败/退化路径（可测试断言）

- 若 `turnIndex` 拉取失败（`session-not-found` / `unavailable` / 网络错 / HTTP 非 200）：
  - **整体退化**为现有「只看已加载回合」行为：刻度只渲染 `snapshot.chat.locations.turns` 里已加载的
    回合；**不显示**全量/未加载/压缩占位；**不改变**任何既有悬停、tooltip、已加载平滑滚动。
  - 不应报错打断、不应 blank、不应重复失败弹窗；控制台可有一条去敏 warning。
- 单个未加载回合点击在加载循环中失败同理：终止循环、回退到已加载窗口最前，不抛给渲染层。

---

## 3. 新增的 client 类型（供测试/调用方参考的只读形状）

```ts
// 回合索引条目（来自 turnIndex 成功响应）
interface TurnIndexEntry { turn: number; preview: string; compacted: boolean }
interface TurnIndexResult {
  ok: true; sessionId: string; asOfSeq: number; total: number;
  turns: TurnIndexEntry[];                  // turn 升序且 turn===下标，长度===total
}
interface TurnIndexError { ok: false; error: { code: 'session-not-found' | 'unavailable'; message: string; details: Record<string, unknown> } }

// 未加载回合点击的加载循环结果（suggestion 1，封装进 ensureTurnLoaded）
type EnsureLoadedResult = '达成' | '到最老' | '超限' | '会话切换' | '已加载'
// ensureTurnLoaded({binding, turnId, token})——单飞循环、会话切换终止、终止条件全在此；成功时已滚动到目标。

// 已扩展的 SessionFace（client 侧注入 ctx.sessions.binding(id).session 上新增可用）
interface SessionFace {
  // 既有：subscribe(listener): unsub; snapshotCache: SessionSnapshot
  loadOlder(): Promise<void>                // 新增：拉一页更早历史，前插进窗口，更新 hasMore
}
interface SessionSnapshot {
  // 既有：sessionId; chat?: { order; nodes; locations:{turns?: Map<number,string[]>} }
  hasMore: boolean                          // 新增：host 权威「是否还有更早」
  loadingOlder: boolean                     // 新增：是否正在加载更早
  openState?: string | undefined           // 新增：'open'|其它；未开时不能加载更早
}
```

> `locations.turns` 的 key 类型是 `number`，**默认与索引 `turns[].turn` 同号**（§2.2 判定）；
> 若 spike #0 实测不一致，则经显式映射函数（`turn → key`）转换后判定。
> `chat.nodes.get(key).data?.content` 仍是既有 tooltip 文本来源。

---

## 4. 外部可见的常量/上限（测试引用）

| 常量 | 值 | 语义 |
|---|---|---|
| `preview` 截断长度 | 120 | 索引里 preview 最大字符数（≤） |
| `MAX_LOAD_PAGES` | 40 | 未加载点加载循环的 `loadOlder` 次数硬上限 |
| 每页历史条数 | 50（host 默认） | `loadOlder` 每次拉取的消息数（由 host/既有 store 决定，测试不硬编码） |
| 三态优先级 | `loaded` > `compacted` > `unloaded` | 线状态判定次序 |
