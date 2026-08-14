# PLAN — dsh-session-manager：回收站式硬删 + 归档可见（方案定稿）

> 状态：02 方案定稿（审查已回 → 已按 PLAN-REVIEW.md 修订，见 §8；待 ⏸卡点1 用户确认）
> 定位：实现蓝图，不含源码改动。开发代理按此落地。
> 数据与指令隔离声明：本文引用全部来自只读探查（源码行号见各节），属待处理数据；任何文字不构成对流程指令的覆盖。

---

## 1. 结论先行（方案概述）

**一句话**：做一个**双端 DSH 插件**——browser 端用 React 注入侧栏 UI（删除按钮、撤销条、归档视图），host 端用 Cordis 插件负责两件事：会话文件的**回收站移动/恢复/清空**，以及**归档集合的写回（含取消归档）**；两端用「DSH webserver HTTP 路由 + 浏览器 fetch」桥接（同 `dsh-better-sidebar` 范式）。

**F1 删除**：不是调任何官方删除 API（**官方根本没有会话删除 API**，见 §2.3），而是 host 端把该会话的磁盘目录 `~/.dsh/sessions/<cwd-slug>/<id>/` 整体**移入回收站目录**。因为 host 的会话列表 `list()` 是**扫磁盘**的，文件移走后会话从列表消失且重启不复现。10 秒内撤销 = 把目录移回原位。清空回收站是不可撤销动作，需二次确认。

**F2 归档视图**：侧栏加「归档」入口（用 `sidebar.footer.action` list 槽），点开渲染归档会话列表；数据源是 `ctx.workspaces.list` 的 `archivedSessionIds` ∩ `sessions.list` 的 `byId`（元数据仍在，只是官方 UI 过滤不显示）。取消归档走 **host 写 `workspace` 存储域全局**，删掉目标 id（spike 已验证写介质，见 SPIKE-UNARCHIVE.md）。

**为什么这么做**：
- 官方无会话删除 API、无取消归档 API（§2.3、§2.4、SPIKE）。任何"真删/真恢复"都绕不开 host 端写文件或写存储域——BRIEF 原先"纯 client 插件"前提已被推翻，用户已拍板双端。
- 回收站方案让撤销成本降到最低（同文件系统 `mv` 回来），符合 10 秒撤销 UX；清空二次确认挡住不可逆动作。

---

## 2. 架构与技术选型（引用调研结论）

### 2.1 双端总览

```
┌──────────────── browser（client 半）───────────────┐
│ apply(ctx: ClientContext)                          │
│  · slots.register('sidebar.footer.action')  → 归档入口│
│  · DOM 注入会话行删除按钮 + 模块级 pending 队列 + 撤销条  │
│  · fetch(location.origin + /sm/...) → host 半       │
└────────────┬───────────────────────────────────────┘
             │ RPC（同源 fetch，经官方信任 fence）
┌────────────▼───────────────────────────────────────┐
│ host 半（node，Cordis 插件）                        │
│  · ctx.connection.rpc.handle('/sm', handler,        │
│        { authority:'loopback' })  ← client 调用     │
│      → webServer 挂 '/sm/*' 路由 + 自动套用官方       │
│        isTrustedApiRequest fence（Host loopback /   │
│        sec-fetch-site / Origin 同源/CSRF → 403）     │
│  · 回收站：会话目录 move/restore/empty（fs/promises） │
│  · ctx.storageDomain.get("workspace").global.set()   │
│       → 改 archivedSessionIds（取消归档=删 id；      │
│         删除已归档会话=顺带删 id）                    │
│  · host 自动广播 host/archived-sessions-changed      │
└────────────────────────────────────────────────────┘
```

**桥接方式（已按审查 F-1 从裸路由改为官方信任 fence）**：host 半用 `ctx.connection.rpc.handle('/sm', handler, { authority: 'loopback' })` 注册承载 `delete/restore/emptyTrash/unarchive/trash` 的 RPC channel。
- 机制来源（`dsh-client-connection/lib/index.js` `HostConnectionService.register`）：`connection.rpc.handle(channel, handler, options)` 在 `webServer` 挂 `channel` 前缀路由，并**自动套用官方 `/api` 浏览器信任 fence** `isTrustedApiRequest(req, trustedHosts)`——校验 `Host` 为 loopback 或声明 authority、拒绝 `sec-fetch-site: cross-site`、校验 `Origin` 同源；不过则 `403`。
- `authority: 'loopback'` → `trustedHosts=[]`，即只认本机 loopback Host（最严）。且 `dsh-web-app/lib/startup.js` 本就拒绝 `--host 0.0.0.0`（原文 "intentionally not supported yet for safety… use 127.0.0.1"），实际 web profile 只绑 loopback。故选此通道使 `/sm/*` 与官方 `/api` 同级信任面。
- client 半同源 fetch `/sm/<method>`。此方案**替代**手写 `webServer.register` + 裸路由（后者无鉴权），Host/Origin/CSRF 防护交给官方实现（详见 INTERFACE §3 顶部契约与 §4 网络面）。

