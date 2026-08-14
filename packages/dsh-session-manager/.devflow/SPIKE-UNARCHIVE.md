# SPIKE-UNARCHIVE — 取消归档的 storage-domain 写入路径验证

> 状态：已执行最小实验（2026-08-14）
> 定位：验证「node 半插件写 workspace 全局域 → 删掉目标 id → 触发 host 广播」这条取消归档路径是否走得通。
> 安全声明：spike 只读真实 `~/.dsh/storages/workspace.json`（复制后操作副本），**绝不写真实归档集合/会话文件**。脚本在 `/tmp/sm-spike/` 下运行，副本读写于 `/tmp/sm-spike/scratch/workspace.json`。

---

## 1. 调研结论：取消归档 API 是否存在

**不存在。** 全树只读核查结果：

| 层 | 文件 | 结论 |
|---|---|---|
| 客户端 workspaces 服务 | `dsh-client-runtime/lib/client.js` ~10020-10034 | `ctx.workspaces.archiveSession(sessionId)` 是唯一归档写接口，**append-only**，只加不减；`installArchived` 的全量替换是 RPC 响应的内部落地，无对外写入口 |
| 客户端 contract | `dsh-client-runtime/lib/types/client/contract/workspaces.d.ts` | `IWorkspaces` 只有 `archiveSession`，无 unarchive |
| host wire API | `dsh-host-apiproxy/lib/types/api/workspace.d.ts` | `WorkspaceApi` 只有 `archiveSession(request:{sessionId})→{archivedSessionIds}`，无 unarchive |
| node registry | `dsh-workspace/lib/index.js` `archiveSession()` | `[...state.archivedSessionIds, sessionId]` append-only；公开方法只有 `archiveSession` + getter `archivedSessionIds` |
| node 域状态 | `dsh-workspace/lib/types/spec.js` `workspaceDomainState` | 归档集合是持久化的纯数组 `archivedSessionIds`（`z.array(...).default([])`） |

结论：**没有任何已存在的 unarchive API**。但 DSH 的归档集合是一个**完整可替换的持久数组**，且存在一条官方同步链路可复用（见下）。

## 2. 候选实现路径（全部只读源码追踪）

### 路径 A：`storageDomain.open(workspaceDomainSpec)` 重新打开域
- 源码：`dsh-storage-domain/lib/index.js` `open()` 开头 —— `if (this.reserved.has(spec.name)) throw new DomainError("already-open", ...)`。
- `WorkspaceRegistry` 已在本进程持有 `workspace` 域（`dsh-workspace/lib/index.js` [Service.init] `await this.ctx.storageDomain.open(workspaceDomainSpec)`）。
- **结论：此路不通** —— 插件再 `open` 会抛 `already-open`。`DomainFacility.open` 是单开（single-open per domain name）。

### 路径 B：`storageDomain.get("workspace")` 取已开 live 句柄 → `global.set`
- 源码：`dsh-storage-domain/lib/index.js` `get(name) { return this.domains.get(name); }` —— 返回**已开域的真实 `DomainImpl` 实例**（与 registry 共享同一 handle）；文档标注为"untyped diagnostic surface"，但返回的就是 live 实例。
- `DomainImpl.global` 是 `{ get, set }`：`set(value)` → `enqueue(async () => { await this.unit.setGlobal(value); ...; this.emitChanged({domain, table:"", key:"", operation:"put", value}) })`（见 `dsh-storage-domain/lib/index.js` ~154-162）。
- `unit.setGlobal` 底层 = `dsh-storage-json` 的 `JsonKvUnit.setGlobal`，我已在 spike 的第 3 节用副本**实际跑通**。
- `emitChanged` → `ctx.emit("domain/changed", change)`。
- host 变更流：`dsh-host-apiproxy/lib/index.js` ~3700-3760 监听 `domain/changed`，当 `change.table === ""` 且解析后的 `state.archivedSessionIds` 与已跟踪集合不等时，向**所有客户端**广播 `host/archived-sessions-changed`。
- 客户端：`dsh-client-runtime/lib/client.js` `installArchived` 全量替换（~9678），`host/archived-sessions-changed` 由 `handleHostEnvelope` 接入（~9642）。

**整条链路（源码级）闭环：** node 写 → `domain/changed` → host 广播 → 所有客户端 `installArchived` 更新 → UI 重新派生显示。

