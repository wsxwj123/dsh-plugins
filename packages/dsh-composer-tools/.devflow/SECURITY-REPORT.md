# SECURITY-REPORT — dsh-composer-tools

**结论：可发布。** 经全面核对源码与 BRIEF.md 敏感面声明，程序实际动的东西与声明严格一致，未发现致命或重要安全问题；仅有若干本地、同用户作用域的建议级加固项，不阻塞发布。

> 审查范围：`src/`（host + client）、`package.json`、`build.mjs`、`tsdown.config.mjs`、`cordis.patch.yml`、`data/prompt-templates.json`。未查看 git 历史 / 其他 .devflow 产物 / 开发过程对话。

---

## A. 外部攻击面

### 1. 注入 —— 命中（处理到位）
- **命令/SQL 注入**：宿主无任何 shell 拼接或 SQL。指令写回仅 `fs.writeFileSync(p, content)`（src/handler.ts:206），`path` 不参与命令构造。
- **访问路径注入**：RPC 的 `path` 参数经**两层**防线：
  1. `INSTRUCTION_BASENAMES` 白名单，`path.basename(p)` 必须精确等于 `AGENTS.md / CLAUDE.md / AGENTS.local.md / CLAUDE.local.md`（src/handler.ts:120,173；handler.ts:43）——直接封死 `../` 相对逃逸；
  2. `isDiscoveredPath(p, discovery)` 要求解析后的**绝对路径与发现集合精确相等**（src/instructions.ts:170-173），而非前缀/包含判断——封死 `dir/../../` 类前缀逃逸。
- **面板渲染（XSS）**：指令正文、搜索命中片段、提示词名称/描述/正文全部走 React 文本节点（`{h.snippet}`、`{it.prompt}`）或受控 `value`（textarea），源码无 `dangerouslySetInnerHTML` / `innerHTML` / `href=javascript`（全 src 检索无命中）。外部内容仅作为数据展示，React 自动转义。
- 未见把用户输入拼进可执行上下文（eval/Function/属性名等）的渲染路径。

### 2. 密钥硬编码 —— 未命中
对 `src/ package.json build.mjs cordis.patch.yml tsdown.config.mjs` 全量检索 `api_key / token / bearer / sk-xxx / password / secret / PRIVATE KEY` 无命中。无敏感面声明外任何密钥。

### 3. 不安全解析 —— 未命中
运行时无 `eval`、无 `new Function`、无动态 `require`/`import`。grep 命中的 `import('./prompts-store.js')`（handler.ts:49）是 TS 纯类型注解，`/^\/ct\/([^/?#]+)/` 是正则 literal，均非动态执行。`build.mjs` 中 `createRequire/execFileSync` 仅解析固定 tsdown 入口（构建期、硬编码路径），非运行时攻击面。