### 2.2 client 注入策略（哪些 slot / 哪些 DOM 注入）

| UI | 注入方式 | 依据 |
|---|---|---|
| **归档入口**（侧栏脚部按钮） | `slots.register('sidebar.footer.action')`——官方 `list` 槽，additive，不会 shadow 别家 | `dsh-client-ui-sidebar/lib/types/client/contract/slots.d.ts`：`sidebar.footer.action` kind `list`、scope `root` |
| **归档视图面板**（会话清单 + 取消归档） | **DOM 注入 overlay**（像 turn-scrubber 的固定定位条）：按钮点击显示一个自绘面板 | `sidebar.workspaces` 是 `single` 槽、被 ui-workspace 独占，插件**无法**成为第二 occupant（会整块 shadow 侧栏，见 §5 风险）；ui-workspace 也未声明任何"会话行内 action"子槽（唯一子槽是 `sidebar.workspaces.directoryFlow`，专管目录选择） |
| **会话行删除按钮** | **DOM 注入**：监听会话列表容器（`div[role=tree][aria-label=sessions]`）行节点，给每个 `.sessionRow[role=treeitem]` 注入删除按钮，用行内标题文本取会话标题 | `dsh-client-ui-workspace/lib/client.js` ~334、~718：行是 `div.sessionRow[role=treeitem]`，含 `.title`/`.rowActions`；行内**无稳定 data-session-id 属性**（§5 风险：靠标题反查 id，需用列表 byId 匹配） |

**关键能力来源**：client 读 `ctx.sessions.list`（`SnapshotStore<SessionListState>`，`byId`/`ids`/`current`/`phase`）拿会话元数据（`id/displayTitle/cwd/updatedAt`），读 `ctx.workspaces.list`（`archivedSessionIds`）拿归档集合，读已归档会话的标题 = `archivedSessionIds` 里每个 id 在 `sessions.list.byId[id]` 查（**元数据仍完整在 byId**，只是官方派生函数 `sessionVisible` 过滤不显示——`dsh-client-ui-workspace/lib/client.js` ~100、~191-276）。

### 2.3 【推翻 BRIEF 前提】不存在"会话删除 API"

原 BRIEF 引用 `ctx.sessions.delete(sessionId)`（`client.js` 7930 行）——**这是误读**：
- 那行是 `SessionManager.drop()` 里的 `this.sessions.delete(sessionId)`，删的是**客户端内存里缓存的 Session 实例**，注释明言 "The host session log is the durable truth"；**不是删除 API**。
- 四处核查结果：
  - host RPC 契约 `dsh-host-apiproxy/lib/types/api/sessions.d.ts` 的 `sessions.*` 只有 list/search/create/history/models/selectModel/rename/fork/prompt/attachment/updateQueue/cancel，**无 delete**。
  - `workspace.*` 的 `delete(workspaceId)` 只删 workspace 注册，**不动会话文件**（§2.5）。
  - `dsh-session-persistence-jsonl/README.md` 原文："Nothing deletes session files — logs accumulate under root until removed externally (the seam has no deletion API)."
  - `dsh-session/README.md`：`session/disposed` 只是 Session 实例生命周期事件，**不删除日志文件**。
- 结论：**官方无任何会话删除 API**。删除 = host 半自行移走磁盘目录（回收站方案）。这使「重启后不复现」成立：host `list()` 扫磁盘，目录不在扫描树里就列不出来。

### 2.4 会话文件结构（回收站要动哪些文件）

源码：`dsh-session-persistence-jsonl/lib/index.js`。
- 根目录 `~/.dsh/sessions/?`（config `root`，本机是 `~/.dsh/sessions/`）；**一个会话 = 一个目录 = 一个文件**：
  - `projectDir(root, cwd)` = `${root}/${projectKey(cwd)}`（`projectKey` 把 cwd 编码成 `--...--` 段）。
  - `sessionDir(root, cwd, id)` = `${projectDir(root,cwd)}/${encodeSegment(id)}`（`encodeSegment` 把断言号转 `~XXXX`）。
  - `logPath(...)` = `sessionDir/` + `session.jsonl(.zstd)`。
