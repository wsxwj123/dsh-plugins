# 调研：客户端插件如何正确拿到「当前会话的工作目录」（0.2.0-rc.2）

> 目标宿主：DeepSeek Harness 桌面版 0.2.0-rc.2。
> 0.2 源码全部取自 `app.asar`，逐字解包副本位于 `/tmp/asar_out/`（行号以此副本为准）；
> in-asar 路径用 `asar://` 前缀标注，便于自行复现。
> 0.1.5 对照为普通文件，直接用真实路径。

---

## 0. 三条最关键结论（先给结论）

1. **0.2 的 `ctx.sessions.list` 快照里根本没有 `current` 字段**，字段名也没换成别的——它被整个删掉了。`byId` 里表示工作目录的字段仍是 **`cwd`**，没变。
2. **取不到 cwd 的根因是 `snapshot.current === undefined`**（不是 `byId[sessionId]` 为 undefined，也不是条目里没有 cwd）。插件 `sessionId = snapshot.current` 恒为 `undefined`，三元表达式在查 `byId` 之前就短路返回 `undefined`。
3. **0.2 的正确取法是读 session 作用域的标准 slot prop `sessionId`，再 `byId[sessionId]?.cwd`**。这个 prop 在 0.1.5 和 0.2 都由官方提供，天然双版本兼容。官方 UI 自己就是这么拿的。

---

## 1. 关键事实修正：`dsh-client-runtime` 这个包不存在

任务里提到的 `@deepseek-ai/dsh-client-runtime` 在 0.2 asar 和 0.1.5 里**都不存在**（grep 文件清单零命中）。插件的 `context-types.ts` 注释里也引用了 "dsh-client-runtime"，该注释已失真。

实际提供 `ctx.sessions` 的是：
- `@deepseek-ai/dsh-api-session-controller` 的 client 半侧（`lib/client.js`），它 `reflect.provide("sessions", ...)`；
- 快照引擎是 `@deepseek-ai/dsh-client-store`（`createSnapshotStore`）。

证据（0.2 asar 文件清单）：

```text
/tmp/asar_files.txt 中：
  dsh/node_modules/@deepseek-ai/dsh-api-session-controller/lib/client.js
  dsh/node_modules/@deepseek-ai/dsh-client-store/lib/index.js
（grep "dsh-client-runtime" → 无匹配，exit 1）
```

---

## 2. Q1：0.2 里 `ctx.sessions.list` 快照的确切形状

### 2.1 顶层形状（已证实）

`list` 是 `createSnapshotStore` 创建的裸 store，初始状态为：

```js
// asar://dsh/node_modules/@deepseek-ai/dsh-api-session-controller/lib/client.js
// 解包副本：/tmp/asar_out/dsh__node_modules__@deepseek-ai__dsh-api-session-controller__lib__client.js
3166:  this.list = (0, _deepseek_ai_dsh_client_store.createSnapshotStore)({
3167:    ids: [],
3168:    byId: {},
3169:    phase: "pending",
3170:    projectionsBySession: {}
3171:  });
```

每次 `projectList()` 重写快照时，顶层也只有这四个字段：

```js
// 同上文件
3570:  this.list.set({
3571:    ids,
3572:    byId,
3573:    phase,
3574:    projectionsBySession
3575:  });
```

对照 0.1.5 的初始状态（**有** `current`）：

```js
// ~/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-api-session-controller/lib/client.js
3061:  this.list = (0, _deepseek_ai_dsh_client_store.createSnapshotStore)({
3062:    ids: [],
3063:    byId: {},
3064:    current: void 0,
3065:    phase: "pending",
3066:    subagentsByParent: {},
3067:    jobsBySession: {},
3068:    currentAddress: void 0
3069:  });
```

结论（已证实）：

| 字段 | 0.1.5 | 0.2 |
|---|---|---|
| `ids` | ✅ `string[]` | ✅ `string[]` |
| `byId` | ✅ `Record<id, summary>` | ✅ `Record<id, summary>` |
| `current` | ✅ 当前会话 id | ❌ **已删除** |
| `phase` | ✅ | ✅ |
| `subagentsByParent` / `jobsBySession` / `currentAddress` | ✅ | ❌ 已删除 |
| `projectionsBySession` | ❌ | ✅ 新增 |

即：`current` 字段被删除，不是改名。没有 `workspace`、`directory` 之类的替代字段。

### 2.2 `byId[id]` 每条摘要的形状（已证实）

