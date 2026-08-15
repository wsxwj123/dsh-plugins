# SECURITY-REPORT — dsh-session-manager 上线前安全审查

- 审查对象：`packages/dsh-session-manager`（DSH 双端插件：client DOM 注入 + node cordis 半插件）
- 判据：`.devflow/BRIEF.md` §8 敏感面声明（数据范围 / 密钥 / 外发三问）
- 依据：仅 BRIEF.md + `src/` 全部源码 + 发布配置（`package.json` / `cordis.patch.yml` / `build.mjs` / `tsdown.config.mjs` / `tsconfig*`）+ 编译产物 `lib/` 关键逻辑抽查（与 src 一致）
- 结论先行：**未发现致命 / 重要问题，可发布**（7 条建议级加固项见 §5）

---

## 1. 清单 A — 外部攻击面

### A1 注入（命令 / SQL / HTML / 路径）— 未命中，有多层防护
- 命令注入：未命中。运行时源码无 `child_process` / `execSync` / `spawn`（grep 全量扫描仅命中 `build.mjs` 构建期固定命令，参数非用户可控）。无数据库 → SQL 注入面不存在。
- DOM 注入：未命中。全项目仅两处 `innerHTML` / `dangerouslySetInnerHTML`：
  - `src/client/DeleteButton.tsx:122` `btn.innerHTML = TRASH_SVG` —— 编译期常量字符串，无用户数据拼接；
  - `src/client/ArchiveEntry.tsx:35` `dangerouslySetInnerHTML: { __html: ARCHIVE_SVG }` —— 同上。
  - 会话标题等用户数据一律经 React `createElement` props（自动转义）或 `setAttribute`（属性上下文转义）渲染，见 `UndoRail.tsx:39,53`、`ArchiveView.tsx:119`、`DeleteButton.tsx:120`。无 XSS 面。
- 路径注入：未命中，见 B6 的三重门控（id 字符集 + `%` 编码碰撞 + bounds 检查）。`cwd` 只经 `projectKey()` 折叠为单目录段（`src/paths.ts:84-103`，分隔符一律折叠为 `-`、越权字符转义 `~XXXX`），无论用户提供还是取自会话 header 的 cwd 都无法引入路径分隔符逃逸。

### A2 密钥硬编码 / 敏感文件进 git — 未命中
- 源码全量 grep（`api[_-]?key|secret|passw|token|BEGIN.*PRIVATE|Bearer`）零命中。
- npm 发布范围被 `package.json:14-17` `files: ["lib", "cordis.patch.yml"]` 严格限定，`.devflow/`、`tests/`、`node_modules/`、`src/` 均不进包。
- 注：包根无 `.gitignore`；git 层面是否排除 `.devflow/`（含计划/测试输出）与 `node_modules/` 不在本次可查范围（禁止看 git），见建议 S7。

### A3 不安全解析（eval / 动态执行）— 未命中
- grep `eval(|new Function|child_process|spawn` 零命中（唯一 fetch 见 A8）。仅用 `JSON.parse`（`src/index.ts:190`、`src/trash.ts:83`），输入被严格 shape 校验（`bodyIsObject` + 逐字段类型检查）。

### A4 依赖 — 未命中仿冒 / 高危包
- 运行时依赖 `dependencies` 为空（`package.json:38-53` 仅 devDependencies + peerDependencies）：node 半只依赖 node 内置模块 + 注入的 cordis 服务（`webServer/storageDomain/sessions`，`src/index.ts:54`）；peer 依赖 `@deepseek-ai/cordis` 与 `react/react-dom` 由宿主提供。无第三方运行时代码进入攻击面。
- devDeps（tsdown/lightningcss/typescript/cordis/react 等）均为常见正规包，仅构建期使用。版本用 `^` 滚动，见建议 S7。

### A5 提示词注入面 — 未命中
- 本插件完全不触碰 LLM / prompt（源码无任何 llm/prompt 相关代码），不存在外部内容拼入 prompt 的路径。与 BRIEF §8 一致。

---

## 2. 清单 B — 内部数据安全

### B6 文件读写范围 — 合规，无越界
- 程序只动两个目录：`sessionsRoot`（默认 `~/.dsh/sessions`）+ `trashRoot`（默认 `~/.dsh/session-manager-trash`，`src/index.ts:73-81`）。
- **删除目标三重门控**（`src/handler.ts:138-188`）：
  1. `assertValidId`：拒非字符串/空/`.`/`..`/路径分隔符/控制字符/basename 不往返（`src/paths.ts:39-46`）；
  2. `isStableSegment`：拒含 `%` 的 id（防 `~XXXX` 编码碰撞，`src/paths.ts:54-57`）；
  3. `isInsideOrEqual(sessionsRoot, targetDir)`：目标必须解析在 sessions root 内（`src/handler.ts:186`、`src/paths.ts:130-134`）。任一不过 → 拒绝移动。