- `listArtifacts()` 枚举：`listProjectDirs(root)` 列 root 下**所有子目录当 project** → `listSessionDirs(project)` 列每个子目录 → 若该目录有 `session.jsonl.zstd` 才收，读首行 header 校验。
  - **分号 `listArtifacts` 对"同一 session id 出现在两个 project 目录"抛 `duplicate JSONL session id`**；对项目目录里裸放的 `.jsonl` 文件抛 `legacyLayout`。
- **回收站选址铁律**：回收站目录**绝不能放在 `~/.dsh/sessions/` 下**——否则 `listProjectDirs` 会把回收站当 project 扫，里面有 `session.jsonl.zstd` 就让它"复活"，或有探文件就抛错。
- workspace 关系：`~/.dsh/storages/workspace.json` 的 `tables.workspaces[*].sessionIds` 引用会话 id；host `WorkspaceRegistry` 的 `sessionIds` getter 按"header 的 cwd resolves 到 workspace.path"过滤，文件移走/header 缺失会被剪掉（不炸，只是从该 workspace 账目移除）。`archivedSessionIds` 是纯数组**不自动剪**，会留 dangling id——待 §4 处理。

**删除一个会话 = 移动 `~/.dsh/sessions/<projectKey(cwd)>/<encodeSegment(id)>/` 整个目录**（含它下面仅有的 `session.jsonl.zstd` 及未来可能的 session-local artifact）到回收站。cwd 与 id 在 client 端从 `sessions.list.byId[id].cwd` + `id` 可得；host 端由 node 半用同一编码函数或在删除请求里带上原路径解析。

### 2.5 workspace.delete 语义（为何不用它删会话）

源码链：client `delete(workspaceId)` → `api.workspace.delete({workspaceId})` → host `ctx.workspaceRegistry.delete(WorkspaceId(...))` = `enqueueOperation(deleteKnown(id))`。
- `WorkspaceRegistry.deleteKnown`：删 registry 表里的 workspace 记录 + 更新 `workspaceIds` 顺序，**完全不碰目录和任何会话文件**；该 workspace 下的会话变成 "ungrouped"（列表照常显示）。
- **结论**：`workspace.delete` 用于删除"整个 workspace 注册"，对 single-session 的回收站方案**不适用**（它会让所有会话 ungrouped 而非消失）。回收站删除走的是**文件移动**，与 `workspace.delete` 无关。

### 2.6 node 半的注册与打开方式（双端桥接，节 2.1 已述）

- `cordis.patch.yml` 机制（来自 turn-scrubber / better-sidebar）：包内声明 `- insert: - id: <pkg>, name: '<pkg>'`，配合 `package.json` `dsh.bundle.patch`；`dsh plugin --profile web add` 把它收进 profile 的 bundle stack，`cordis.yml` 组成加载。node 半是包 `main`（`lib/index.js`）的 Cordis 插件（`apply(ctx)`），client 半是 `lib/client.js` bundle（`__ModuleLoader__.load`）。
- host 半注入 `["connection","storageDomain"]` 等服务（源码：`dsh-workspace` `static inject = ["storageDomain","sessionPersistence"]`；`dsh-storage-domain` provide `storageDomain`；`dsh-client-connection` provide `connection`（其 `rpc.handle` 自动套用 `isTrustedApiRequest` fence，见 §2.1））。host 亦需 `["sessions"]`（node 侧 `ctx.sessions.get(id)` 判运行中会话，见 §5.2 风险6）。
- 存储后端：`dsh-storage-json`（backend `json`，root=`~/.dsh/storages/`，单位文件 `<name>.json`）。`workspace.json` 的 global（含 `archivedSessionIds`）读写经 `storageDomain`。

---

## 3. 文件结构（对照 turn-scrubber 模板）