```js
// 同上 0.2 client.js，projectList() 内
3502:  for (const entry of items) {
3503:    ids.push(entry.sessionId);
3504:    byId[entry.sessionId] = {
3505:      id: entry.sessionId,
3506:      displayTitle: displayTitleOf(entry.title, entry.cwd, entry.sessionId),
3507:      running: entry.running,
3508:      retainedBy: this.retentionSnapshot(entry.sessionId).retainedBy,
3509:      blank: entry.blank,
3510:      updatedAt: entry.updatedAt,
3511:      ...entry.projectionValues === void 0 ? {} : { projectionValues: entry.projectionValues },
3512:      ...entry.title !== void 0 ? { title: entry.title } : {},
3513:      ...entry.cwd !== void 0 ? { cwd: entry.cwd } : {},
3514:      ...entry.parentSessionId !== void 0 ? { parentId: entry.parentSessionId } : {},
3515:      ...entry.origin !== void 0 ? { origin: entry.origin } : {}
3516:    };
3517:  }
```

结论（已证实）：
- **工作目录字段名就叫 `cwd`**（第 3513 行，`entry.cwd`）。没有 `workspace` / `directory`。
- 它是**可选字段**：只有宿主摘要里有 `cwd` 时才会展开进 `byId[id]`。空白新会话（还没绑定目录）时该字段缺省。
- 每条还有 `retainedBy`（保留计数表），这是 0.2 判定「当前会话」的新信号（见 §4）。

宿主 `session.list` 返回的摘要里 `cwd` 的来源（已证实）：

```js
// asar://dsh/node_modules/@deepseek-ai/dsh-api-session-controller/lib/index.js
// 解包副本：/tmp/asar_out/dsh__node_modules__@deepseek-ai__dsh-api-session-controller__lib__index.js
2043:  function listFields(header) {
2044:    return {
2045:      ...header.parentSession === void 0 ? {} : { parentSessionId: header.parentSession },
2046:      ...header.origin === void 0 ? {} : { origin: header.origin },
2047:      ...header.cwd === void 0 ? {} : { cwd: header.cwd }
2048:    };
2049:  }
```

且创建会话时 cwd 会被解析（`workspace.path ?? request.cwd ?? defaultCwd`）：

```js
// 同上 index.js
687:    if (request.workspaceId !== void 0 && request.cwd !== void 0) throw new RemoteError(...)
694:    const cwd = workspace?.path ?? request.cwd ?? this.defaultCwd;
```

---

## 3. Q2：精确指出取不到的原因

插件取法（已证实，读自插件源码）：

```tsx
// ~/Desktop/app/dsh-plugins-wt-0.2/packages/dsh-composer-tools/src/client/ComposerEntry.tsx
63:  const snapshot = ctx.sessions.list.getSnapshot()
64:  const sessionId = snapshot.current
...
180: const cwd = sessionId === undefined ? undefined : snapshot.byId[sessionId]?.cwd
```

**精确原因（已证实）：`snapshot.current` 为 `undefined`。**

推导链：
1. 0.2 的 `list` 快照从初始状态到 `projectList()` 每次 `set()` 都不含 `current`（§2.1 第 3166-3171、3570-3575 行）。
2. 因此 `snapshot.current === undefined`。
3. 第 64 行 `sessionId = undefined`。
4. 第 180 行的三元 `sessionId === undefined ? undefined : ...` 直接走 `undefined` 分支，**根本不会去查 `byId`**。
5. 所以 `cwd` 恒为 `undefined`，面板显示「无当前会话目录」。

**不是**以下原因（逐一排除）：
- ❌ 不是 `byId[sessionId]` 为 undefined——因为压根没走到这步；且 `byId` 正常填充（`projectList` 第 3502-3517 行）。
- ❌ 不是条目里没有 `cwd`——`byId[id].cwd` 在宿主摘要含 cwd 时确实存在（第 3513 行；宿主侧第 2047 行）。
- ❌ 不是字段改名——`current` 直接删除、`cwd` 保持原名。

---

## 4. Q3：0.2 的推荐取法（官方插件真实例子）

### 4.1 「当前会话」在 0.2 变成了什么

0.1.5 用 `list.current`（由 `sessions.open(id)` 选中）；0.2 删掉了它，改为**派生值**：当前会话 = `retainedBy.mainView > 0` 的那条（即被「主视图」保留的那条）。官方有两处独立实现此判定：

