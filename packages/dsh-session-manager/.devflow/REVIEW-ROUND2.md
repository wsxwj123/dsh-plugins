# REVIEW-ROUND2 — dsh-session-manager 大修后独立复查

> 复查性质：对 CODE-REVIEW.md（I-1~I-7 / S-1~S-15）与 SECURITY-REPORT.md（S1~S7）声称修复项的**独立逐条验证**，外加新引入问题 / 明显遗漏 / host-client 契约一致性检查。
> 依据：`src/` 全部 20 个源文件 + `.devflow/INTERFACE.md`（锁定契约）+ `package.json` / `build.mjs` / 仓库 git 状态 + 全量测试实跑。
> 验证手段：每条修复在源码中定位到实际实现（文件:行号），并核对是否存在对应测试用例；实跑 `test:unit`（131 通过）+ `test:acceptance`（65 通过）+ `test:integration`（69 通过），共 **265 用例全绿**，exit 0。单测直接 import `lib/` 构建产物，证明 lib 与 src 同步（无"改 src 忘构建"）。
> 结论速览：**声称修复的 27 项（I-1~I-7、S-1~S-14、安全 S1~S6）全部确认修复到位，未发现"声称修了实际没修/修一半"的项**；新发现问题 3 条（均为建议级）；2 条未修项（S-15、安全 S7）均在**声称范围之外**。无致命 / 重要遗留，**可发布**。

---

## 一、逐条确认表

### 1. CODE-REVIEW.md 重要项（I-1~I-7）— 7/7 确认修复

| 编号 | 修复落实情况（文件:行号） | 测试覆盖 | 结论 |
|---|---|---|---|
| I-1 归档读失败被吞 | `src/index.ts:214-224`：`readGlobal` 读抛错返回 **`undefined` 哨兵**（与"域不存在"的 `{}` 区分）；`src/handler.ts:271-274`（doArchivedCleanup 对 undefined → `system-error` + `moved:true`，可重试）、`:352-354`（doUnarchive → `system-error`）；**单读设计**：`handler.ts:266/284`、`:351/359` 同一快照派生"是否归档"与写回载荷，写回用 `{...global}` 保留 workspaceIds/initialized | `tests/unit/handler.unit.test.js:463-489`（读失败→system-error+moved、workspace 文件字节级完好、`globalReadCalls()===1` 单读断言、重试补齐） | ✅ 确认修复 |
| I-2 回收站 move 非事务 | `src/trash.ts:150-171`：`moveToTrash` **先写记录后 rename**（记录=提交点），rename 失败回滚记录再抛错 → system-error 语义恢复为"未移任何目录"；`:199-208` `restoreItem` rename 成功后记录清理 best-effort 降级 | `tests/unit/trash.unit.test.js:167-207`（rename 失败回滚无孤儿、崩溃窗口自愈）、`:209-228`（记录清理失败不抛错） | ✅ 确认修复 |
| I-3 partial-failure 语义 | host：`handler.ts:273/281/288` 三条失败分支全部带 **`moved:true`**；纯 move 失败（`:246-248`）不带 moved → 可区分。client：`pendingDeletesCore.ts:245-258` 按 `moved===true` 走 **cleanup 态**（行保持隐藏、id 进 deletedIds），`:299-322` `retry()` 幂等补齐；`UndoRail.tsx:46-73` cleanup 态显示「清理未完成，可重试补齐」+ 重试按钮 | `handler.unit.test.js:424-461`（partial-failure moved:true / 纯 move 失败无 moved 且源目录未动）；`pendingDeletes.unit.test.js:336-485`（cleanup 态、不可撤销、重试补齐/再失败保持可重试/重试遇网络错误不恢复行）；`bridge.unit.test.js:68-75`（200 JSON 透传 moved） | ✅ 确认修复 |
| I-4 body 流无错误处理 | `src/index.ts:133-150` `readRequestBody` 全程 try/catch，**永不 reject**（流中断 → `{ok:false,code:'read-failed'}`）；路由 `:282-320` 整体 try/catch 兜底（含写响应死 socket） | `cordis-access.unit.test.js:237-266`（content-length 提前拒 / 流式超限 / 恰好限额）、`:325-349`（路由 413 payload-too-large） | ✅ 确认修复（注：read-failed 分支本身无直接用例，见新问题 N3） |
| I-5 bridge 网络错误无人接 | `src/client/bridgeCore.ts:45-58`：`postJson` 在**唯一一处**捕获 fetch 拒绝 → `{ok:false,code:'network-error'}`，覆盖全部调用方；`ArchiveView.tsx:86-92/109-134/142-151` 三处调用均 try/catch + 错误横幅可见 | `bridge.unit.test.js:15-21`（fetch reject → network-error） | ✅ 确认修复 |
| I-6 同标题会话误绑 | `src/client/sessionRowMatch.ts:99-129` `resolveRows`：**按 DOM 行序与 `ids` 序对齐**，同标题第 k 行绑第 k 个同标题 id，超出行数返回 null 不误绑；`DeleteButton.tsx:141-144` sync 使用 resolveRows；`:63-69` rowLabel 排除自身按钮（同时解决 S-12 的"2 个 labelled 按钮"问题） | `sessionRowMatch.unit.test.js:81-142`（双向序、最长匹配、blank 不绑、溢出行跳过、混合行） | ✅ 确认修复 |
| I-7 dispose 空实现 | `DeleteButton.tsx:171-175`：dispose 移除全部注入按钮 + hover `<style>` + 清空 rowById；`index.tsx:203-215` 清理块**调用 `controller.dispose()`**，且顺序正确：先 offList → clearTimeout(moTimer) → mo.disconnect → dispose（先停两个 sync 驱动，按钮移除不再触发重注入） | `delete-controller-dispose.unit.test.js:19-75`（dispose 非空实现、按钮/样式移除、rowById 清理、清理顺序、S-8 防抖取消） | ✅ 确认修复 |