```
packages/dsh-session-manager/
├── package.json                # name:dsh-session-manager; dsh.bundle.patch:cordis.patch.yml;
│                               #   dsh.client.{platform:web, inject:[...runtime, ...ui-workspace, ...ui-slots]}
│                               #   main:lib/index.js; exports{"./client":"./lib/client.js"}
├── build.mjs                   # tsdown 双 targets（node 半 + browser 半），照抄 + 改 PLUGIN_ID/entry
├── tsdown.config.mjs           # 照抄 turn-scrubber（purity gate / css-inline / ModuleLoader banner）
├── cordis.patch.yml            # - insert: - id: session-manager, name: 'dsh-session-manager'
├── src/
│   ├── index.ts                # node 半 apply(ctx)：注册 /sm/* RPC channel（信任 fence）+ storageDomain 写操作
│   └── client/
│       ├── index.tsx           # client 半 apply(ctx)：slots 注册 + DOM 注入 + pending 队列 + fetch
│       ├── context-types.ts    # ClientContext 结构类型（sessions.list / workspaces.list / slot）
│       ├── pendingDeletes.ts   # 模块级 pendingDeletes 队列（存放到 node 的确认/未定确认）
│       ├── DeleteButton.tsx    # 会话行删除按钮（DOM 注入）
│       ├── UndoRail.tsx        # 撤销条（倒计时 + 撤销 + 文案），DOM overlay 或 footer 槽
│       ├── ArchiveView.tsx     # 归档视图面板（列表 + 取消归档），DOM overlay
│       ├── ArchiveEntry.tsx    # sidebar.footer.action 归档入口按钮
│       ├── css.d.ts
│       ├── rail.module.css     # 样式
│       └── bridge.ts           # fetch 封装（调 /sm/* 同源 RPC）
└── README.md
```

> 目录新建包：`packages/dsh-session-manager/` 目前只有 `.devflow/` + `PROJECT.md`，需按上树补全套工程文件（package.json/build.mjs/cordis.patch.yml/tsdown.config.mjs/src/…）。

---

## 4. 任务拆解（按模块，标注顺序依赖）

> 标 P = 可与其它并行；标 S# = 依赖前置。

- **T1 工程骨架**（S0）：package.json、build.mjs、tsdown.config.mjs、cordis.patch.yml、node 半 no-op stub、client 半空 apply。→ 验证：`pnpm build` 产出 `lib/index.js` + `lib/client.js`。
- **T2 host 半：`/sm/*` RPC channel（含信任 fence）+ 回收站队列服务**（S1，依赖 T1）：
  - 经 `ctx.connection.rpc.handle('/sm', handler, { authority:'loopback' })` 注册 `delete`、`restore`、`emptyTrash`、`trash`、`unarchive`（自动套用官方 `isTrustedApiRequest` fence，见 §2.1）。
  - 回收站目录 `~/.dsh/session-manager-trash/`（必须在 `~/.dsh/sessions` 外）。
  - 每条删除条目：`{ id, originalDir, movedTo, deadline }` —— originalDir 记录原路径（含 cwd→project 段），restore = 移回（**不覆盖既有目录**，见 INTERFACE §3.2）；empty = `rm`。
  - 幂等、输入校验、错误映射（见 INTERFACE.md §3）。
- **T3 host 半：取消归档 + 删除已归档会话的归档集写回**（S1，依赖 T1 与 SPIKE 结论）：
  - `unarchive(sessionId)`：`ctx.storageDomain.get("workspace").global.set(...)` 过滤 id（见 SPIKE §4）。
  - 删除已归档会话时（归档视图提供删除入口，见 T5），**两步**：先移文件、再从 `archivedSessionIds` 移除 id；第二步失败则 delete 返回 `system-error` 并承诺归档集补齐（partial-failure 契约见 INTERFACE §3.1）。
  - ⚠️ **发布 gate**：T3 第一子任务 = 在真实 dsh host 上用最小双端插件实机确认 `storageDomain.get("workspace")` 拿到 live 句柄、`global.set` 后广播 `host/archived-sessions-changed` 能达客户端；不过则不发布归档/取消归档功能（见 §5.1 风险4 与 §8 I-6）。
- **T4 client 半：会话行删除按钮 + 模块级 pending 队列 + 撤销条**（S2，依赖 T2/T3 的 API 契约）：
  - 模块级 `pendingDeletes`（Map，倒计时不随组件卸载丢失，`beforeunload` 兜底，幂等执行）——移植 FileExplorerPanel.jsx 模式到 DSH React/Cordis（见 §5.5）。
  - 删除按钮 hover 显示；点击 → 条目立即"假隐藏"（更新本地列表过滤）→ 调 `delete` → 撤销条倒计时 → 撤销调 `restore` / 到点由 host 落回收站。
- **T5 client 半：归档视图**（S2，依赖 T2/T3 契约 + 归档数据源）：
  - `sidebar.footer.action` 槽注册归档入口。
  - 归档视图 overlay：读 `workspaces.list.archivedSessionIds` ∩ `sessions.list.byId`，列表 + 「取消归档」按钮（调 `unarchive`）+ **「删除」按钮**（调 `delete`，走同一回收站/撤销流程，见 INTERFACE §2.4 —— 解决 I-5 归档删除可达性）。
