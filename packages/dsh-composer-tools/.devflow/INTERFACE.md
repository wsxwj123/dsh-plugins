# INTERFACE — dsh-composer-tools 对外接口约定

本文是测试设计的唯一输入：不看实现代码也能照着写测试。所有判定顺序、错误码、
报错文案均为契约的一部分，实现必须与本文逐字一致；本文未覆盖的行为属实现自由。

路由面：`/ct` 前缀原始 HTTP JSON RPC（与 dsh-session-manager 的 `/sm` 同构）。
client 半经同源 `fetch` POST JSON 调用；host 半挂 loopback trust fence。

---

## 0. 传输层公共契约（所有端点适用，先于任何端点逻辑判定）

按以下顺序判定，命中即返回，不再向下走：

| # | 条件 | 响应 |
|---|------|------|
| 1 | trust fence 失败（Host 非 loopback / `Sec-Fetch-Site: cross-site` / Origin 与 Host 不同源） | **403**，纯文本 body `forbidden`，非 JSON |
| 2 | HTTP 方法非 POST | **405**，header `allow: POST`，纯文本 `method not allowed` |
| 3 | URL 无法解析出方法名（`/ct/` 后无段） | **404**，纯文本 `not found` |
| 4 | body 超过 `MAX_BODY_BYTES = 2097152`（2 MB，含 content-length 预声明超限） | **413**，JSON `{ok:false, code:'payload-too-large', message:'request body exceeds 2097152 bytes'}` |
| 5 | body 流读取中途失败（client abort 等） | **400**，JSON `{ok:false, code:'bad-request', message:'request body read failed'}` |
| 6 | body 非空但不是合法 JSON | **400**，JSON `{ok:false, code:'bad-request', message:'invalid JSON'}` |
| 7 | 方法名不存在于端点表 | **404**，JSON `{ok:false, error:'not found'}`（注意：字段名是 `error` 不是 `code`，与 /sm 一致；这是刻意对齐既有行为的历史形态，新代码不要学，也不要当成漏洞去"修"） |

约定：
- 空 body 视为 `undefined`；除 `/ct/prompts` 外各端点要求 body 为 JSON 对象，否则 **400** `{ok:false, code:'bad-request', message:'body must be an object'}`。
- 所有 JSON 响应 `content-type: application/json`。
- 输入非法 → HTTP 400；领域级拒绝（路径越界、文件不存在、mtime 冲突、IO 失败）→ HTTP 200 + `{ok:false, code, message}`。与 /sm 分层一致。
- 请求体中本文未列出的多余字段一律忽略，不报错。

---

## 1. host RPC 端点

### 1.1 POST /ct/instructions.list — 发现指令文件

**请求**
```json
{ "cwd": "/absolute/session/cwd" }
```

**判定顺序**
1. body 是对象（否则公共契约 400 `body must be an object`）。
2. `cwd` 必须是非空 string 且 `path.isAbsolute(cwd)` 为真 → 否则 **400** `{ok:false, code:'invalid-cwd', message:'invalid cwd: must be an absolute path string'}`。
3. 执行发现（§3），返回结果。发现过程不抛错：单个文件 stat 失败跳过该文件。

**成功响应 200**
```json
{
  "ok": true,
  "dshHome": "/Users/x/.dsh",
  "projectRoot": "/abs/project/root",
  "files": [
    {
      "path": "/Users/x/.dsh/AGENTS.md",
      "displayPath": "~/.dsh/AGENTS.md",
      "level": "global",
      "name": "AGENTS.md",
      "sizeBytes": 1234,
      "mtimeMs": 1750000000000.0
    },
    {
      "path": "/abs/project/root/AGENTS.md",
      "displayPath": "AGENTS.md",
      "level": "project",
      "name": "AGENTS.md",
      "sizeBytes": 100,
      "mtimeMs": 1750000000000.0
    }
  ]
}
```

