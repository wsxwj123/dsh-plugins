# CODE-REVIEW — dsh-session-manager 代码质量抽查（实现质量）

> 抽查性质：代码级质量审查（非行为测试——行为测试已由裁判通过）。
> 依据：`src/` 全部 20 个源文件 + `package.json` / `build.mjs` / `.devflow/INTERFACE.md`（已锁定契约）+ `.devflow/BRIEF.md`。
> 审查窗口：错误处理、资源释放、散弹式分支、命名/风格、跨平台、删除/文件操作安全。
> 结论速览：**致命 0 条 / 重要 7 条 / 建议 14 条**。核心风险集中在「回收站 move 的非事务性」「归档写路径读失败被吞」「删除失败语义客户端无法区分」三处数据一致性缺口，以及行解析对同标题会话的误绑定。

---

## 一、致命（0 条）

无。未发现崩溃、越权、明文数据外发或正常路径上的数据销毁缺陷；cordis 注入纪律（`inject` 声明 + 裸访问）、路径越界门、loopback 信任 fence、删除幂等、UI 无 XSS 注入点等基础安全面都做对了。

---

## 二、重要（7 条）

### I-1 归档域读失败被吞 → 归档清理静默跳过；双读窗口可致 workspace 全局对象被整体覆盖写
- **文件:行号**：`src/index.ts:125-135`（readGlobal 的 `catch { return {} }`）；`src/handler.ts:242-252`（doArchivedCleanup）、`src/handler.ts:315-321`（doUnarchive）
- **问题**：`domain.global.get()` 抛错时 readGlobal 返回 `{}`，与「域不存在」共用同一降级路径，读失败与「无归档 id」不可区分。后果有二：
  1. 删除归档会话时 `readArchived()` 读到 `[]` → `doArchivedCleanup` 直接 `return ok()`——**文件已移入回收站但归档集未清，返回 ok，无任何告警**，留下永久幽灵行且无恢复信号；
  2. 写路径用第二份读快照做全量 `global.set({ ...current, archivedSessionIds: next })`：若第二次读失败返回 `{}`，会把 workspace 全局对象**整个替换成只剩 archivedSessionIds 的对象，丢掉 workspaceIds/initialized 字段**（doUnarchive 与 doArchivedCleanup 都有此路径）。
- **怎么改**：readGlobal 读失败返回哨兵（如 `undefined`）而不是 `{}`；两个写端点把「读失败」映射为 `system-error`（可重试）而不是继续写；且**同一快照只读一次**——先取 `const global = readGlobal()`，同时由它派生「是否在归档集」与写回载荷，消除双读窗口。

### I-2 回收站 move 非事务：rename 成功、记录写失败 → 无记录孤儿条目 + 违背契约的 system-error
- **文件:行号**：`src/trash.ts:116-123`（moveToTrash：先 `renameSync` 后 `writeRecord`）、`src/trash.ts:145-150`（restoreItem 同构）；`src/handler.ts:230-231`（catch → `fail('system-error')`）
- **问题**：若 rename 成功但 `writeRecord` 抛错（磁盘满、崩溃窗口），moveToTrash 抛错 → handler 返回 `system-error`。契约（INTERFACE §0）规定 system-error 语义是「host 未改任何已承诺的持久状态」，但**此时目录已经移走**——客户端据错误恢复行显示，用户重删时 `hasItem` 幂等完成，可目录**没有记录**：回收站列表不可见、restore 不可达、清空回收站会把它**永久删除**。整条链 = 用户以为「没删成」，实际数据已进不可恢复路径。
- **怎么改**：调整顺序为「先写记录（含 originalDir）再 rename」——rename 失败则删记录回滚（保持 system-error = 未移任何目录的契约语义）；若写记录后、rename 前崩溃，残留记录在重删时被覆盖、在 restore 时命中 `restore-target-exists`（目录还在原位，拒绝覆盖，正确），自愈。`restoreItem` 同样先删记录后 rename，或对删除记录的失败做降级处理。

