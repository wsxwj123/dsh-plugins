# TEST-PLAN — 回合刻度显示所有回合：验收测试清单

> 依据唯一方案输入 `INTERFACE.md`（对外接口契约）编写。黑盒视角：只测对外行为与接口形状，
> 不看任何实现代码。所有用例分「**A=自动可测**」与「**M=需人工实测**」两类，逐项给精确步骤与通过判据。
>
> 环境前提：本机 DSH web profile（loopback `127.0.0.1`，GUI 观察基址 3080，RPC 端口以实际
> `{origin}` 为准），真实会话存档在 `~/.dsh/sessions/`。文末「固定样本」给出已实测校准的真实会话
> 及其独立核对方法，供数据正确性用例复用。

---

## 0. 固定校验样本（真实数据锚点，全用例共用）

以下结论已在本机真实存档实测校准，用于「预期值」对照：

| 项 | 真实值（已实测） |
|---|---|
| 会话 id（固定样本 S1） | `session-ba4e9cd6-569e-4115-9c97-36778fea27ca` |
| `turn/start` 事件数 | **276**（turn 号 1..276，连续无缺跳） |
| 按契约口径计「已压缩」回合数 | **269**（判定口径见下） |
| 按契约口径计「已加载（非压缩）」回合数 | **7** |
| 首个采样会话（极短，含未压缩，可用作回归样本） | `session-501eacbc-144b-4f85-99ef-62a39cbf7530`（turn/start=6，无 compaction） |

**compacted 独立核对方法（不依赖本插件，直接用原始日志）**：
对存档 `session.jsonl.zstd` 解压，逐事件在 seq 时序内做两件事——
1) 记下当前 turn（碰 `{"type":"turn/start","data":{"turn":N}}` 时更新）；
2) 每遇 `{"type":"user/message"}` 且当前 turn 首次出现，记录 `(turn → 该消息的 seq)`；
   每遇 `compaction/summary` 或 `compaction/prune`，把其 `data.shadowedSeqs[]` 全并入集合 S。
最后：`total = turn/start 计数`；`compacted = 首条 user/message 的 seq ∈ S 的回合数`。

> 注意：要按「**该回合首条 user/message 的 seq**」，不是 turn/start 自身 seq（后者不会被 shadow）。
> 若按 turn/start 自身 seq 判会得 0，那是口径错误。S1 上按正确口径复现恰好 = **269**。

---

## 1. 数据接口测试（turnIndex 端点）— 全部 A（自动，curl/脚本）

> RPC 信封参考：`curl -X POST {origin}/turn-scrubber/turnIndex -H 'content-type: application/json'
> -d '{"type":"client-request","rpcId":"<id>","method":"turnIndex","payload":{"sessionId":"<id>"}}'`
> （INTERFACE §1.1；真实信封形态二选一：HTTP 或注入 `connection.rpc.call('/turn-scrubber','turnIndex',{sessionId})`。
> 若 spike 回填后实际 URL 信封与占位不同，以下用例的「请求构造」按实测形态替换，断言不变。）