- `files` 排序契约（与 dsh-agent-instructions 发现顺序一致）：全局文件在最前；随后按项目根 → cwd 的目录链（由宽到窄）；同一目录内先常规候选（`AGENTS.md`、`CLAUDE.md`）再 local 候选（`AGENTS.local.md`、`CLAUDE.local.md`）；同一路径去重。
- `level` ∈ `"global" | "project" | "local"`：全局 = `{dshHome}/AGENTS.md`；常规候选 = `project`；`.local.md` 候选 = `local`。
- `displayPath`：全局文件为 `~/.dsh/AGENTS.md`（dshHome 非默认时为 `$DSH_HOME/AGENTS.md`）；项目文件为相对 projectRoot 的路径（如 `sub/AGENTS.md`）。
- 只列**当前存在**的**常规文件**（符号链接不收录，见 §2.4）；一个文件都没有时 `files: []`，仍是 `ok:true`。
- **cwd 不存在或不可读**：不报错，正常返回 `ok:true`——逐级探 `.git` 全部失败，`projectRoot = path.resolve(cwd)`，`files` 仅含可能存在的全局文件（全局文件也不存在时为空数组）。会话 cwd 被外部删掉属正常边界，不是错误。
- `mtimeMs` 取自 `fs.lstat` 的 `mtimeMs` 原值（可为浮点）。

### 1.2 POST /ct/instructions.read — 读单个指令文件

**请求**
```json
{ "cwd": "/abs/cwd", "path": "/abs/path/to/AGENTS.md" }
```

**判定顺序**
1. body 对象 → 2. `cwd` 校验（同 1.1，400 `invalid-cwd`）→
3. `path` 校验：必须是 string、绝对路径、basename ∈ {`AGENTS.md`, `CLAUDE.md`, `AGENTS.local.md`, `CLAUDE.local.md`} → 否则 **400** `{ok:false, code:'invalid-path', message:'invalid path: must be an absolute path to AGENTS.md / CLAUDE.md / AGENTS.local.md / CLAUDE.local.md'}`。
4. **范围校验**：以 `cwd` 现场重跑发现（§3），`path.resolve(path)` 不在发现结果绝对路径集合内 → **200** `{ok:false, code:'path-out-of-scope', message:'path is not among the instruction files discovered for cwd'}`。
5. 文件不存在（列出后被删）→ **200** `{ok:false, code:'file-not-found', message:'instruction file not found'}`。
6. 读取 IO 失败 → **200** `{ok:false, code:'system-error', message: String(err)}`。

**成功响应 200**
```json
{ "ok": true, "path": "...", "content": "<utf8 原文>", "mtimeMs": 1750000000000.0, "truncated": false }
```
- `content` 为文件原文（不做 `\r\n` 归一，编辑器展示真实内容）。
- 文件 utf8 字节数 > `MAX_SOURCE_BYTES = 1048576` 时：`truncated: true`，`content` 为「utf8 字节数不超过 1048576 的最长前缀」（不在多字节字符中间切断）；否则 `truncated: false`。

### 1.3 POST /ct/instructions.save — 写回指令文件

**请求**
```json
{ "cwd": "/abs/cwd", "path": "/abs/path/AGENTS.md", "content": "<新全文>", "expectedMtimeMs": 1750000000000.0, "allowTruncatedBase": false }
```
- `allowTruncatedBase` 可选，缺省 false；语义见判定第 9 步。

**判定顺序**（顺序是契约）
1. body 对象。
2. `cwd` 校验 → 400 `invalid-cwd`（同 1.1）。
3. `path` 校验 → 400 `invalid-path`（同 1.2，basename 白名单相同）。
4. `content` 校验：必须是 string 且 utf8 字节数 ≤ 1048576 → 否则 **400** `{ok:false, code:'invalid-content', message:'invalid content: must be a string of at most 1048576 utf8 bytes'}`。
5. `expectedMtimeMs` 校验：必须是有限 number 且 ≥ 0 → 否则 **400** `{ok:false, code:'invalid-mtime', message:'invalid expectedMtimeMs: must be a finite non-negative number'}`。
6. `allowTruncatedBase` 若提供必须是 boolean → 否则 **400** `{ok:false, code:'invalid-allow-truncated-base', message:'invalid allowTruncatedBase: must be a boolean'}`。
7. 范围校验（现场重跑发现，同 1.2-4）→ 200 `path-out-of-scope`。
8. 文件不存在 → 200 `file-not-found`（**本端点不创建新文件**）。
9. **截断基准保护**（防静默丢尾）：当前文件 utf8 字节数 > `MAX_SOURCE_BYTES` 且 `allowTruncatedBase !== true` → **200** `{ok:false, code:'file-truncated', message:'file exceeds 1048576 bytes; saving a truncated base would silently drop the tail — edit it with an external editor, or resend with allowTruncatedBase:true'}`。原理：read 对超 1MB 文件只下发截断前缀，基于它保存会把尾部砍掉；host 侧用「当前文件大小 > 上限」做无状态判定。client 默认不传 `allowTruncatedBase`，UI 收到此错误应提示用户改用外部编辑器；`allowTruncatedBase:true` 是给"明确接受覆盖"的调用方留的逃生门。
10. **mtime 乐观锁**：当前 `lstat.mtimeMs !== expectedMtimeMs`（严格不等）→ **200** `{ok:false, code:'mtime-conflict', message:'file changed on disk since it was read', "currentMtimeMs": <当前值>}`。
11. 写入（全文覆盖，utf8）。IO 失败 → 200 `{ok:false, code:'system-error', message: String(err)}`。