### I-3 删除归档会话第二步失败的客户端处理与契约不符（partial-failure 语义丢失）
- **文件:行号**：`src/handler.ts:241-258`（doArchivedCleanup 返回 `fail('system-error')`）与 `src/client/pendingDeletesCore.ts:208-229`（任何 `!outcome.ok` 都置 failed → 行恢复显示 + 「删除失败，已恢复」）
- **问题**：host 对「move 失败（什么都没发生）」与「文件已移、归档清理失败（partial-failure）」返回**相同的 `{ok:false, code:'system-error'}`**，客户端无法区分，一律恢复行显示并提示「删除失败，已恢复」。契约（INTERFACE §2.4）要求 partial-failure 时**行消失**（文件已移走）+ 提示「删除已完成但归档清理未完成，重试补齐」；当前实现会把一个文件已进回收站的会话重新显示在列表里，用户点开会话得到已无目录的坏会话。
- **怎么改**：host 在 partial-failure 响应中加可区分字段（如 `moved: true`，或独立 code `archive-cleanup-pending`），并保留 `code:'system-error'` 给纯 move 失败；客户端按 `moved` 分支：行保持隐藏 + 显示「清理未完成，重试补齐」，重试经幂等路径补齐归档集。

### I-4 /sm 路由 body 读取流无错误处理：客户端中断 → unhandled rejection
- **文件:行号**：`src/index.ts:181-196`（`for await (const chunk of req)` 无 try/catch）
- **问题**：`webServer.register` 的 handler 是 async 函数，body 流在客户端提前断开/传输错误时会 throw（ECONNRESET/AbortError），promise reject 无人接——典型 fire-and-forget 异步错误，请求挂起且产生 unhandled rejection（宿主 web server 未必吞）。`JSON.parse` 有 catch，流读取没有。
- **怎么改**：把读流包进 try/catch，出错时 `res.writeHead(400)` 收尾并 return（或按中断类型回 499）；至少保证 handler 永不 reject。

### I-5 bridge 网络层错误无人接：smTrash / smEmptyTrash / smUnarchive 全部 unhandled rejection
- **文件:行号**：`src/client/bridge.ts:22-40`（post 里 fetch reject 不 catch）；`src/client/ArchiveView.tsx:64-68`（`void smTrash().then(...)` 无 catch）、`83-93`（`await smEmptyTrash` 无 try）、`200-211`（`await smUnarchive` 无 try）
- **问题**：`callFire` 是唯一 catch 了 fetch 拒绝的调用方；其余三处网络失败（host 重启、页面卸载中、瞬时断连）→ promise 拒绝无人处理 → unhandled rejection + **用户无任何反馈**（smTrash 失败连「读取回收站失败」提示都不会出现）。契约要求失败必须可见。
- **怎么改**：在 `post` 内把 fetch 拒绝映射为 `{ ok:false, code:'network-error' }`（一处修复覆盖全部调用方）；或给三处调用补 `.catch`/try-catch 并在 UI 显示错误。

### I-6 同标题会话 → 删除按钮绑定错误会话 id（删错目录）
- **文件:行号**：`src/client/sessionRowMatch.ts:44-62`（平局时取 `Object.keys(byId)` 首个匹配）；`src/client/DeleteButton.tsx:114`（`rowById.set(action.id, row)` 后者覆盖前者）
- **问题**：行→会话解析只凭「aria-label 包含标题」+「最长匹配」消歧。两个标题相同的会话（DSH 不保证标题唯一）会得到完全相同的 aria-label（如「会话"新会话"的操作」），**两行的按钮都绑到同一个 id（键序首个）**：点行 B 的删除实际删行 A 的目录；且 `rowById` 键冲突，同一 id 只记录最后一行，撤销窗口内隐藏错行。
- **怎么改**：平局时按 DOM 行序消歧——行在 `[role="treeitem"]` 容器中的索引对应 `byId.ids` 中同标题 id 的序位；或解析结果要求每行映射唯一 id，冲突时回退 DOM 序对齐。这是防误删（F3）的直接组成部分，发布前应处理。

### I-7 客户端 dispose 空实现 + ctx.effect 清理未调用：注入按钮/监听/样式泄漏
- **文件:行号**：`src/client/DeleteButton.tsx:152`（`dispose: () => {}`）；`src/client/index.tsx:164-171`（清理块未调用 `controller.dispose()`）
- **问题**：ctx.effect 清理了 slot/订阅/MutationObserver/React root/mount，但注入到官方行的删除按钮、其 click 监听、注入的 hover 样式标签**全部不释放**（dispose 是空实现且压根没被调用）。插件停用/热重载后：旧按钮残留并持有旧 ctx 闭包，`sync()` 因「行已有 `[data-dsh-sm-delete]`」跳过重建 → 死按钮与死监听永久挂在官方行上。
- **怎么改**：`dispose()` 内遍历 `rowById` 移除按钮、移除注入的 `<style>`；`index.tsx` 清理块调用 `controller.dispose()`。注意先移除监听再移除节点。