```js
// asar://dsh/node_modules/@deepseek-ai/dsh-client-ui-session/lib/client.js
// 解包副本：/tmp/asar_out/dsh__node_modules__@deepseek-ai__dsh-client-ui-session__lib__client.js
279:  publishMain() {
280:    if (!this.active) return;
281:    const byId = this.sessions.list.getSnapshot().byId;
282:    const currentId = this.current.value.key;
283:    const nextId = currentId !== void 0 && (this.sessions.retainInfo(currentId).getSnapshot().retainedBy.mainView ?? 0) > 0
284:      ? currentId
285:      : Object.values(byId).find((candidate) => (candidate.retainedBy.mainView ?? 0) > 0)?.id;
...
339:  isMain(sessionId) {
340:    return (this.sessions.list.getSnapshot().byId[sessionId]?.retainedBy.mainView ?? 0) > 0;
341:  }
```

```js
// asar://dsh/node_modules/@deepseek-ai/dsh-client-ui-layout/lib/client.js
// 解包副本：/tmp/asar_out/dsh__node_modules__@deepseek-ai__dsh-client-ui-layout__lib__client.js
60:  const current = Object.values(state.byId).find((session) => (session.retainedBy.mainView ?? 0) > 0)?.id;
```

### 4.2 官方 UI 怎么拿「当前会话的 cwd」（关键例子）

官方不走 `list.current`，而是**读 session 作用域的标准 slot prop `sessionId`**，再 `byId[sessionId]?.cwd`：

```js
// asar://dsh/node_modules/@deepseek-ai/dsh-client-ui-conversation/lib/client.js
// 解包副本：/tmp/asar_out/dsh__node_modules__@deepseek-ai__dsh-client-ui-conversation__lib__client.js
16212:  function ConversationContent(props) {
16213:    const { sessionId, phase, hero, useSession, useSessions, useSessionStatus, useWorkspaces, useInput, ... } = props;
...
16220:    const cwd = useSessions((s) => sessionId === void 0 ? void 0 : s.byId[sessionId]?.cwd);
```

同一份代码里，非 React hook 上下文直接用快照：

```js
// 同上 conversation client.js（composer bar 的 inject 函数）
18334:  inject: (sessionId) => {
...
18363:    const cwd = sessions.list.getSnapshot().byId[sessionId]?.cwd;
```

`sessionId` 这个 prop 来自 session 作用域的标准源（`dsh-client-ui-session`），**0.1.5 与 0.2 都有**：

```js
// 0.2 —— asar://.../dsh-client-ui-session/lib/client.js（解包副本同名）
121:  const BUILTIN_SOURCE = {
122:    hooks: ["session"],
123:    keyedHooks: ["projection"],
124:    props: ["sessionId"],
125:    resolve: (binding) => ({
126:      hooks: { session: binding.session },
127:      keyedHooks: { projection: (key) => binding.session.projections.faceOf(key) },
128:      props: { sessionId: binding.sessionId }
129:    })
130:  };
```

```js
// 0.1.5 —— ~/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-ui-session/lib/client.js
64:    props: ["sessionId"],
...
68:      props: { sessionId: binding.sessionId }
```

`sessionId` 如何落到槽组件 props（已证实，renderer 把 `binding.props` 原样展开）：

```js
// asar://dsh/node_modules/@deepseek-ai/dsh-client-ui-renderer/lib/client.js
// 解包副本：/tmp/asar_out/dsh__node_modules__@deepseek-ai__dsh-client-ui-renderer__lib__client.js
646:  function materializeStandardBinding(binding, optional, defaultKey) {
647:    const standard = { ...binding.props };      // ← sessionId 在这里被原样展开
...
675:    standard = {
676:      ...materializeStandardBinding(rootBinding, false, scopeBinding.key),
677:      ...materializeStandardBinding(scopeBinding, scope === "session-maybe")
678:    };
...
763:    return (0, react_jsx_runtime.jsx)(Comp, {
764:      ...kit,          // kit 里含 ...standard，即含 sessionId
765:      ...injected,
766:      ...slotInjected.props,
767:      ...contextual,
768:      ...ownerProps
769:    });
```

插件注册的槽位是 `conversation.input.left`，它在 0.2 里是 `scope: "session"`（已证实）：

```js
// 0.2 conversation client.js
18309:  "conversation.input.left": {
18310:    kind: "list",
18311:    scope: "session"
18312:  },
```

0.1.5 同槽也是 `scope: "session"`（已证实）：