| # | 用例 | 步骤 | 预期 / 判据 | 类型 |
|---|---|---|---|---|
| 1.1 | 成功：真实存在、含全量历史的会话 | 对 **S1** 发 POST，payload `{sessionId:S1}` | HTTP **200**；`result.ok===true`；`result.sessionId===S1`；`result.asOfSeq` 为数值（>0，因有事件）；`result.total===276`；`turns.length===276`；`turns[i].turn===i+1`（1 基，下同）；每项含 `turn`(number)/`preview`(string,≤120)/`compacted`(boolean)。`compacted===true` 项数===269，`false` 项数===7 | A |
| 1.2 | 成功：无压缩的短会话 | 对 `session-501eacbc-…` 发 POST | HTTP 200；`ok:true`；`total===6`；全部 `turns[].compacted===false`；turn 1..6 连续；`asOfSeq`>0 | A |
| 1.3 | 成功：会话无任何事件（空） | 用一个 live 中、尚无 `turn/start` 的空会话 | HTTP 200；`ok:true`；`total===0`；`turns===[]`；`asOfSeq===-1`（契约 §1.3：无事件为 -1） | A |
| 1.4 | 失败：不存在的 sessionId | payload `sessionId:"no-such-session-xyz"` | HTTP **200**（业务错误恒 200）；`result.ok===false`；`result.error.code==="session-not-found"`；`error.message` 为 string；`error.details` 为 object（不断言内部键，契约 §1.4 修订 2b）。**注意：`connection.rpc.call` 在此分支返回 `{ok:false,error}` 而不 throw** | A |
| 1.5 | 失败：body 非合法 JSON client-request 信封 | body `not-json` 且 content-type json | HTTP **400**（非法信封/非 JSON 体 → 非 200，契约 §1.4）。**`connection.rpc.call` 此处会 throw**（HTTP 非 200 → throw） | A |
| 1.6 | 失败：method 与 endpoint 不符 | 信封内 `method:"otherMethod"`，endpoint 仍 `turnIndex` | 按契约 = 非业务错。若实现映射为 HTTP 200+`{ok:false,code:"bad-request"}` 或 404，按 spike 回填后的真实语义断言；至少断言「不是 session-not-found/unavailable」（属于调用方 bug 通道） | A |
| 1.7 | 失败：content-type 非 JSON | 同合法 body，但 `content-type: text/plain` | HTTP **415** | A |
| 1.8 | 失败：GET 请求 | 用 GET 打同一 URL/endpoint | HTTP **404**（未知 endpoint 通道，契约 §1.4） | A |
| 1.9 | sessionId 缺失/空串（调用方 bug） | 发 POST，body 不含 sessionId / sessionId="" | HTTP 200 + `{"ok":false,"error":{"code":"bad-request",...}}`（契约修订：connection.rpc 通道固定 HTTP 200，400 不可达） | A |
| 1.10 | 失败：错误信封（非 2xx）不 throw 差异 | 分别走 1.4（ok:false）与 1.5/1.7/1.8（非 2xx） | ok:false 分支**不 throw**、返回错误对象；非 2xx 分支 **throw**（`transport failure … HTTP <status>`）。用 `connection.rpc.call` 断言两种途径（INTERFACE 末尾「注意」） | A |

---

## 2. 真实数据正确性测试 — 全部 A（脚本可自动；给出可独立复核方法）

> 目的：验证 turnIndex 的 `total`/`compacted`/`preview` 与真实日志一致。判据不依赖本插件的实现，而依赖 §0 的独立核对方法。

| # | 用例 | 步骤 | 预期 / 判据 | 类型 |
|---|---|---|---|---|
| 2.1 | total 与 turn/start 计数一致 | 对 S1 拉 turnIndex；同时用 §0 方法数原始日志 `turn/start` 事件数 | HTTP 返回 `total===276===turn/start 计数`；`turns.length===total` | A |
| 2.2 | compacted 标记与 shadowedSeqs 判定一致 | 对 S1，逐 turn 把返回的 `compacted` 与 §0 独立判定（首条 user/message seq ∈ S）比对 | 269 项 `compacted:true` 与独立判定完全一致；7 项 `false`；无错位（契约 §1.3 turns[].compacted） | A |
| 2.3 | turn 号 1 基连续 | 遍历 `turns[].turn` | 等于 `range(1,total+1)`，无缺、无跳、无重复 | A |
| 2.4 | preview 非空且来自 user/message 或 summary | 取 S1 若干非压缩 turn 的 `preview`，用 §0 方法解出该回合**最后一条 user/message 文本**截 120 对比；另取已压缩 turn 的 `preview`，解出 `compaction/summary.data.summary` 文本截 120 对比 | 非压缩 turn：preview === user 最后消息文本前 120 字符（空串仅当该回合无 user/message）；已压缩 turn：preview === summary 文本前 120 字符。抽查 ≥3 个样本即可；逐项断言 `isinstance(str)` 且 `len≤120`（契约修订：测试只断言存在/类型/长度 ≤120，不必全量逐字等同） | A |
| 2.5 | 长度上限 | 扫全量 `preview` | 全部 `len≤120`，含压缩与未压缩 | A |

---

## 3. 客户端三态渲染（浏览器行为）— 以 M 为主（界面可见性），部分 A（DOM 断言）

> 观察对象：会话右侧的横线刻度簇。用 **S1**（269 压缩 / 7 非压缩）应在单屏内看到三种可区分状态。