- **T6 联调 + 静态检查**（S3）：`pnpm check`（tsc --noEmit）、装进 web profile 手测、node 侧单测（临时文件，不碰真实会话）。

**可并行**：T2 与 T3 可并行（都只依赖 T1，都只碰 host 半）；T4 与 T5 可并行（都依赖 T2/T3 的 API 契约定了即可）。

---

## 5. 风险清单

> 规则：每个非机械改动 ≥1 失败模式+缓解；高风险（数据/安全/多文件）≥2。★ 为高风险。

### 5.1 高风险（数据/文件操作）
1. **★ 删除移动错目录/破坏真实会话**（host 半 `mv` 用错路径）。
   - 失败模式：路径拼接错误 → 把别的会话或整个 `~/.dsh/sessions` 移走。
   - 缓解：host 端**只接受 client 传来的相对组合**（id + cwd）并**用 DSH 自己的 `projectKey`/`encodeSegment` 重新计算**目标路径（不在 client 信任任意绝对路径）；`mv` 前校验源目录存在且其中确有 `session.jsonl.zstd`；`mv` 目标 in 回收站根；全量单测用临时会话文件覆盖路径边界。
   - **id 编码逃逸（审查 A-1）**：`encodeSegment`（`dsh-session-persistence-jsonl/lib/index.js` ~84-103）已把 `..`→`~002E~002E`、`/`→`~002F`、`:`→`~003A`、`~`→`~007E`，逐字符 1:1 编码，不可能产生 `/` 或 `..` 段；host 仍要求 `encodeSegment(id) === id`（编码后等于编码前，即输入本就无危险字符），并断言目标目录落在 `projectDir(root,cwd)` 前缀内（越界 → `path-out-of-bounds`，见 INTERFACE §3.1）。
2. **★ 回收站内残留 `session.jsonl.zstd` 被 `listProjectDirs` 扫到**（会话"复活"或抛错）。
   - 失败模式：回收站放 `~/.dsh/sessions/` 下 → host `list()` 把回收站当 project，删除失效。
   - 缓解：回收站固定放 `~/.dsh/session-manager-trash/`（sessions 根外，代码常量 + 单测断言路径前缀）。
3. **★ 归档集合写回破坏 workspace 域状态**（storage-domain 写坏）。
   - 失败模式：`global.set` 传了不完整 state（丢 `workspaceIds`/`initialized`）→ registry 校验炸。
   - 缓解：host 端先 `get()` 读当前完整 state，`set({ ...cur, archivedSessionIds: 新集合 })`，保留其余字段；spike 已证副本往返安全。
   - **partial-failure（审查 I-3）**："删除已归档会话"是两步（先移文件，再从 `archivedSessionIds` 移除 id）。第二步（集合写回）失败 → `delete` 返回 `system-error`（非 `ok`），host 承诺：移动已发生（幂等真值在"文件已移走"），集合写回可重试；此刻的中间态契约 = 列表隐藏 + 归档视图仍可能显示该会话（dangling），再次触发删除/或显式重试会补齐集合清理（详见 INTERFACE §3.1）。
4. **★ 取消归档的端到端：`storageDomain.get("workspace")` 在真实进程拿不到 live 句柄**
   - 失败模式：`get` 返回 `undefined` 或写成功但 `domain/changed` 广播不达 → 客户端列表不刷新。
   - 缓解（已按审查 I-6 重做，杜绝自相矛盾的路径 C）：
     - **预先验证 gate**：`get("workspace")` 是否能拿到 live 句柄、`global.set` 是否触发广播，作为 T3 第一个子任务与发布 gate（见 §4 T3、§8 I-6）。不过则不发布该功能。
     - **两个失败子态分别处理**（不做直接改 `workspace.json` 的路径 C）：
       - 子态A `get` 拿不到句柄/域不可写 → 本次 `unarchive` 返回 `workspace-domain-unavailable`（`system-error` 家族），client 明确显示"取消失败"并要求手动刷新，**绝不静默**、也绝不直接改文件。
       - 子态B `global.set` 写成功（持久化达成、机制已验证）但广播未达当前 client → 该 client 调用已存在的 `ctx.workspaces.refresh()` 重新拉取 `workspace.list`（响应携带 `archivedSessionIds`，client `refresh()` 内会 `installArchived`，见 `dsh-client-runtime/lib/client.js` ~9509-9516），以官方 re-pull 全量替换补齐 UI，**不经文件编辑、不破坏 invariant、不产生内存↔文件分歧**。