- `cwd` 不参与直接路径拼接，只生成项目目录段（`src/paths.ts:118-123`）；对 `'..'`、`'/'` 前缀、长串等做了逐字符折叠 + 251 段长截断，无法构造 `..` 逃逸（`src/paths.ts:84-103`）。
- 归档域写入只改 `archivedSessionIds` 一个字段，其余字段经 `{...current}` 保留（`src/handler.ts:252`），不动其他域。
- **不读写会话正文**：`moveToTrash` / `restoreItem` 仅 `fs.renameSync` 整体移动目录（`src/trash.ts:116-123, 145-150`），从未打开 `session.jsonl.zstd`（`SESSION_MARKER` 仅作识别，`src/trash.ts:23`）。符合 BRIEF §8.1「不读写会话内容」。
- 唯一注意点（建议 S1）：`empty()` 对 trashRoot 下**所有**非 `_metadata` 条目递归删除（`src/trash.ts:159-182`），边界依赖「trashRoot 是专用目录」这一配置假设。

### B7 删除操作 — 合规：有确认、可回退、无越权批量删除
- 会话删除 = 移入回收站（可回退），5 秒撤销窗（`UNDO_WINDOW_MS = 5000`，`src/client/pendingDeletesCore.ts:34`）+ 撤销恢复（`undo()`，同文件 :265）；fire 前先 `drop(id)` 保证幂等与撤销竞态安全（:193-206）。
- 运行中会话（`byId.running`）点击删除时 `window.confirm` 前置确认（`src/client/index.tsx:92`）；`force` 在 host 侧已是兼容 no-op（`src/handler.ts:148-154` 注释），不存在凭 force 绕过确认的路径。
- **回收站清空双重确认**：UI `window.confirm`（`src/client/ArchiveView.tsx:81`）+ 协议层 `body.confirm === true` 严格布尔（`src/handler.ts:287`，否则 400 `confirmation-required`）。不可撤销动作有二次确认，符合 BRIEF §8.1。
- 无 `rm -rf` 会话级批量删除；唯一递归删除是 `empty()`（限 trashRoot + 双重确认，`src/trash.ts:186-187`）。
- 偏差记录：BRIEF F1/§8 声明撤销窗 10 秒，实现为 5 秒 —— 需求/实现不一致，非安全缺陷（见建议 S6）。

### B8 数据外发 — 未命中，信任 fence 有效
- client 唯一网络调用是**同源相对路径** `fetch('/sm/...')`（`src/client/bridge.ts:23`，BASE = `'/sm'`），无任何绝对/外部 URL；node 半无网络客户端代码。BRIEF §8.3「无外发」成立。
- `/sm/*` 每个请求先过 loopback fence（`src/index.ts:166-170`，403 先于 body 读取与一切 handler 工作）：
  - Host 必须为 loopback 权威（`localhost` / `[::1]` / 127/8，`src/trust-fence.ts:28`、`src/http-util.ts:11-19`）；非标准 IP 形式（十进制/十六进制/短格式）经 WHATWG URL 规范化后仍须落回 127/8，无绕过；
  - `Sec-Fetch-Site: cross-site` 拒绝（`src/trust-fence.ts:31`）；
  - 有 Origin 时必须与 Host 同源（`src/trust-fence.ts:36`）；`Origin: 'null'` 字符串（sandbox iframe / file:// 场景）走 `new URL('null')` 抛错 → 403，**跨站 CSRF 面（含 text/plain 免预检 POST）实际被封死**。
  - 残余假设：fence 校验的是 Host 头而非对端 socket 地址，安全性依赖宿主 web server 只绑定 loopback —— 与官方 `/api` fence match-for-match（`src/trust-fence.ts:1-13` 注释），属宿主配置，超出插件控制，备注不列建议。

### B9 日志泄露 — 基本未命中（轻微）
- 全部日志内容为：会话 id、标题、cwd 路径、错误消息字符串（`src/handler.ts:231,255,293`、`src/index.ts:100-117`、`src/client/index.tsx:100`）。无 token / 密码 / 会话正文。
- `String(err)` 透传给响应体（如 `src/handler.ts:231`）只回给已过 fence 的 loopback 调用者，本机可见，可接受。
- 轻微项（建议 S4）：client `console.debug` 会打印完整 cwd 路径与全部会话标题列表（`src/client/index.tsx:100`、`src/client/DeleteButton.tsx:108-109`），会话标题可能含敏感业务词，且仅存于浏览器 console。

### B10 凭证存储 — 未命中
- 插件不处理任何 key / cookie / 登录态。唯一持久化是 localStorage 键 `dsh-sm.deleted`（`src/client/pendingDeletes.ts:20`），只存已确认删除的会话 id 字符串数组，非敏感、明文无害。
- 注意（建议 S5）：该集合无失效机制，`smRestore` 已在 bridge 定义（`src/client/bridge.ts:61`）但当前 UI 未接线；未来接入「从回收站恢复」时若不清理该集合，恢复的会话行会因 `isDeleted()` 永久隐藏（幽灵行）。