| # | 用例 | 步骤 | 预期 / 判据 | 类型 |
|---|---|---|---|---|
| 3.1 | 三态视觉可区分 | 打开含 7 个可见回合（已加载）+ 大量老压缩回合的会话；肉眼/截图区分 | 已加载线 / 未加载线 / 灰色压缩占位线**三者形状或颜色可区分**；压缩占位明显偏灰（契约 §2.2「灰色占位线」） | M |
| 3.2 | 已加载线 hover | 悬停一条已加载线 | 波形放大 + tooltip（文本取该回合首 user/message 原文，走既有路径） | M |
| 3.3 | 未加载线 hover 显示 preview | 悬停一条未加载（非压缩且未加载）线 | tooltip 显示 preview（≤120）；空则显示「(空消息)」（契约 §2.2） | M |
| 3.4 | 已压缩线 hover 显示「已压缩」 | 悬停一条灰色压缩线 | tooltip 为「已压缩」类提示，不展示原文文本 | M |
| 3.5 | 刻度总数不随「加载更早」变化 | 记录当前刻度总数。触发「加载更早」拉到更多历史；再次读数 | 总数**不变**；仅当用户发新消息才 +1（契约 §2.1） | A/M |
| 3.6 | unloaded → loaded 无闪烁 | 对一个目前未加载的回合，先点它触发加载，观察窗口变化 | 该线从非加载态变为加载态，窗口不整屏跳动/闪烁、无空白帧（加载中应显示轻量态，不阻塞已加载线 hover） | M |
| 3.7 | 三态优先级：loaded > compacted > unloaded | 找一个「已压缩但已加载」的回合（S1 中压缩回合若存在于快照） | 该线按 **loaded** 处理（波形放大/可平滑滚动），而非灰色占位（契约 §2.2 优先级） | M |

---

## 4. 加载循环（未加载刻度点击）— A/M 混合，重点是终止条件与竞态

> 方法锚：加载循环终止条件见契约 §2.3/§2.4：目标达阵 / hasMore=false(host 权威) / MAX_LOAD_PAGES=40 / openState≠open。断言可部分用浏览器自动化（Puppeteer/Playwright on 3080）+ 打点。

| # | 用例 | 步骤 | 预期 / 判据 | 类型 |
|---|---|---|---|---|
| 4.1 | 点击未加载刻度 → 连续加载直到目标出现并滚动到位 | 选一条未加载线 i，点它 | 循环 `loadOlder` 逐页拉取，直到 `locations.turns.get(该线 turn 号)` 出现，随后**平滑滚动**到该回合首节点 `[data-chat-anchor-key]`；期间 UI 有轻量「加载中」；结束后该线变 loaded | A |
| 4.2 | 边界：目标刚好在第二页 | 用「目标在第一页之后即出现」的小会话或构造点，点目标 | 循环恰好拉 1 页（目标出现即停），**不超载** | A |
| 4.3 | 终止：hasMore=false（host 权威）停止 | 拉最老时仍没现形（或用只有一页的小会话点一条不存在的超老线） | 循环在 hasMore=false（host 权威，非 client 兜底）时**正常结束**，滚动到窗口最前；不无限循环 | A |
| 4.4 | 终止：MAX_LOAD_PAGES=40 | 构造超 40 页仍不见的目标（或注入计数观察） | 计数达到 **40** 次 `loadOlder` 即强制停止，滚动到窗口最前（契约 §2.3-d、常量 40） | A |
| 4.5 | 终止：openState≠open | 会话处于未打开/非 open 状态点时 | 不拉历史，直接滚动到窗口最前结束（契约 §2.3-a） | A |
| 4.6 | 竞态：连点两个未加载刻度，只有单循环 | 快速连续点两条不同的未加载线 | 最终**同一时刻只有一个活动加载循环**；窗口每次只被一个循环写，不被并发写坏；第二条点击排队或取消（契约 §2.3「单飞」）；已加载悬停保持响应 | A |
| 4.7 | 竞态：加载循环中切换会话 | 在对 S1 点未加载线启动循环后，立即切到另一会话（如 S2） | 旧循环**立即终止**，不把旧历史写进新窗口（sessionToken 核对失败即清理）；`turnIndex.sessionId !== 当前会话` 的响应被丢弃，刻度跟随新会话 | A |
| 4.8 | 非 host 信号不触发「正常结束」 | 模拟 client 侧断档置 hasMore=false（非 host 权威） | 只走「异常兜底」：记录去敏 warning + 滚动到窗口最前结束，**不**当作「已到最老」正常路径（契约 §2.4 修订 4） | A |
| 4.9 | 加载中不阻塞已加载线 | 循环进行中，hover/点击一条已加载线 | 已加载线的波形放大、tooltip、平滑滚动照常，不被加载循环阻塞（契约 §2.3-4） | M |