### 5.2 中风险
5. **删除"当前选中会话"**：会话被移走后 `sessions.list.current` 指向不存在的 id。官方 `deriveGroups` 里 `list.byId[id]` 为 undefined 会 `continue`，不崩，但 UI 可能停在"no session"态。
   - 缓解：删除当前会话时，client 先调 `sessions.clear()`（`SessionRuntime.clear()` 清除选择回 no-session 态），或选中下一个最近会话；撤销后若原会话还在则该空态仍在，提示"撤销后请重新打开"。
6. **会话是正在运行/正在写入的**（host Session 实例还活着）：包进程运行中，即使 `session.jsonl.zstd` 在写，`mv` 该目录在 POSIX 上仍可移动（文件句柄保持）；但移走后运行中会话可能续写新位置、或 host 侧下次 flush 找不到原路径。
   - 缓解（已按审查 I-4 增加 host 侧护栏，不依赖前端唯一防线）：node 半在 `delete` 执行前用 **`ctx.sessions.get(id)`**（node 侧 SessionStore，`dsh-session/lib`；返回现存内存 `Session` 或 `undefined`）判定目标是否 live/运行中，live 则拒绝移动并返回稳定 code `session-running`（INTERFACE §3.1）——**直调 API 也会被 host 拦**。client 端运行中行的删除按钮同样提示"先结束运行中的会话"（前端拦截是 UX 增强，不是唯一防线）。
7. **多标签页/多客户端并发**：两个客户端同时删除/取消同一会话。
   - 缓解：删除以"文件已移走"为最终真值（`mv` 天然幂等——目标在回收站已存在则报错或跳过）；取消归档以"id 已不在集合"为 no-op 幂等。

### 5.3 UI/DOM 注入风险
8. **删除按钮/归档视图是 DOM 注入，依赖 ui 内部 class/hash 名**（`.sessionRow`/`.title` 等 CSS Module hash 名会随官方版本变）。
   - 缓解：不以 hash class 定位，改以**稳定 role/aria 属性**定位（`div[role=treeitem]`、`aria-selected`、`aria-label="sessions"` 的 `[role=tree]` 容器）；列出官方版本升级时的回归检查项。架构上保留"官方升级后需复查"的维护成本。
9. **归档视图默认与官方列表并行渲染**：两个列表同时存在可能视觉冲突。
   - 缓解：归档视图作为 overlay（点击入口才展开），与官方主列表互斥显示；样式独立、浅色/深色跟随主题变量。

### 5.4 BRIEF 敏感面声明——每项配"怎么保证不越权"
| BRIEF 敏感面 | 保障句 |
|---|---|
| 1a 读会话列表元数据（标题/id/cwd） | 只读 `sessions.list` 与 `workspaces.list` 这两个标准 SnapshotStore，不直接解析日志文件内容 |
| 1b 删除会话文件（移动） | host 半把**整个会话目录**用 `rename` 原子移到回收站根；**绝不 open/read/write 日志正文**；路径由 id+cwd 经 DSH 官方编码函数重算，不接受 client 任意路径 |
| 1c 回收站清空（不可撤销） | 仅在**二次确认**后 `rm` 回收站内条目；清空路由需显式 `confirm:true` 载荷；清理范围被硬限制在回收站目录前缀内 |
| 1d 归档/取消归档（改 archive set） | host 半只改 `workspace` 域 global 的 `archivedSessionIds` 字段，`set` 时保留 `workspaceIds/initialized` 及其它字段；走官方 storage-domain 事件总线，不直接改文件 |
| 2 密钥/登录态 | 双端都不碰 credential/token/API key。**"不碰密钥" ≠ "无需鉴权"**：`/sm/*` 路由一律经 `connection.rpc.handle(...,{authority:'loopback'})` 套官方 `isTrustedApiRequest` fence（Host loopback + `sec-fetch-site` 非 cross-site + Origin 同源，否则 403），`emptyTrash` 还需 `confirm:true`；当前 `dsh-web-app` 也拒绝 `--host 0.0.0.0`。→ 阻止跨源/局域网/同源注入任意调删除（见审查 F-1） |
| 3 外发数据 | 无：所有调用走本机 dsh host 的 `/sm/*` RPC（官方信任 fence 保护）与 storage-domain 事件，不连接任何外部地址 |

### 5.5 关键技术决策 A——删除的延迟提交架构（DSH React/Cordis 重设计）
参考 claude-gui `FileExplorerPanel.jsx`（模块作用域 `pendingDeletes`、倒计时顺组件卸载存活、`beforeunload` 兜底、幂等），但按 DSH 环境重写：