---

## 3. 核心判据：对照 BRIEF §8 敏感面声明

| §8 声明 | 程序实际行为 | 结论 |
|---|---|---|
| §8.1 只碰会话元数据（标题/id）+ 文件移动 | 读取 title/id/cwd（`context-types.ts`、`sessionRowMatch.ts`）；仅 `renameSync` 移动目录，不读正文 | 一致 |
| §8.1 删除只移动不删除、10 秒延迟 + 撤销 + 幂等 | 移入回收站可回退；5 秒撤销窗（实现偏差见 S6）；`requestDelete`/`fire` 幂等 | 一致（窗口时长偏差） |
| §8.1 回收站清空二次确认 | UI confirm + 协议 `confirm:true` 双重确认 | 一致 |
| §8.1 归档/取消归档只改 archive set | 仅写 `workspace` 域 `archivedSessionIds` 字段，保留其余 | 一致 |
| §8.1 不读写会话内容 | 全链路仅整体移动，无正文读写 | 一致 |
| §8.2 无凭证/token/API key | grep 零命中；无凭据存储/处理代码 | 一致 |
| §8.3 无外发 | client 仅同源 `/sm` fetch；node 无网络代码 | 一致 |

**结论：程序实际动的东西未超出声明范围，无高危偏离。**

---

## 4. 问题清单

### 致命：0 条

### 重要：0 条

### 建议：7 条（按优先级排序）

| # | 位置 | 危害（人话） | 修法 |
|---|---|---|---|
| S1 | `src/index.ts:76-79`（SM_TRASH_ROOT / config.trashRoot）+ `src/trash.ts:159-187`（empty 删除逻辑） | 若 `SM_TRASH_ROOT` 或配置把回收站指到一个已含文件的目录（如家目录、`/tmp` 下的别的目录），点「清空回收站」会对该目录下**除 `_metadata` 外的所有条目 `rm -rf`**——默认配置安全，但配置错误即灾难 | 启动校验 trashRoot 为「不存在 / 空 / 专用」：拒绝家目录、根目录、已知系统目录；`empty()` 只删存在对应记录或合法 id 形状的条目（与 `records()` 对齐），不盲删目录内一切 |
| S2 | `src/index.ts:183`（body 无大小上限 `for await (const chunk of req) raw += chunk`） | 本机进程（或误配置监听下的局域网）可发超大 body 打爆内存；跨站面已被 fence 挡住，属资源保护 | 设 body 上限（如 1MB），超限 413 直接拒 |
| S3 | `src/index.ts:172-201`（路由不区分 HTTP 方法） | GET 也会进 handler；当前 GET 无 body 无副作用（仅 `trash` 只读可达），属硬化项而非漏洞 | 写操作方法白名单（仅 POST），其余 405 |
| S4 | `src/client/index.tsx:100`、`src/client/DeleteButton.tsx:108-109`（console.debug 打 cwd 全路径与全部会话标题） | 会话标题可能含敏感业务内容，全部落浏览器 console；仅本机可见 | 降级/脱敏：debug 日志去掉标题与 cwd，或改记 id |
| S5 | `src/client/pendingDeletes.ts:20-40` + `src/client/pendingDeletesCore.ts:153-162`（deletedIds 持久化无失效） | `smRestore` 已定义未接线；将来接上「从回收站恢复」后，恢复的会话 id 仍留在 `deletedIds` → 该行永久隐藏（幽灵行） | 恢复路径同时清 `deletedIds`（`undo()` 已有防御性清除可复用，`pendingDeletesCore.ts:272`），或给集合加时间戳过期 |
| S6 | `src/client/pendingDeletesCore.ts:34`（`UNDO_WINDOW_MS = 5000`）vs BRIEF F1/§8（10 秒） | 撤销窗口比需求短一半：用户误删后反悔时间更少；非安全缺陷，但发布文档与实现不一致会误导用户预期 | 实现对齐 10 秒，或改 BRIEF/README 声明 5 秒 |
| S7 | `package.json:14-17,38-48`（无 .gitignore；lib 为构建产物；devDeps 用 `^` 滚动） | `.devflow/`（含计划与测试输出）、`tests/`、`node_modules/` 若被 git 提交会进仓库（npm 发布已被 `files` 排除）；`lib/` 应构建生成而非入库；devDeps 滚动版本让构建链可漂移 | 确认仓库根 `.gitignore` 覆盖 `.devflow/`、`tests/`、`node_modules/`、`lib/`；devDeps 锁版本或 CI 校验可复现构建 |

---

## 5. 结论

**可发布。** 未发现致命或重要安全问题：文件操作被 id/cwd 双重编码 + bounds 门控锁死在声明目录内、删除可回退、清空有双重确认、无外发、无凭证、无注入面，实际行为与 BRIEF §8 敏感面声明逐条一致。7 条建议均为防御加固与发布卫生项，其中 S1（回收站根目录配置校验）建议在发布前顺手做掉，其余可列入后续迭代。