```js
// ~/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-ui-conversation/lib/client.js
16728:  "conversation.input.left": {
16729:    kind: "list",
16730:    scope: "session"
16731:  },
```

并且插件注册回调里已经 `{...props}` 透传了标准 props（只是没去用 `sessionId`）：

```tsx
// ~/Desktop/app/dsh-plugins-wt-0.2/packages/dsh-composer-tools/src/client/index.tsx
25:  const offSlot = ctx.slots.inject('conversation.input.left', () =>
26:    ctx.slots.register(
27:      { name: 'conversation.input.left', id: SLOT_ID, order: 1000 },
28:      (props: Record<string, unknown>) =>
30:        createElement(ComposerEntry, { ctx, ...props } as never),
31:    ),
32:  )
```

**结论（已证实）**：推荐取法 = 读标准 slot prop `sessionId` → `ctx.sessions.list.getSnapshot().byId[sessionId]?.cwd`。这是官方 UI 自己的写法，且 `sessionId` prop 双版本可用。

---

## 5. Q4：建议改法（含代码骨架，兼容 0.1.5）

改两处：`ComposerEntry.tsx`（主改）+ `context-types.ts`（类型对齐）。

### 5.1 `ComposerEntry.tsx`

改第 63-64 行（sessionId 来源）与 `EntryProps` 声明。核心：**优先用标准 slot prop `sessionId`，兜底用 0.1.5 的 `snapshot.current`**（后者在 0.2 上为 `undefined`，自动失效，不影响）。

```tsx
// ---- EntryProps 增加标准 session 作用域 prop ----
interface EntryProps {
  ctx: Context
  /** session 作用域标准 prop（0.1.5 与 0.2 都由 dsh-client-ui-session 提供）。 */
  sessionId?: string
  useInput: (selector: (s: InputSelection) => unknown) => unknown
  inputActions: InputActions
  wide?: boolean
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any
}

export function ComposerEntry(props: EntryProps): ReactNode {
  const ctx = props.ctx
  const inputActions = props.inputActions

  // ---- 会话快照 + 当前会话 id ----
  const snapshot = ctx.sessions.list.getSnapshot()
  // 0.2：list 快照已无 `current`；当前会话 id 来自 session 作用域标准 prop。
  // 0.1.5：`current` 仍在，兜底兼容（在 0.2 上为 undefined，不生效）。
  const sessionId = props.sessionId ?? snapshot.current

  // ...其余逻辑不变（nav.switchSession / 快照采集 / phase 机）...

  // ---- cwd（指令发现用）----
  const cwd = sessionId === undefined ? undefined : snapshot.byId[sessionId]?.cwd

  // ...渲染不变...
}
```

说明：
- `props.sessionId` 是 session 作用域标准 prop，会随会话切换自动更新（0.1.5/0.2 均如此），因此 `nav.switchSession(sessionId)` 与快照采集 effect 的依赖 `[ctx, sessionId, nav]` 无需改动。
- `snapshot.current` 兜底仅服务 0.1.5；如果确认不再支持 0.1.5，可只保留 `props.sessionId`。

### 5.2 `context-types.ts`（类型对齐，可选但建议）

```ts
// 当前（失真）：
export interface SessionSummary {
  ...
  cwd: string                 // ← 应为可选
}
export interface SessionListSnapshot {
  ids: string[]
  byId: Record<string, SessionSummary | undefined>
  current?: string            // ← 0.1.5 有、0.2 无，保留为可选兜底
  phase: string
}

// 改为：
export interface SessionSummary {
  id: string
  title?: string
  displayTitle: string
  cwd?: string                            // 0.2 里是条件展开，可选
  blank?: boolean
  running?: boolean
  updatedAt?: number
  completed?: boolean
  origin?: string
  parentId?: string                       // 0.2 里 parentSessionId → parentId
  retainedBy?: { mainView?: number; [k: string]: number | undefined }  // 0.2 新增
}
export interface SessionListSnapshot {
  ids: string[]
  byId: Record<string, SessionSummary | undefined>
  current?: string                        // 0.1.5 only；0.2 无
  phase: string
}
```

---

## 6. Q5：更稳的替代路径对比

