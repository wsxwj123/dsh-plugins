# dsh-session-manager 盲审报告（2026-08-17，opus 审查代理）

> 审查对象：main（437eeaa）的 packages/dsh-session-manager，树 hash ba2ff80。
> 审查方式：读全部 15 源文件 + 9 单测 + 集成测试 + INTERFACE/BRIEF，并对照本机真实 DSH 运行时（~/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/）逐条验证集成假设。未改任何文件。

## 总体结论

**不能算"开发完成可放心用"。** 有 3 个致命问题：一个能让整个 `dsh web` 宿主进程被 kill，一个能删错会话，而删错之后界面上没有任何恢复入口。契约面（`/sm/*` HTTP 层）本身做得相当扎实（幂等、边界码、trust fence、partial-failure 语义都对），问题集中在**与真实 DSH 运行时的对接假设**上——而现有测试的 stub 恰好把这些假设都假设成真的了，所以"全绿"给了错误的信心。

---

## [致命]

### F1. `domain.global.set()` 的 Promise 没 await/catch → 归档写失败时整个宿主进程 exit(1)

`src/handler.ts:284` 和 `:359`

```ts
try {
  domain.global.set({ ...global, archivedSessionIds: archived.filter((x) => x !== id) })
  return ok()          // ← 没 await，落盘前就返回成功
} catch (err) { ... }   // ← 只能抓同步抛错
```

真实契约是 `set(value): Promise<void>`（`dsh-storage-domain/lib/types/domain.d.ts:28`）。实现里 `enqueue` 只给内部 chain 挂了 `noop` 兜底，**返回给调用方的那个 promise 没有任何 handler**（`dsh-storage-domain/lib/index.js:210-215`）；域正在关闭时更是直接 `Promise.reject(DomainError('closed'))`。而 DSH 装了进程级 `unhandledRejection` → `proc.stderr.write('fatal load failure')` + `proc.exit(1)`（`dsh-app-boot/lib/index.js:1042-1066`）。

后果分两层：
- **触发时**（磁盘满 / EACCES / 域正在关闭时收到一个 `/sm/unarchive` 或删归档会话）：整个 `dsh web` 进程退出，所有会话和 web server 一起没了。
- **不触发也错**：`ok()` 在落盘前返回，所以 I-1/I-3 精心设计的"`system-error + moved:true` 可重试"契约在真实后端上根本不生效——写失败会报成功。

修：`doArchivedCleanup` / `doUnarchive` 改 async，`await domain.global.set(...)`（route handler 本来就是 async），失败落到现有的 `moved:true` 分支。

### F2. 侧栏行→会话 id 的标题匹配会绑到别的会话 → 删错会话

`src/client/sessionRowMatch.ts:99-129`（resolveRows）、`:48-61`（bestTitleIn）

三个独立缺陷，任一成立就删错目标：

**(a) tie 分组没套官方的可见性过滤（与顺序无关，最确定）** — `:107-115` 从全部 `ids` 建同名组，只跳过 `blank`。官方渲染器的过滤是 `origin !== 'subagent' && !archived.has(id) && (!blank || 当前选中)`（`dsh-client-ui-workspace/lib/client.js:100-102`）。所以一个**已归档**或**子代理**的同名会话会占掉 tie 槽位 0，第一个可见行就绑到它的 id 上 → 用户删可见会话，实际删的是那个归档会话。

**(b) "DOM 行序 = ids 序"这个前提不成立** — 注释在 `:85-88` 明确依赖它。实际：flat 视图 `rows.sort(byRecency)` 显式重排（`client.js:222-232` + `:90-93`），分组视图和 flat 视图都再套一层**用户可拖拽的持久化顺序** `reconciledSessionOrder(...)`（`client.js:1496-1499`、`:1258-1266`）；而插件对齐的 `snapshot.ids` 是 host 列表序（lineage 展平，`dsh-client-runtime/lib/client.js:8575`）。

**(c) 模板词标题劫持** — aria 模板是 `会话"{name}"的操作` / `Session actions for {name}`（`client.js:2227/2292`）。`bestTitleIn` 取"被 label 包含的最长标题"，所以只要存在一个标题正好叫 `会话`（英文下 `Session`）的会话，所有标题更短的行都会绑到它。

**触发条件不苛刻**：未命名会话的 displayTitle = cwd 的 basename（`dsh-client-runtime/lib/client.js:8826-8836`），同一目录下的未命名会话天然同名。本机回收站里已有两条 `title:"tmp"` / `projectKey:"--private-tmp--"` 的记录，说明同名 tie 路径在真实使用中已经走过了。