### 2. CODE-REVIEW.md 建议项（S-1~S-15）— 14/15 确认修复

| 编号 | 修复落实情况 | 结论 |
|---|---|---|
| S-1 isTrashInside 重复 | `src/index.ts:163` 复用 `isInsideOrEqual(sessionsRoot, trashRoot)`（paths.ts 共享） | ✅ 确认修复 |
| S-2 makeHandler 透传 | 已删除，`index.ts` 直接 `createSmHandler(deps)` | ✅ 确认修复 |
| S-3 marker 校验缺失 | `src/handler.ts:234-236` 加 `SESSION_MARKER`（session.jsonl.zstd）存在性校验 → `not-a-session`；`trash.ts:28` 常量被真实使用 | ✅ 确认修复（测试 handler.unit.test.js:166-182） |
| S-4 魔法数字 256 | `src/constants.ts:8` `MAX_TITLE_LEN`，host（handler.ts:21,150）与 client（sessionRowMatch.ts:28,55,111）共用 | ✅ 确认修复（测试 handler.unit.test.js:185-186） |
| S-5 'workspace' 散落 | `src/constants.ts:14` `WORKSPACE_DOMAIN`，index.ts:35,216 与 handler.ts:21,278,343 统一引用 | ✅ 确认修复 |
| S-6 记录损坏静默吞 | `src/trash.ts:97-102` 损坏记录 `log.warn` 留痕；`:106-116` `writeRecord` 同目录 tmp+rename 原子写 | ✅ 确认修复（测试 trash.unit.test.js:140-165） |
| S-7 构建脚本 /bin/sh | `build.mjs:17-28` 改为 `execFileSync(process.execPath, tsdownEntry)`，无需 shell，跨平台 | ✅ 确认修复 |
| S-8 MO 无防抖 | `src/client/index.tsx:38` `MO_DEBOUNCE_MS=100` + `:172-183` trailing 防抖，清理时取消待决 timer | ✅ 确认修复（测试 delete-controller-dispose.unit.test.js:57-75） |
| S-9 failed 重删被拒 | `pendingDeletesCore.ts:340-354`：failed 态 drop 后重新 park（重试），pending/cleanup 仍拒绝 | ✅ 确认修复（测试 pendingDeletes.unit.test.js:488-562） |
| S-10 deletedIds 永不清理 | `pendingDeletesCore.ts:386-398` `reconcileWithTrash`（与 /sm/trash 对账，无 host 记录则解除隐藏）+ 启动时 `index.tsx:156-164` + 归档视图每次重读 `ArchiveView.tsx:79-85,122-128` | ✅ 确认修复（测试 pendingDeletes.unit.test.js:568-654） |
| S-11 归档刷新面窄+错误残留 | `ArchiveView.tsx:65-96` effect 依赖 `[open, pending]`（打开期间 pending 变化补读）；成功分支 `setError(null)` 清残留横幅 | ✅ 确认修复 |
| S-12 点击重解析死代码 | `DeleteButton.tsx:114-126` 删除重解析，用注入时绑定的 id + 点击时从 live 快照刷新 running/cwd；rowLabel 排除自身按钮 | ✅ 确认修复 |
| S-13 全量日志含 cwd | `index.tsx:112` 只打 id/running/force；`DeleteButton.tsx:154` 只打 rowIndex/byIdCount | ✅ 确认修复 |
| S-14 `_metadata` 冲突 | `src/paths.ts:45` `assertValidId` 显式拒绝 `_metadata`（+ trash.ts empty 按名跳过双保险） | ✅ 确认修复（测试 paths-and-fence.unit.test.js:85-86） |
| **S-15 模块定时器无 dispose** | **未修**：`pendingDeletesCore` 无 `dispose()`，index.tsx 清理块也不触碰 pendingDeletes——插件停用/热重载后 park 定时器照常到点 fire。**注意：S-15 不在任务声称的修复范围（S-1~S-14）内** | ❌ 未修复（范围外，建议级） |