| # | 路径 | 双版本可用 | 是否需 RPC 往返 | 结论 |
|---|---|---|---|---|
| A | session 作用域标准 prop `sessionId` + `byId[id]?.cwd` | ✅ 0.1.5/0.2 | 否 | **推荐**，官方同款，零往返 |
| B | `list.getSnapshot().current` | ❌ 仅 0.1.5 | 否 | 0.2 已删除，作兜底 |
| C | `byId[id].retainedBy.mainView > 0` 找当前 id | ❌ 仅 0.2 | 否 | 官方派生逻辑，但 0.1.5 无 `retainedBy`，需再写双版本分支 |
| D | `remote.session.list({})` RPC | ✅ | 是 | 返回**全部**摘要（含 cwd），但**没有**「当前会话」概念，仍要自己判定「哪条是当前」，多一次异步往返，不如 A |
| E | `scopeOf(ctx)` 读作用域 tag | ❌ | 否 | 只有 session 作用域 ctx 才带 `sessionId` tag；插件的 `ctx` 是根 ctx，取不到（见下） |

关于 D（`remote.session.list`）——0.2 的 `remote.session` 命名空间**没有** `get`/`current` 这类「直接返回当前会话」的方法，可调用的只有 `list / create / fork / cancel / rename / search / prompt / page / follow / attachment / updateQueue / projections / control`：

```js
// asar://.../dsh-api-session-controller/lib/client.js（解包副本同名）
2613:  const result = await this.remote.session.list({});
2661:  const result = await this.remote.session.search({ query }, signal);
2687:  const result = await this.remote.session.create(payload);
2726:  const result = await this.remote.session.fork({...});
```

关于 E——session 作用域 ctx 只打了 `sessionId` tag，不注入 `cwd`；且根 ctx 无此 tag：

```js
// asar://.../dsh-api-session-controller/lib/client.js（解包副本同名）
514:  function createScope(ctx, key) {
515:    const fiber = ctx.plugin(agentScope);
516:    const identity = { sessionId: key };
517:    return { fiber, ctx: fiber.ctx.extend({ [kScope]: identity, ... }) };
...
533:  function scopeOf(ctx) { return scopeIdentityOf(ctx)?.sessionId; }
```

---

## 7. 推测与最小实验验证

以下为**推测**（源码已读通、逻辑自洽，但未在 0.2.0-rc.2 桌面版实跑），需最小实验闭环：

1. **推测**：插件改为读 `props.sessionId` 后，`cwd` 能正确显示。
   **验证**：改 `ComposerEntry.tsx`（§5.1）→ 用 worktree 的构建流程产出插件 → 在 0.2.0-rc.2 桌面版加载 → 打开「指令/提示词」面板，观察是否显示目录而非「无当前会话目录」；再开一个空白新会话，确认 cwd 为 undefined（符合预期，新会话无目录）。

2. **推测**：`props.sessionId` 在第三方插件经 `ctx.slots.register` + `{...props}` 的这条路径上确实会被传递（源码 §4.2 已证明 renderer 会展开 `binding.props`，但插件自身注册链路是推断的）。
   **验证**：在 `ComposerEntry` 顶部临时 `console.log('sessionId prop =', props.sessionId)`，0.2 桌面版切几个会话观察打印值是否随切换变化。

3. **推测**：`byId[sessionId].cwd` 对桌面会话一定非空（宿主 `create` 用 `workspace.path ?? cwd ?? defaultCwd` 保证会话有 cwd，§2.2 已证实源码）。唯一例外是「尚未绑定目录的空白会话」。
   **验证**：实验 1 中同时打印 `snapshot.byId[sessionId]`，确认普通会话条目含 `cwd`。

---

## 8. 结论 + 建议改法（汇总）

**结论**：0.2 把「当前会话」从 `sessions.list.current`（+`sessions.open/clear`）迁移到了 UI 层派生值（`retainedBy.mainView`），并把 `sessionId` 作为 session 作用域标准 slot prop 下发。`byId` 与其中的 `cwd` 字段名都没变。插件只改「sessionId 从哪来」一处即可，且用 `props.sessionId` 天然兼容 0.1.5。

**建议改法**（最小改动，两文件）：

1. `ComposerEntry.tsx`：`EntryProps` 加 `sessionId?: string`；把
   ```ts
   const sessionId = snapshot.current
   ```
   改为
   ```ts
   const sessionId = props.sessionId ?? snapshot.current
   ```
   `cwd` 那行保持不变。

2. `context-types.ts`：`SessionSummary.cwd` 改可选、`SessionListSnapshot` 补 `retainedBy`/`parentId` 说明、`current` 标注为 0.1.5-only（§5.2）。

**不建议**再走 `snapshot.current` 或引入 `remote.session.list` 往返；`props.sessionId` 是官方同款、零往返、双版本兼容的最短路径。