---

## 三、建议（14 条）

### S-1 同构包含判断重复实现
- `src/index.ts:210-213`（isTrashInside）与 `src/paths.ts:130-134`（isInsideOrEqual）逻辑完全一致。复用 `isInsideOrEqual(sessionsRoot, trashRoot)` 删除重复。

### S-2 makeHandler 是无用透传
- `src/index.ts:88-92`：`makeHandler(deps) { return createSmHandler(deps) }` 无任何加工，全仓无调用方（测试直接 import createSmHandler）。删除，减少一个「导出即 API」的假面。

### S-3 SESSION_MARKER 死导出 + 契约要求的 marker 校验缺失
- `src/trash.ts:23` 导出 `SESSION_MARKER` 但源码无使用；`src/handler.ts:216` 只判 `fs.existsSync(targetDir)`，未按 INTERFACE §3.1 step3 校验目录内确有 `session.jsonl.zstd`——同名非会话目录会被整体移入回收站。要么补上 marker 校验（防御纵深），要么删掉死常量并显式记录「有意不校验」的理由。

### S-4 魔法数字 256 重复
- `src/handler.ts:143`（title 上限）与 `src/client/sessionRowMatch.ts:49`（candidate 上限）各写一遍 256。提为共享常量（如 `MAX_TITLE_LEN`），避免两端口径漂移。

### S-5 域名字符串 'workspace' 三处散落
- `src/index.ts:127`、`src/handler.ts:244`、`src/handler.ts:311` 各自写 `get('workspace')`。提为常量（如 `WORKSPACE_DOMAIN`）统一。

### S-6 元数据记录损坏被静默吞掉
- `src/trash.ts:79-87`：`readRecord` catch 后 `return null`，损坏/半写的记录导致对应条目**在回收站列表不可见、restore 报 not-in-trash**，成为孤儿目录；`writeRecord`（89-92）非原子（直接 writeFileSync，崩溃可产生半写文件）。建议：损坏时 `log.warn` 至少留痕；记录写入走「临时文件 + rename」原子化。

### S-7 构建脚本硬编码 /bin/sh，Windows 必挂
- `build.mjs:18`：`execSync('node_modules/.bin/tsdown', { shell: '/bin/sh' })`——Windows 无 /bin/sh 且 `.bin` shim 是 POSIX 脚本（注释自己说明了）。BRIEF 声明「尽力 Windows/Linux」：用 `shell: true`（cmd 解析 `.cmd` shim）或 cross-spawn 兜底；否则发布后 Windows 用户 `npm run build` 直接失败。

### S-8 MutationObserver 无防抖，全站 body 变更都触发 O(行数×会话数) 重扫
- `src/client/index.tsx:144-145`：`observe(document.body, { childList:true, subtree:true })`，每次 DOM 变更都跑 `sync()`（全量 querySelectorAll + 每行对全部 byId 做标题包含匹配）。会话多时任意输入都会造成明显卡顿。建议 rAF 或 ~100ms 防抖合并。

### S-9 failed 保留窗口内同 id 重删被静默拒绝
- `src/client/pendingDeletesCore.ts:258-264`：`requestDelete` 对「已有 failed 条目」的 id 返回 false，行已恢复显示但点删除**无任何反馈**（index.tsx 只 console.debug）。建议：failed 态允许 drop 后重新 park（重试），或至少让调用方对 false 给出可见提示。

### S-10 deletedIds 永不清理、与 host 恢复不对账
- `src/client/pendingDeletesCore.ts:152-162, 230-238`：fire 成功后 id 永久进 localStorage 的 deletedIds；`undo` 只在 fire 前清理。若经 API（`smRestore`，UI 未暴露但 bridge 存在）恢复会话，或 id 被复用，该行将**永久隐藏**（刷新也无效）。建议：与 `/sm/trash` 对账（宿主回收站真实条目之外不再隐藏），或给 deletedIds 加 TTL/上限。