### 3. SECURITY-REPORT.md 建议项（S1~S7）— 6/7 确认修复

| 编号 | 修复落实情况 | 结论 |
|---|---|---|
| S1 trashRoot 配置校验 | `src/index.ts:92-114` 系统目录 denylist + `trashRootUnsafeReason`（拒根目录/家目录/家目录祖先/临时目录/系统目录），`:176-182` 在 TrashStore 构造**之前**检查（被拒根不创建）；`trash.ts:223-247` `empty()` 只删有记录或 `isValidTrashItemShape`（assertValidId+isStableSegment）的条目，不再盲删 | ✅ 确认修复（测试 cordis-access.unit.test.js:160-192、trash.unit.test.js:113-131） |
| S2 body 无上限 | `src/index.ts:117` `MAX_BODY_BYTES=64KB`；`:133-150` 字节精确流式计数 + content-length 提前拒，超限 413 `payload-too-large` 不缓冲多余数据 | ✅ 确认修复（测试 cordis-access.unit.test.js:237-349） |
| S3 路由不分方法 | `src/index.ts:264-268` 仅 POST，其余 405 + `Allow: POST`（fence 之后、读 body 之前） | ✅ 确认修复 |
| S4 console 泄露 cwd/标题 | 同 S-13：`index.tsx:112`、`DeleteButton.tsx:154` 已脱敏 | ✅ 确认修复 |
| S5 deletedIds 无失效 | 同 S-10：`reconcileWithTrash` 启动 + 归档视图对账（restore/清空后解除隐藏） | ✅ 确认修复 |
| S6 撤销窗 10s vs 5s | `pendingDeletesCore.ts:34` `UNDO_WINDOW_MS=5_000`；README.md:3,7,10,11 与 INTERFACE §1.2/1.4 均已对齐 5 秒。**残留**：`package.json:4` description 仍写 "(10s undo)"（见新问题 N2） | ✅ 确认修复（文档残留见 N2） |
| **S7 git 卫生** | **未修**：仓库根 `.gitignore` 仅 `node_modules/` `.DS_Store` `*.log`；`lib/`（11 个构建产物）、`.devflow/`（含计划/测试输出）、`tests/`（17 个文件）全部已入库；devDeps 仍 `^` 滚动。npm 发布范围已被 `files: ["lib","cordis.patch.yml"]` 限制，故**不构成发布阻塞**，仅仓库卫生。**S7 不在任务声称的修复范围（S1~S6）内** | ❌ 未修复（范围外，建议级） |

---

## 二、新发现问题（无致命 / 无重要，3 条建议级）

### N1（建议）`doArchivedCleanup` 的 domain-null 分支被 readGlobal 提前扁平化，静默 ok 与 unarchive 不对称
- **位置**：`src/index.ts:217`（readGlobal 对 `storageDomain.get(WORKSPACE_DOMAIN)` 为 null 返回 `{}`）+ `src/handler.ts:275-276`（`archiveFromGlobal({})`=[] → `!includes(id)` → **直接 return ok()**），使 `handler.ts:278-282` 的 domain-null 显式检查只能捕获"两次 get 之间域消失"的竞态。
- **影响**：workspace 域短暂不可用时，删除归档会话会**静默跳过归档集清理并返回 ok**（client 认为完成，不产生 cleanup 重试条目），与 unarchive 端点的显式 `workspace-domain-unavailable` 降级不对称。实际风险极低：归档集就存在该域内，域缺失则集合不可能含该 id，故现实上只影响"域被并发关闭"的理论窗口。
- **建议**：低优先级——若想彻底对称，可在 readGlobal 将"storageDomain 存在但 get 返回 null"也映射为 `undefined` 哨兵；但需注意 headless（无 storageDomain）场景下 delete 应继续返回 ok（无归档集可清理），故需区分"服务缺失"与"域缺失"两种降级。