修（最小且安全）：resolveRows 里先按官方 `sessionVisible` 语义剔掉 `origin==='subagent'` / archived / blank 的候选；把包含式匹配换成**精确重建 label** 匹配（`label === 模板.replace('{name}', title)`，内置那两条模板或走 locale），**只有唯一命中才注入按钮**——同名歧义行宁可不给按钮，也不能删错。

### F3. 回收站只进不出：`smRestore` 从未被 UI 调用

`src/client/bridge.ts:45`（定义处是全仓唯一命中）

归档视图只有 取消归档/删除/清空回收站（`ArchiveView.tsx:141-262`），撤销条只对 5 秒窗口内的 `pending` 生效（`pendingDeletesCore.ts:355-365`）。所以窗口一过，**界面上没有任何恢复入口**——尤其是 F2 删错时，只能手工去 `~/.dsh/session-manager-trash` 搬目录。这让整个"软删可恢复"的产品前提在 UI 层不成立，也和 INTERFACE §2.4「不允许中间态无任何恢复入口」的口径冲突（`.devflow/INTERFACE.md:152`）。

修：归档视图已经在拉 `/sm/trash` 的 items 了（`ArchiveView.tsx:68-85`），把它列出来、每行加「恢复」调 `smRestore(id)`；成功后 `reconcileWithTrash` 会自动放开行隐藏。

---

## [高]

### H1. 取消归档绕开 workspaceRegistry 的缓存 → 刷新后回滚，还会被官方写操作覆盖回去

`src/handler.ts:284/359`（注意：直接写 workspace 域是 INTERFACE §3.4 钉的做法，所以是**契约选错机制**，不是实现擅自发挥）

`dsh-workspace` 的 `this.state` 只在 start 时 `domain.global.get()` 赋值一次，之后只由自己的 `setState` 更新（`dsh-workspace/lib/index.js:317`、`:742-745`），并且**全文没有任何 `ctx.on(...)` 监听**（grep 零命中）。外部写完它就是脏的：

1. `workspace.list` RPC 和初始 host 流都读这份脏缓存（`dsh-host-apiproxy/lib/index.js:3102`、`:3703`）→ **刷新页面或 `ctx.workspaces.refresh()` 后，被取消归档的会话又变回"已归档"**。
2. 下一次官方写操作（`archiveSession` 等）用脏 state 做 `{...state}` 落盘 → 把刚清掉的 id 又写回归档集。

活着的界面因为 apiproxy 监听 `domain/changed` 会即时更新（`:3733-3760`），所以表现正是"当场看着生效、刷新后回滚"——最容易被验收漏过的形态。建议先做 2 分钟人工验证：取消归档 → 刷新页面 → 看是否回滚。复现则要么向上游要 unarchive API，要么在 README/UI 明确标注该限制。

### H2. 快速连续写会丢更新（stale read → lost update）

`src/handler.ts:266`(读)/`:284`(写)、`:351`/`:359`

`readWorkspaceGlobal` 读的是 DomainImpl 的内存值，而内存值**只在落盘之后**才更新（`dsh-storage-domain/lib/index.js:151-161`）。连点两次「取消归档」，或连删两个归档会话（5 秒窗口几乎同时到点），第二次读到的还是第一次写之前的快照 → 第一次操作被静默还原。修法和 F1 合并：await 之后再返回，归档写走一条串行 promise 链。

### H3. `empty()` 的"可识别回收站条目"门槛形同虚设

`src/trash.ts:228` + `:255-257`

只要名字过 `assertValidId` + `isStableSegment` 就 `rm -rf`。这两个门槛只挡分隔符/控制字符/`.`/`..`/`_metadata`/`%`——**普通文件名（含 `.DS_Store` 和任意用户文件/目录）全部通过**。注释里声称的"只删可识别的回收站条目"（`:219-221`）比实际强度高得多。单测 `tests/unit/trash.unit.test.js:110` 写了 `.DS_Store` 当"非回收站内容"，但没断言它还在——实际会被删。

修：门槛加实质判据 `hasRecord(entry) || (isDirectory && exists(join(root, entry, SESSION_MARKER)))`。现有孤儿用例（`trash.unit.test.js:120-133`）照样过。

### H4. trashRoot 安全名单只做全等比较，且全程不 realpath

`src/index.ts:110-112`

`path.resolve(sys) === resolved` 是全等：`/etc/x`、`/usr/local/lib`、`/private/tmp`、`/var/folders/...` 一律放行。配上 H3，`SM_TRASH_ROOT` 配错就成了对该目录的递归删除。另外 `resolveRoots` 后没有任何 `fs.realpathSync`——trashRoot 是指向真实数据目录的 symlink 时，包括 `isInsideOrEqual(sessionsRoot, trashRoot)` 在内的所有检查都被绕过。修：全等换成 `isInsideOrEqual(sys, resolved)`；两个 root 各做一次 realpath 后再判定。

---

## [中]