### 路径 C：直接改 `~/.dsh/storages/workspace.json` 文件
- **可行但强烈不建议**：绕过 `storage-domain` 的事件总线，**不会**触发 `domain/changed` →
  - host 变更流不广播，已连接的客户端无法感知（需手动 refresh/重启）；
  - 违反 dsh `invariant.js` 对 `domain/changed` 与内存全局值的一致性校验；
  - 双写风险：registry 进程内内存态仍是旧集合，人肉改文件会导致内存↔文件分歧。
- **结论：为兜底/应急保留，不作为正式路径。**

## 3. Spike 实验：存储往返（真跑）

**目标**：证明路径 B 的写介质层可用 —— 用 `dsh-storage-json` 的 `JsonStorageBackend` 对一份**副本** `workspace.json` 完成「读真实归档集合 → 删除目标 id → setGlobal 写回 → 重开再读」全过程。

脚本：`/tmp/sm-spike/spike-storage.mjs`（9 项断言，**9/9 通过**）。

```
[Phase 1] 读副本 global：archivedSessionIds count=27，workspaceIds 正常
[Phase 2] 移除目标 id (27→26)，unit.setGlobal 写回（spike 用 setGlobal = domain.global.set 的底层原语）
[Phase 3] 重开再读：count=26，目标 id 已消失，workspaceIds 未动 —— 持久化成功
[Phase 4] 原始文件校验：unit 头保留、global.archivedSessionIds 在、tables.workspaces 完整
=== RESULT: 9 passed, 0 failed ===
```

> 说明：spike 用的是**底层 `setGlobal` 原语**（storage-domain facade 里 `domain.global.set` 内部就调用它），故验证的是写介质与持久化。`domain/changed` 事件发射是 facade 层（`emitChanged`）行为，无法在孤立的裸后端进程里复现，但源码完整可见（见第 2 节路径 B 引用）。

## 4. 结论

| 项 | 状态 | 说明 |
|---|---|---|
| `storageDomain.open("workspace")` | **已验证不可行** | 源码级：`already-open`，registry 已持有 |
| `storageDomain.get("workspace")` 返回 live 句柄 | **已验证（源码）** | `DomainFacility.get` 返回 `this.domains.get(name)`，即 registry 持有的同一 `DomainImpl` |
| `domain.global.set(新集合)` 触发 `domain/changed` | **已验证（源码）** | setGlobal 写介质 + `emitChanged({table:"", key:"", op:"put"})` |
| host 收到 `domain/changed` 广播 `host/archived-sessions-changed` | **已验证（源码）** | `dsh-host-apiproxy/lib/index.js` ~3754 |
| 客户端 `installArchived` 全量替换归档集 | **已验证（源码）** | `dsh-client-runtime/lib/client.js` ~9678/9642 |
| 存储写入/持久化往返 | **已验证（spike 实跑）** | 副本上 9/9 通过 |
| 插件内 `ctx.storageDomain.get("workspace")` 在**真实 dsh 进程**中能取到 live 句柄并触发端到端广播 | **待实机确认**（设计假设，后续开发阶段用双端插件 node 半实机验证一次） | 依赖运行期同一服务实例/域表，源码无矛盾，但需真进程确认 |

**最终采用路径（标注）**：路径 B（`ctx.storageDomain.get("workspace").global.set(...)`）。
- 存储机制：**已验证**（spike + 源码）。
- 端到端实机触发：**假设，待双端插件 node 半在真实 dsh host 确认一次**。
- 兜底：若实机发现 `get` 取不到或广播不达，退化为路径 C（仅作应急）+ 客户端 `refresh()` 兜底刷新列表（有代价、需用户确认）。

## 5. 对 PLAN 的直接输入

1. node 半插件注入 `storageDomain`，提供 `unarchiveSession(sessionId)`：
   - `const ws = ctx.storageDomain.get("workspace")`（不存在则抛）
   - `const cur = ws.global.get()`；`ws.global.set({ ...cur, archivedSessionIds: cur.archivedSessionIds.filter(id => id !== sessionId) })`
   - 幂等：目标 id 不在集合中 → 直接 no-op 返回。
2. 这套写入同样可用于「**删除时把归档会话从归档集合移除**」——删除一个已归档会话时，先移文件、再从 archivedSessionIds 移出该 id（否则归档视图会残留幽灵条目）。
3. 风险：并发多 host 写入由 storage-domain 的 `chain` 链串行化（`this.enqueue` 排队），不会交错；但**多客户端并发取消同一会话**需在 node 侧做幂等过滤。