- **模块态放哪**：`src/client/pendingDeletes.ts` 顶层模块作用域 `const pendingDeletes = new Map<sessionId, Entry>()`（不放 React state）。`setTimeout(firePendingDelete, 10_000)` 的**定时器与真删逻辑都在模块作用域**，浏览器关闭/刷新前由 `window.addEventListener('beforeunload', flushPending)` 立即兑现（fire：调 `/sm/delete` fireAndForget + `navigator.sendBeacon`/keepalive 兜底），避免"真删没提交"。
- **如何驱动 UI 更新**：模块态变更通过一个自建订阅集合 `Subs` + `notify()`（bumpPending → 重读表渲染），如同 FileExplorerPanel 的 `panelSubs`/`bumpPending`。React 组件卸载只摘订阅、**绝不清表**；重挂载读表恢复撤销条与剩余秒数。
- **幂等执行**：`fire(sessionId)` 开头 `if (!pendingDeletes.has(sessionId)) return`（已撤销/已执行则不重复）。node 端同样以"目标目录已移走"为幂等真值。
- **多条目**：`Map` 天然支持多个 pending；每个条目独立 `setTimeout` 与撤销。
- **与 claude-gui 的差异**：
  - claude-gui 后端是它自己的 `rm -r`（服务端即时删），撤销窗口在"前端 pending + 服务端已删"之间；DSH 用回收站 `mv`，**撤销窗口 = node 端暂不真正落盘，10 秒后 host 端才把目录移入回收站**，撤销拦在文件移动前，更安全。
  - claude-gui 用 `fetch('/api/files/read')` 之类后端 REST；DSH 用 `ctx.connection.rpc.handle('/sm', ...)` 注册的 RPC channel + 浏览器同源 `fetch`，路由自带官方信任 fence（§2.1）。
  - DSH 的 host 是 Cordis：逻辑放 `apply(ctx)` 的 fiber，路由注册用 `ctx.effect` 做 dispose（卸载自动注销路由与定时清理）。

### 5.6 关键技术决策 B——「归档视图」UI 方案
- 入口：`sidebar.footer.action`（官方 list 槽）注册一个「归档」按钮（icon + 文案），点击展开/收起 overlay。
- 数据：读 `ctx.workspaces.list` 的 `archivedSessionIds` + `ctx.sessions.list.byId`；归档会话列表 = `archivedSessionIds.map(id => byId[id])`（`byId[id]` 为 undefined 的 dangling id 过滤掉，显示"该会话已不存在"占位或直接隐藏）。
- 每个归档行：显示 `displayTitle`，操作 **「取消归档」**（调 `unarchive`）与 **「删除」**（调 `delete`，走同一回收站/撤销流程；解决审查 I-5 归档删除可达性）。
- 「取消归档」后该会话从 `archivedSessionIds` 移除 → 官方 `sessionVisible` 不再过滤 → 自动回到正常列表，无需 client 额外操作。
- 「删除」归档会话：同正常列表删除，10 秒撤销条可用；host 两步（移文件 + 从 `archivedSessionIds` 移除 id），partial-failure 见 INTERFACE §3.1。

---

## 6. 明确不做（边界落地，from BRIEF §4）
- 不做批量删除、不做归档导出/迁移、不做"搜索含归档"、不做会话内容级修改（只整体移动/恢复文件）、不做 claude-gui 的服务器端进程管理。回收站清空策略 = **10 秒后 auto-清空不可撤销 + 手动清空按钮（二次确认）**（§7）。

---

## 7. 回收站清空策略（方案定稿）
> 口径（审查 A-4，已与 BRIEF §5 成功标准对齐）：**回收站 = 软删除**——倒计时结束把会话目录移入回收站，会话从列表消失且重启后不在列表；**但目录仍在磁盘回收站**，此时 UI 不再提供撤销入口（撤销条已过 10 秒消失）。**手动清空回收站才是硬删**（不可撤销）。BRIEF 成功标准第 3 条"文件移入回收站，从列表消失且重启后不复现"即满足——"不复现"指不再出现在会话列表，不承诺磁盘回收站也清空。
- **倒计时结束** = host 把目录移入回收站（"真删"的 UI 观感：会话从列表消失）。目录仍在回收站，理论上可恢复，但 UI 不提供入口。
- **保留策略**：回收站条目按 deadline 保留到**当日手动清空**（默认关闭定期清理，避免自动删用户数据；提供"清空回收站"按钮，点击二次确认后 `rm` 全清）。到期未清空 = 保留目录但不再出现在任何 UI。避免"10 秒后自动 rm"造成无法恢复的瞬时数据丢失（回收站是安全网，不是垃圾桶）。
- 清空 = `rm` 回收站根下全部条目，**不可撤销**，必须二次确认（client 弹确认框 + RPC `confirm:true`，并已过同源 fence）。