### 4. 依赖 —— 未命中（干净）
`package.json` 依赖全部为知名官方发布源：react/react-dom ~18、cordis rc、tsdown、lightningcss、typescript、@types/*、@playwright/test。无仿冒/可疑包名；devDependencies 与 peerDependencies 界限清晰。构建产物挂载走 cordis `window.__ModuleLoader__` 冻结模块表，无任意依赖注入。

### 5. 提示词注入面 —— 命中（数据隔离良好）
- 提示词库（780 条 AGPL 数据）只读本地打包文件 `data/prompt-templates.json`（`PROMPTS_DATA_URL` 相对 import.meta.url，src/prompts-store.ts:21），不下载、不外发，正常化为纯字符串字段（src/prompts-store.ts:114-129）。
- 模型输出并非本插件消费对象；外部提示词只流向：面板文本节点 + 输入框草稿（`inputActions.setDraft`，append.ts 纯拼接）。插件**不自动执行**任何提示词内容，不因其触发工具/副作用——注入到提示词的恶意指令最多演化为用户自己决定发送的文本。符合声明"当数据隔离"。
- AGPL-3.0 来源在 `/ct/prompts` 返回（src/prompts-store.ts:36-40）与面板底栏（src/client/Panel.tsx:54-60）双处标注。README 标注属发布前确认项，源码侧已声明。

---

## B. 内部数据安全（重点）

### 6. 文件读写范围 —— 命中（未越界）
- **读取**：仅 `~/.dsh/AGENTS.md` + 项目根→cwd 链的 `AGENTS.md/CLAUDE.md/.local`（discoverInstructions，src/instructions.ts:91-119）。发现阶段用 `lstatSync` 并 `st.isSymbolicLink()` 拒绝符号链接（src/instructions.ts:133-139）。精确匹配声明读取范围，不含会话文件、不含其他目录。
- **写入**：唯一写点 `doSave`（src/handler.ts:166）。要写成功，`path` 必须同时满足 basename 白名单 + 精确属于本次发现集合。发现集合被严格限定为：全局 `~/.dsh/AGENTS.md` + 客户端给定 cwd 的 `.git` 根到 cwd 链上实际存在的指令文件（`findProjectRootSync` + `ancestorChain`，src/instructions.ts:54-82）。**basename 白名单 + 精确成员资格（双重校验，非常必要）已足以防逃逸**：既防 `../` 相对逃逸，也防仅 basename 命中但落在非发现目录的绝对路径（精确相等比对，非前缀判断）。
- **TOCTOU / symlink 竞态（建议级）**：`doRead`/`doSave` 在发现后仍会对 `p` 再 `lstatSync`（src/handler.ts:133,195），但**没有再校验 `st.isSymbolicLink()`**——发现与最终 `readFileSync`/`writeFileSync`（handler.ts:139,206）之间，若同用户进程将目标替换为 symlink，会跟随写入其指向处。属本地同用户、低危（替换者本就对该目录有写权限，可直接写目标文件），建议在写前用 `open()/O_NOFOLLOW` 或再判 `lstat.isSymbolicLink()` 收敛。

### 7. 删除操作 —— 未命中
运行时无 `rm/unlink/trash` 逻辑。`build.mjs:16` 的 `rm('lib', …)` 指向固定构建输出目录，构建期硬编码路径，非用户可触达，不构成攻击面。符合声明"不碰 trash/删除逻辑"。

### 8. 数据外发 —— 未命中
- 客户端唯一网络面是 same-origin 相对路径 `/ct/*`（`BASE='/'+'ct'`，src/client/bridge.ts:13-16；`fetchImpl(path,…)` 传相对 URL，bridgeCore.ts:37-44）——**无绝对 URL、无跨源请求、无 env 读取**。
- 宿主 `/ct/prompts` 只读本地打包 `data/prompt-templates.json`（prompts-store.ts:84-111），不下载、不外发。
- 未发现把本机文件内容、环境变量、用户数据发送到外部地址的任何路径。全 src 检索 `https?://` 仅命中 CherryHQ 来源标注链接。

### 9. 日志泄露 —— 未命中
logger 仅 3 处调用，均静态字符串 + `String(err)`（src/index.ts:57,65；handler.ts:299）。错误对象 toString 多为异常消息/堆栈，**不含 token、密码或完整文件内容**。客户端无任何 `console.*`，文件正文永不被记录。

### 10. 凭证存储 —— 未命中
无 key/cookie 落盘。浏览器 localStorage 仅写插件专属命名空间 key `dsh-composer-tools:history:<sessionId>`（src/client/history-storage.ts:17-19），另有 UI 状态——均在"自己 localStorage"声明范围内。无纳入 git 的凭证文件。

---

## 核心判据（对照 BRIEF 敏感面声明逐条）

| 声明 | 实际 | 判定 |
|---|---|---|
| 读取：`~/.dsh/AGENTS.md` + 项目链 AGENTS.md/CLAUDE.md/.local | 精确匹配（instructions.ts:91-119） | ✅ 一致 |
| 写入：全局+项目级指令文件，写前路径必须在项目根内防逃逸 | basename 白名单 + 精确成员资格双重校验（handler.ts:120,173,190；instructions.ts:170） | ✅ 一致 |
| 不写会话文件、不碰删除 | 无会话写、无 rm | ✅ 一致 |
| 无密钥 | 检索无命中 | ✅ 一致 |
| 不发起任何网络请求（提示词随包内置） | 仅 same-origin `/ct` + 本地 data 文件 | ✅ 一致 |
| 第三方 AGPL 标注 | panel 底栏 + `/ct/prompts` 双处标注 | ✅ 一致 |

**程序实际动的东西未超出声明范围，无高危越界。**

---

## 建议（非阻塞、可选加固）

1. **写路径 symlink 竞态收敛（建议）** — src/handler.ts:195-206，`doSave` 再 `lstatSync` 后未复核 `isSymbolicLink()`。建议写前以 `open(O_WRONLY|O_NOFOLLOW)` 打开句柄并 `fstat` 确认正则文件，消除发现→写入窗口。低危：本地同用户、替换者本就对该目录可写。

2. **cwd 完全由客户端供给（建议）** — src/handler.ts:166-193，`doSave` 以请求体 `cwd` 决定项目根与写范围。正确性依赖 trust fence 与同源假设；已由 fence（loopback + cross-site 拒绝 + Origin 同源，trust-fence.ts:23-40）兜底。加固方向：host 侧由实际会话服务端校验 `cwd`，而非信任客户端自报。属设计共识，非缺陷。

3. **mtime 乐观锁仅为 UX 防线（提示）** — src/handler.ts:202-203 + src/client/InstructionsTab.tsx:112-120。`mtime-conflict` 时客户端可 `expectedMtimeMs-1` 强制覆盖（用户确认过）；且同源调用方也能先 `read` 取当前 mtime 绕过。此锁语义是"防误覆盖"，非安全边界，文档/注释可如实说明。

4. **AGPL-3.0 数据随 MIT 插件分发（提示，已由用户确认承担）** — `data/prompt-templates.json` 源自 Cherry Studio agents-zh.json（AGPL-3.0），打入 MIT 许可包。源码已双处标注来源与许可（prompts-store.ts:36-40；Panel.tsx:54-60）。发布 README 时务必保留完整来源+许可证文本（AGPL 需随分发提供）并附上游链接。风险已录入复审声明，非安全漏洞，属合规提示。

---

## 结论

**可发布。** 外部攻击面与内部数据安全全项核查通过：无注入、无密钥、无动态执行、依赖干净、无数据外发、无日志泄露、无凭证落盘；文件读写范围与 BRIEF 敏感面声明逐一吻合，`path` 双重校验（basename 白名单 + 精确发现成员资格）足以防路径逃逸。仅存建议级加固与合规提示，均不构成发布阻塞。