---

## 5. 失败 / 退化路径 — A（可脚本制造成因）+ M（观察界面）

| # | 用例 | 步骤 | 预期 / 判据 | 类型 |
|---|---|---|---|---|
| 5.1 | turnIndex 整体失败 → 退化回「只看已加载」 | **人为制造失败**：(a) 改 node 半区/注入返回错误；(b) 或把绑定会话指到不存在的 sessionId 触发 `session-not-found`；(c) 或临时改 host 使 call 抛网络/非 2xx 错 | 刻度退化为「只渲染 `snapshot.chat.locations.turns` 里已加载回合」；**不显示**全量/未加载/压缩占位；**不改变**既有悬停/tooltip/已加载平滑滚动；无报错弹窗、不 blank；控制台至多一条去敏 warning | A/M |
| 5.2 | 业务错误 session-not-found 不破碎 | 触发 5.1(b) | 同 5.1 退化结果；不 blank、不重复弹窗；`connection.rpc.call` 返回的 `{ok:false}` 被当作失败处理（不 throw） | A/M |
| 5.3 | 单个未加载点加载循环中失败 | 点击未加载线，加载循环出现 host 失败 | 终止循环、回退到已加载窗口最前；不抛给渲染层；控制台可有一条去敏 warning | A/M |
| 5.4 | 无报错打断 / 不 blank | 完成 5.1~5.3 各一遍后 | 界面始终可交互，无白屏、无未捕获错误堆叠 | M |

---

## 6. 回归（既有交互不破坏）— M/A

| # | 用例 | 步骤 | 预期 / 判据 | 类型 |
|---|---|---|---|---|
| 6.1 | 已加载回合悬停波形放大 | 悬停任意已加载线 | 波形放大行为与改动前一致（走既有路径） | M |
| 6.2 | 已加载 tooltip | 悬停已加载线 | tooltip 文本 = 该回合首 user/message 原文，展示正常 | M |
| 6.3 | 已加载点击平滑滚动 | 点一条已加载线 | 平滑滚动到该回合首节点 key（既有 `scrollToRow`），不跳变 | M |
| 6.4 | 会话切换后刻度跟随新会话 | 从 S1 切到无压缩短会话 `session-501eacbc-…` | 刻度总数变成新会话 total（6）；无旧索引残留（契约重要 3 会话切换漏态：sessionId 核对不符即作废丢弃） | A/M |
| 6.5 | 短会话/无压缩下三态退化 | 在无压缩短会话观察 | 全部落 unloaded（或已 loaded）；无压缩占位线；总数正确 | M |
| 6.6 | 键映射：turn vs locations key 一致/不一致 | 若 spike 实测两者同号直接通过；实现若不提供显式映射则重点人工核对 | 三态判定与滚动在「键一致」必须正确；若存在键不一致实现须走显式映射函数，不得假定下标恒等（契约 §2.2 修订重要 5）。手工在新版本换会话后抽查滚动落点 | M |

---

## 7. 汇总

| 类别 | 条数 | 自动化 | 需人工 |
|---|---|---|---|
| 1 数据接口（正反例） | 10 | 10 | 0 |
| 2 真实数据正确性 | 5 | 5 | 0 |
| 3 客户端三态渲染 | 7 | 2（3.5/3.7 可 DOM 化） | 5 强人工（视觉/悬停可区分） |
| 4 加载循环 | 9 | 7（4.1–4.8） | 2（4.9 阻塞感） |
| 5 失败/退化 | 4 | 3 可脚本制因 | 1 强人工（5.4 界面观感） |
| 6 回归 | 6 | 2（6.4/6.5 可 AUT） | 4（6.1/6.2/6.3/6.6 悬停滚动手感） |
| **合计** | **41** | **29 自动** | **12 需人工实测** |

**说明**：第 3、6 类的「悬停波形放大 / tooltip / 平滑滚动手感 / 视觉可区分」属外观与交互观感，
优先人工；其余数据/契约/竞态/终止条件均可用 curl + 浏览器自动化（Playwright 挂 127.0.0.1:3080）覆盖。
所有人工项都写清「步骤 + 预期 + 通过判据」，可交由测试人员照单执行。