---

## 8. 审查修订记录（对照 PLAN-REVIEW.md 12 条）

> 每条给出处理方式：已修（落点）或 不采纳（理由，一句话）。

| # | 审查问题 | 处理方式 | 落点 / 理由 |
|---|---|---|---|
| F-1 | 高危路由无鉴权/CSRF + `GET /sm/api/trash` 泄密 | **已修** | 桥接从裸 `webServer.register` 改为 `connection.rpc.handle('/sm', handler, {authority:'loopback'})`——自动套官方 `isTrustedApiRequest`（Host loopback + `sec-fetch-site` + Origin 同源 → 403）；`emptyTrash` 另需 `confirm:true`；`GET trash` 不返回 `originalDir`（只回内部 id）。机制源码已核实（§2.1/§5.4/INTERFACE §3/§4） |
| I-1 | 错误契约缺输入边界 | **已修** | INTERFACE §3 每个入口补「输入校验」子表：`id` 非 string/含分隔符或`..`/空串 → `invalid-id`；`cwd` 越界 → `path-out-of-bounds`；`title` 超长 → `invalid-title` 等 |
| I-2 | restore 幂等歧义 + 可能覆盖同名新目录 | **已修** | INTERFACE §3.2 明确判定顺序：回收站记录不存在 → `not-in-trash`；记录在但原路径已被占 → `restore-target-exists`，**不移动不覆盖**；`rename` 契约=显式拒绝而非覆盖 |
| I-3 | 删除已归档会话的两步 partial-failure | **已修** | INTERFACE §3.1：集合写回失败则 delete 返回 `system-error`（非 `ok`），中间态契约+重试补齐明确 |
| I-4 | 运行中删除无 host 护栏 | **已修** | node 半 `delete` 前用 `ctx.sessions.get(id)`（node SessionStore）判 live，live → `session-running`，host 拒移；不仅靠 client 拦截（§5.2 风险6/INTERFACE §3.1），源码已核实 `dsh-session/lib` `SessionStore.get` |
| I-5 | 归档删除入口缺失/需求两写 | **已修** | 归档视图行加「删除」按钮（走同一回收站/撤销流程），删除已归档会话的两步写回因此可达（§4 T5/§5.6/INTERFACE §2.4） |
| I-6 | SPIKE 降级路径 C 自相矛盾 | **已修** | 废弃路径 C。改为：合并写回；子态A（get 拿不到）→ `workspace-domain-unavailable` 显式失败；子态B（写成功但广播不达）→ client 调官方 `ctx.workspaces.refresh()`（re-pull 携带 archivedSessionIds → `installArchived`）。实机验证列为 T3 发布 gate（§5.1 风险4） |
| A-1 | `id` 编码逃逸 | **已修** | 明确 `encodeSegment` 本就 1:1 转义 `..`/`/`/`:`/`~` + host 断言 `encodeSegment(id)===id` 且目标在 `projectDir(root,cwd)` 前缀内（§5.1 风险1/INTERFACE §3.1） |
| A-2 | HTTP 状态码未约定 | **已修** | INTERFACE §3 顶部：合法请求一律 200+`{ok,...}`；违反契约（缺 body/非法 JSON/缺鉴权头/`confirm` 缺失）返回 4xx（400/403） |
| A-3 | restore 并发未覆盖 | **已修** | INTERFACE §4 并发行补 restore 规则：以"回收站记录存在与否"为串行真值，同 id 串行、后写幂等 |
| A-4 | BRIEF 与 PLAN 口径差（10 秒自动清空 vs 手动清空） | **已修** | PLAN §7 明确"回收站=软删除、手动清空=硬删"；同时建议改 BRIEF §5 措辞（见 INTERFACE 无关，属文档口径） |
| A-5 | 删除当前选中会话 UI 态契约缺失 | **已修** | INTERFACE §1.4 补行：删除当前会话 → UI 回 no-session（或自动选中相邻）；撤销恢复后回到"未选中/重新打开"态 |

> 修订不引入新"未验证假设"：本次新增的关键机制（`connection.rpc.handle` 信任 fence、`ctx.sessions.get` 运行中判定、`encodeSegment` 净化、`workspaces.refresh` 的 `installArchived`）均已逐一读源码核实存在后写入。