### S-11 归档视图回收站状态刷新面太窄 + 错误残留
- `src/client/ArchiveView.tsx:61-72`：trashCount 只在 `open` 变化时读取——打开期间删除到点/清空后计数不刷新，显示陈旧；且读取失败置了 trashError 后，后续成功打开**不清除**错误横幅（80-93 成功分支只 setTrashCount）。建议：打开期间随 pendingDeletes 变化补读；成功时清 trashError。

### S-12 点击时「重新解析」是死代码，附带运行中判定过期
- `src/client/DeleteButton.tsx:126-135` 点击时 `resolveRowSession` 重解析——但注入的删除按钮**自带 aria-label**，使该行 labeled button 数变为 2，`resolveRowSession`（57-64，要求恰好 1 个）必然返回 null，永远走 `?? action` 旧值。后果：注入后会话开始运行（`running` 变 true）再点删除，**跳过运行中确认**直接删（可撤销但违反 F3 防线）。建议：重解析排除自身按钮（`button[aria-label]:not([data-dsh-sm-delete])`）或删除这段死代码并在点击时用订阅的最新快照。

### S-13 每次删除点击全量打日志含 cwd 路径
- `src/client/index.tsx:100`：`console.debug(..., 'cwd=', action.cwd)` 把用户工作目录路径写进浏览器 console（生产噪音 + 路径信息暴露）。建议：删掉或挂 dev flag 门控。

### S-14 `_metadata` 与 id 命名空间冲突
- `src/trash.ts:26, 74-77`（`METADATA_DIR` 按名字符跳过）与 `src/paths.ts:39-46`（assertValidId 不拒 `_metadata`）：id 恰为 `_metadata` 时 `itemPath` 与元数据目录同名，delete 会 rename 到非空目录失败（ENOTEMPTY→system-error）、empty 永久跳过。建议：assertValidId 或 TrashStore 显式拒绝该 id，或在 empty 中按完整路径比较跳过而非按名字符。

### S-15 插件停用/热重载期间模块级定时器继续触发真实删除
- `src/client/pendingDeletesCore.ts:182-188`（park 定时器）+ `src/client/index.tsx:164-171`（清理未触碰 pendingDeletes）：模块单例的倒计时在 ctx.effect 清理后**照常到点 fire**，而撤销条已卸载——用户失去撤销机会，文件仍被移走。设计上「模块级存活」服务于跨面板存活（合理），但缺少与插件生命周期绑定的出口。建议：给 pendingDeletes 加 `dispose()`（取消全部未到点定时器），在 ctx.effect 清理中调用；同时保留「刷新清空 pending」的既有语义。

---

## 四、做对的部分（抽查确认，不必改）

- **安全面**：loopback fence 与官方谓词逐行一致（`trust-fence.ts` / `http-util.ts`）；路径门两级分层（400 语法 / 200 越界）与契约一致；`encodeSegment`/`projectKey` 全字符转义，跨平台磁盘段天然安全；UI 全部经 React 文本节点/静态 SVG 渲染，无注入点；cordis 注入纪律合规（inject 声明 + 裸访问，不碰 `ctx.get('logger')` 类坑）。
- **资源释放主体**：ctx.effect 已释放 slot/订阅/MO/React root/mount；UndoRail 的 interval、ArchiveView 的 cancelled 标志、pendingDeletesCore 的定时器 per-id 清理都正确（仅 I-7/S-15 两个缺口）。
- **删除安全细节**：restore 拒绝覆盖占用目录；emptyTrash 部分失败保留记录与幸存条目；删除/恢复/清空/取消归档均幂等；`force` 降级为兼容 no-op 且保持类型校验——与锁定契约一致。
- **幂等快照**：pendingDeletes 的 snapshot 缓存引用、useSyncExternalStore 用法正确，规避了 React #185。

---

## 五、结论

**无致命问题；7 条重要问题集中在三条数据一致性缺口（归档读失败被吞致幽灵/覆盖写、回收站 move 非事务致无记录孤儿、删除失败语义客户端不可区分致 partial-failure 误报恢复）和两条客户端健壮性缺口（行解析同标题误绑、dispose 泄漏），建议发布前先修 I-1/I-2/I-3/I-6，其余可排入发布后迭代；14 条建议均为低成本局部修改，不阻塞发布但建议至少消化 S-3/S-7/S-12。**