**成功响应 200**
```json
{ "ok": true, "mtimeMs": 1750000001234.0 }
```
- `mtimeMs` 为写入后重新 stat 的值，client 用它更新本地基线。
- 写入内容原样落盘（client 传入什么写什么；`\n` 归一由 client 在编辑层决定，host 不做）。

### 1.4 POST /ct/prompts — 提示词库全量下发

**请求**：空 body 或 `{}` 均可；body 若提供必须是对象（否则公共契约 400）。

**判定顺序**：无输入校验。数据文件不可读/解析失败 → **200** `{ok:false, code:'system-error', message:'prompt library unavailable: ' + String(err)}`。

**成功响应 200**
```json
{
  "ok": true,
  "source": {
    "name": "Cherry Studio agents-zh.json",
    "url": "https://github.com/CherryHQ/cherry-studio",
    "license": "AGPL-3.0"
  },
  "items": [
    { "id": "uuid", "name": "...", "description": "...", "prompt": "...", "emoji": "😀", "group": ["工具"] }
  ]
}
```
- `items` 字段与源数据一致；`prompt`/`description` 中的 `\r\n` 由 host 统一归一为 `\n` 后下发。
- host 进程内缓存一次，后续请求不重读磁盘（重启生效更新）。

---

## 2. client 纯函数契约（node 单测可直接驱动，无 DOM/React 依赖）

### 2.1 方向键门槛判定（gate.ts）

```ts
export interface ArrowGateInput {
  isComposerTarget: boolean      // e.target 就是本 composer 的 textarea（焦点前置条件）
  key: string                    // KeyboardEvent.key
  text: string                   // textarea 当前全文
  selectionStart: number
  selectionEnd: number
  isComposing: boolean           // KeyboardEvent.isComposing（IME 合成期）
  shiftKey: boolean; ctrlKey: boolean; metaKey: boolean; altKey: boolean
  menuOpen: boolean              // 调用方判定：见 §3（含 fail-safe）
}
export type ArrowAction = 'older' | 'newer'
export function arrowGateAction(input: ArrowGateInput): ArrowAction | null
```

判定规则（自上而下，命中即返回）：
0. `isComposerTarget !== true` → `null`。**焦点前置条件**：事件目标必须是本 composer 的
   textarea 本身；面板内的指令编辑 textarea、搜索框等任何其他元素上的方向键一律放行，
   绝不拦截（否则面板编辑被历史导航劫持）。
1. `key !== 'ArrowUp' && key !== 'ArrowDown'` → `null`（←/→ 永不触发）。
2. 任一修饰键为 true → `null`。
3. `isComposing === true` → `null`。
4. `menuOpen === true` → `null`（命令菜单打开时方向键归菜单）。
5. `selectionStart !== selectionEnd`（有选区）→ `null`。
6. `text` 不含 `'\n'`（单行）→ `ArrowUp` 得 `'older'`，`ArrowDown` 得 `'newer'`。
7. 多行：光标行号 = `text.slice(0, selectionStart)` 中 `'\n'` 的个数（0 基）；末行号 = `text` 中 `'\n'` 总个数。`ArrowUp` 且光标行号 === 0 → `'older'`；`ArrowDown` 且光标行号 === 末行号 → `'newer'`；其余（中间行）→ `null`。
8. 返回 `null` 表示**不拦截**：不 preventDefault、不 stopPropagation，原生行为原样发生。

### 2.2 历史状态机（history-core.ts）