**M1. `/sm/restore` 不重新校验 `originalDir` 边界，也不校验 record 结构** — `src/handler.ts:298-314` + `src/trash.ts:199-208`。record 被改写后 `restoreItem` 会 mkdir + rename 到任意路径；delete 侧有 `isInsideOrEqual(sessionsRoot, targetDir)` 门，restore 侧完全没有。record 字段无校验：`{}` 会让 `hasItem(rec.id)`（`:306`，不在 try 内）抛 TypeError 被兜成 400。修：restore 前加边界门 + 校验 `rec.id === 请求 id && typeof rec.originalDir === 'string'`。

**M2. sessions root 硬编码 `~/.dsh/sessions`，无视 `DSH_HOME` 和 persistence 的 `root` 配置** — `src/index.ts:75-83`。DSH home 优先级是"显式配置 > $DSH_HOME > ~/.dsh"（`dsh-home-paths/lib/index.js:65-80`）。自定义部署里所有删除都 `session-dir-not-found`（失败安全但功能失效）。修：优先注入服务/配置，兜底 `resolveDshHome()`，root 不存在启动 warn。

**M3. marker 只认 `session.jsonl.zstd`，`compression:'none'` 的部署全删不动** — `src/trash.ts:28` + `src/handler.ts:234`。plaintext 模式文件名是 `session.jsonl` → 每次删除都 `not-a-session`。修：marker 接受 `session.jsonl(.zstd)?`。

**M4. workspace 域"没打开"被当成"没归档"** — `src/index.ts:214-224` 对 undefined 给 `{}` → `handler.ts:275-276` 认为"没归档"直接 ok()；`doUnarchive`（`:343-346`）同情形却返回 `workspace-domain-unavailable`，两条路径口径不一致，启动竞态期真会 undefined。修：`readGlobal` 区分"未知"，走可重试分支。

**M5. `deletedIds` 与 host 只在启动/开面板时对账，两处会漂** — `src/client/index.tsx:156-164`、`ArchiveView.tsx:65-96`。(1) `handler.ts:225` live-not-persisted 分支返回 ok 但回收站无条目 → 下次对账已删会话又冒出来；(2) 双标签页不同步。修：独立码/tombstone + `storage` 事件跨页同步。

---

## [低]

- **L1** `src/trash.ts:164-168`：rename 失败回滚会删同 id 既有 record，老条目成孤儿。加 dest-已存在前置判定。
- **L2** `src/handler.ts:372-377`：字段名 `deadline` 装的是 `deletedAt`；回收站永不过期会堆积。
- **L3** `src/client/DeleteButton.tsx:99-101`：已有按钮 early-return，id 冻结在注入时刻；建议 id 进 `row.dataset`，不一致重绑。
- **L4** `src/client/sessionRowMatch.ts:48-61`：每次 sync O(行×会话) `includes`；复用 `idsByTitle` 索引。
- **L5** `tsdown.config.mjs` makeCssPlugin 在 ESM 用 `require.resolve`（裸 CSS 分支），休眠 bug。
- **L6** `.gitignore:1` 忽略 `lib/` 但单测 import `lib/*.js`；LEARNINGS/gitignore/README 三方矛盾。

---

## 测试覆盖评估（缺的正好是致命项）

`/sm` 契约面覆盖很好（集成测试 821 行：fence/幂等/边界/并发同 id/partial-failure retry）。缺口全在"与真实运行时对接"层：

1. 假 domain 的 `set` 是同步的（`tests/unit/handler.unit.test.js:71-74`）→ F1/H2 在现有测试下必然全绿。补：`set` 返回 rejected Promise 用例 + 连续两次写的丢更新用例。
2. resolveRows 测试全是自造 label/ids：没有 archived/subagent 混入 tie、没有"DOM 序≠ids 序"、没有模板词标题——F2 三条全没测。
3. `.DS_Store` 用例只 write 不 assert（`trash.unit.test.js:110`）；补断言立刻暴露 H3。
4. restore 侧缺"record 篡改成外部 originalDir"与"record 缺字段"（M1）。
5. `compression:'none'` 与自定义 `DSH_HOME`/root 部署形态零覆盖（M2/M3）。
6. `tests/acceptance/*`（约 1100 行）跑的是 helpers.js 里另一套简化实现，是契约镜子而非发布代码覆盖。
7. 无浏览器层 e2e（同仓 composer-tools 有 playwright，本包没有）→ F2/F3 正好落在无测试层。

---

## main 与 feature 分支的关系

**main 已包含 feature 分支的全部改动。** `git log main..feat/dsh-session-manager` 为空；feat 是 main 祖先；file-level diff 仅 2 个文档文件，零代码差异。claude 副本（437eeaa）的包树 hash 与 app 副本 main 完全一致。本报告审的就是最新代码。