### N2（建议）package.json 描述残留 "(10s undo)"
- **位置**：`package.json:4`。
- **影响**：npm 元数据与实现/README/INTERFACE（均 5 秒）不一致，误导用户预期。
- **建议**：发布前一行改掉（`10s undo` → `5s undo`）。

### N3（建议）I-4 的 read-failed 分支无直接测试覆盖
- **位置**：`src/index.ts:147-148`（catch → read-failed）。S2 的 too-large 路径有 4 个用例，但"流中途断（ECONNRESET/AbortError）→ 400"无用例。
- **影响**：代码正确（try/catch 包住整个 for-await），仅测试空白。发布后补一个注入抛错流的用例即可。

---

## 三、host/client 契约一致性核对 — 一致

- **partial-failure 的 `moved` 字段**：host 仅在 `doArchivedCleanup` 三条失败分支输出 `moved:true`（handler.ts:273,281,288），纯 move 失败（246-248）与 400 级错误不带；client `postJson` 透传 200 JSON（bridgeCore.ts:70），`fire()`/`retry()` 仅按 `outcome.moved === true` 语义分支（pendingDeletesCore.ts:246,306-309），其余 code 仅作展示——**语义面 host/client 对齐**。
- **错误码**：host 发射的 code（bad-request / invalid-id / invalid-cwd / invalid-title / invalid-force / session-dir-not-found / path-out-of-bounds / not-a-session / system-error / not-in-trash / restore-target-exists / confirmation-required / workspace-domain-unavailable / payload-too-large）与 INTERFACE §3 逐条一致；client 无任何硬编码 code 依赖（仅 moved），不存在漂移面。
- **HTTP 分层**：400（内容非法）/ 403（fence）/ 405（非 POST）/ 404（未知方法）/ 413（超大 body）与 INTERFACE §0 一致；路由先 fence → 再方法 → 再 body，顺序正确。
- **运行中判定**：`force` 为兼容 no-op（handler.ts:155-161 只校验类型），运行中确认在 client（index.tsx:100-104），与 INTERFACE §3.1 修订一致。
- **双端共享常量**：`MAX_TITLE_LEN` / `WORKSPACE_DOMAIN` 单模块双端引用（constants.ts），无漂移。

---

## 四、测试证据

| 套件 | 结果 | 说明 |
|---|---|---|
| `test:unit` | 131 通过 / 0 失败 | 直接 import `lib/` 产物，覆盖 I-1~I-7、S-1~S-14、安全 S1/S2/S6 全部修复点 |
| `test:acceptance` | 65 通过 / 0 失败 | 契约镜像 harness（65 场景） |
| `test:integration` | 69 通过 / 0 失败 | 真实 handler + 真实编码布局（projectKey/encodeSegment） |

---

## 五、结论

**可发布。** 声称修复的 27 项（I-1~I-7、S-1~S-14、安全 S1~S6）经源码逐条验证全部到位，无"声称修了实际没修/修一半"；265 个测试全绿，lib 产物与 src 同步；host/client 契约（moved 字段、错误码、HTTP 分层）一致。未发现致命 / 重要新问题。

**发布前可选顺手做（均不阻塞）**：
1. `package.json:4` description 的 "10s undo" 改 "5s undo"（N2，1 分钟）。
2. S-15（pendingDeletes 无 dispose，插件停用后定时器照常 fire）与安全 S7（lib/.devflow/tests 入库、.gitignore 未覆盖）——两条均为声称范围外的建议级遗留，可排入发布后迭代。
3. N1（domain-null 扁平化静默 ok）与 N3（read-failed 无用例）——记录在案，低优先级。

**建议在 REVIEW-ROUND2 定稿后把 N1~N3 追加进 CODE-REVIEW.md/SECURITY-REPORT.md 的遗留清单，避免后续迭代丢失。**