```ts
export const HISTORY_LIMIT = 100
export interface HistoryState {
  entries: string[]    // 最新在前（index 0 = 最近一次发送）
  cursor: number       // -1 = 未在翻历史；0..entries.length-1 = 当前展示 entries[cursor]
  stash: string | null // 进入历史前的草稿（cursor 从 -1 首次上移时保存）
  pending: string | null // 发送采集中、尚未确认的文本
}
export function createHistory(entries?: string[]): HistoryState
// entries 缺省 []；传入时被原样采用（调用方负责已裁剪/去重，来自 loadHistory）。

export function capturePending(state: HistoryState, text: string): HistoryState
// trim 后为空 → 原样返回（不录空白）；否则 pending = trim 后的原文。

export function commitPending(state: HistoryState): HistoryState
// pending === null → 原样返回。否则：去掉 entries 中与 pending 完全相等的既有条目（去重），
// unshift 到最前，裁到 HISTORY_LIMIT 条（丢最旧），pending 置 null。cursor/stash 不动。

export function dropPending(state: HistoryState): HistoryState
// pending 置 null（发送失败 restore 时调用，误录条目根本不进 entries）。

export function recallOlder(state: HistoryState, currentDraft: string):
  { state: HistoryState; text: string } | null
// entries 为空 → null（放行）。cursor === -1：stash = currentDraft，cursor = 0。
// cursor 已在最旧（=== entries.length - 1）→ 仍消费：返回最旧条目文本，状态不变。
// 其余：cursor + 1。返回 entries[cursor]。

export function recallNewer(state: HistoryState):
  { state: HistoryState; text: string } | null
// cursor === -1 → null（放行，↓ 正常移动光标）。
// cursor > 0 → cursor - 1，返回 entries[cursor]。
// cursor === 0 → cursor = -1，返回 stash ?? ''，stash 置 null（翻到底恢复草稿）。

export function resetCursor(state: HistoryState): HistoryState
// 翻历史途中用户手动编辑/退格时调用：cursor = -1，stash = null。entries/pending 不动。
```

所有函数纯函数：返回新状态对象，不改入参。

### 2.3 localStorage 读写（history-storage.ts）

```ts
export interface KeyValueStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}
export function historyStorageKey(sessionId: string): string
// 恰为 'dsh-composer-tools:history:' + sessionId

export function loadHistory(storage: KeyValueStorage, sessionId: string): string[]
// key 不存在 / JSON 解析失败 / 解析结果非数组 → []。
// 数组中非 string 项被过滤；结果裁到 HISTORY_LIMIT 条。

export function saveHistory(storage: KeyValueStorage, sessionId: string, entries: string[]): boolean
// 写入 JSON.stringify(entries.slice(0, HISTORY_LIMIT))；setItem 抛错（配额满等）→ 返回 false，不抛出。
```

### 2.4 指令发现（host，instructions.ts）

```ts
export const INSTRUCTION_CANDIDATES = ['AGENTS.md', 'CLAUDE.md'] as const
export const LOCAL_INSTRUCTION_CANDIDATES = ['AGENTS.local.md', 'CLAUDE.local.md'] as const
export const PROJECT_ROOT_MARKERS = ['.git'] as const
export const MAX_SOURCE_BYTES = 1048576

export type InstructionLevel = 'global' | 'project' | 'local'
export interface DiscoveredInstruction {
  path: string          // 绝对路径
  displayPath: string   // 见 1.1 契约
  level: InstructionLevel
  name: string          // basename
  sizeBytes: number
  mtimeMs: number
}
export interface DiscoveryResult {
  dshHome: string
  projectRoot: string
  files: DiscoveredInstruction[]   // 排序契约见 1.1
}

export function resolveDshHomeLocal(configured?: string, env?: NodeJS.ProcessEnv): string
// configured?.trim() || env?.DSH_HOME?.trim() || join(os.homedir(), '.dsh')，再 path.resolve。
// 与 @deepseek-ai/dsh-home-paths resolveDshHome 同语义（空白 DSH_HOME 视为未设）。

export function findProjectRootSync(cwd: string): string
// 从 path.resolve(cwd) 起逐级向上，第一个含 '.git'（文件或目录均可）的目录即项目根；
// 走到文件系统根都没有 → 返回 path.resolve(cwd) 本身。目录不存在/不可读视为"无标记"。

export function ancestorChain(root: string, cwd: string): string[]
// 返回含两端的目录链 [root, ..., cwd]，由宽到窄。

export function discoverInstructions(opts: { cwd: string; dshHome?: string }): DiscoveryResult
// 同步实现（fs.lstatSync）。全局 {dshHome}/AGENTS.md 存在则列在最前（level 'global'）；
// 项目根 = findProjectRootSync(cwd)；对 ancestorChain 每层依次查常规候选再 local 候选，
// 存在的才收录；按绝对路径去重。
// 【符号链接拒收】所有存在性/元数据探测一律用 lstat：`lstat.isSymbolicLink()` 为真的
// 候选**不收录**（含全局文件）。理由：跟随 symlink 的 stat 会把指向项目根外的链接文件
// 收进发现集合，scope 校验随之穿透，"写不出项目范围"的承诺失效；拒收后 symlink 既不在
// list 出现，read/save 的范围校验（成员比对）也天然拒绝它。lstat 失败的文件跳过。

export function isDiscoveredPath(inputPath: string, discovery: DiscoveryResult): boolean
// path.resolve(inputPath) ∈ discovery.files 的绝对路径集合。因发现已拒收 symlink，
// 成员比对即同时完成"非符号链接"约束，无需二次 realpath。
```

### 2.5 提示词追加拼接（append.ts）

```ts
export function appendPromptToDraft(current: string, prompt: string): string
```
规则（自上而下命中）：
1. `current === ''` → 返回 `prompt`（空输入直接放）。
2. `current` 以 `'\n\n'` 结尾 → `current + prompt`（已有空行，不重复补）。
3. `current` 以 `'\n'` 结尾 → `current + '\n' + prompt`。
4. 其余 → `current + '\n\n' + prompt`（先补一个空行再追加）。

永不覆盖、永不自动发送；`prompt` 的 `\r\n` 已由 host 归一（1.4）。

---

## 3. client 侧平台依赖的引用约定（非纯函数，供实现与 e2e 对照）

- `isComposerTarget` 的判定：document capture keydown 中 `e.target` 必须就是本 composer
  的 textarea 元素（DOM 锚点：textarea 带 `data-phase` 属性，容器有 `data-input-scroll`/
  `data-input-backdrop`/`data-input-mirror`，`client.js:3781/3788/3800`）。不是 → gate
  入参 `isComposerTarget: false`，一律放行。
- `menuOpen` 的判定（**含 fail-safe**）：`isComposerTarget` 为真时读该 textarea 的
  `data-phase` 属性，`!== 'plain'` 即菜单/仲裁活跃（依据：`dsh-client-ui-conversation/
  lib/client.js:3800` textarea 实时反映 InputState.phase）。**属性读不到（不存在/空串/
  元素取不到）时一律按 `menuOpen: true` 处理**——宁可历史功能整体失效，不可抢命令菜单
  的 ↑/↓。`data-phase` 的取值序列属 DOM 调试属性而非接口承诺，T0 spike 实测回填本条目。
- 回填草稿：slot 组件 props 的 `inputActions.setDraft(text)`（`types/client/input/
  contract.d.ts:65-76`，"Single public draft write path"）。
- 发送采集：slot 组件 props 的 `useInput` selector 订阅 `InputState.phase`（∈
  `plain|adjudicating|claimed|submitting`）；进入 `submitting`/`adjudicating` 时 draft
  未清，此刻 `capturePending`；随后 draft 变 `''`（commitSend 已清）→ `commitPending`；
  phase 回到 `plain` 且 draft 恢复为 pending 原文（发送失败 restore）→ `dropPending`。
  **`claimed` 归属钉死：claimed 是菜单仲裁中间态、不是发送，进入 claimed 时
  capture/commit/drop 都不动**（状态机显式忽略该值）。
- **手动编辑检测**：插件记录最近一次自己经 `inputActions.setDraft` 写入的文本
  （`lastProgrammaticText`）。textarea 的 `input` 事件值 === `lastProgrammaticText` →
  程序回填，不处理；不等（或 `lastProgrammaticText` 为空）→ 用户手动编辑/退格，
  调 `resetCursor(state)`。由此翻历史自身触发的 input 事件不会被误判为手动编辑。
- 光标复位：setDraft 后对聚焦 textarea `setSelectionRange(len, len)`（rAF 内），对齐
  InputBar restoreCaret 行为。
- 复制：`writeClipboard`（`@deepseek-ai/dsh-client-ui-primitives` 导出，属平台
  external）；返回 false → UI 提示「复制失败」。
- sessionId/cwd 来源：`ctx.sessions.list` 快照（current 会话 id + byId[id].cwd）；
  历史按 sessionId 隔离（2.3 key 规则）。
