# PLAN — dsh-composer-tools（输入体验增强插件）

输入：`.devflow/BRIEF.md`（需求定稿）、`.devflow/RESEARCH-input-injection.md`（技术调研）、
参考实现 `packages/dsh-session-manager/`。接口细节见 `.devflow/INTERFACE.md`（测试设计的唯一输入）。

## 0. 一句话形态

同构 cordis 插件：host 半挂 `/ct` 前缀 HTTP RPC（指令发现/读写 + 提示词库下发，
loopback trust fence 把门），client 半往 `conversation.input.right` slot 注册一个入口
按钮，弹出面板（指令 tab + 提示词库 tab），并用 document capture keydown + 官方
`inputActions.setDraft` 实现方向键输入历史。

---

## 1. 架构与技术选型

### 1.1 总体：复用 session-manager 工程模式

直接复用已跑通的五件套：`webServer.register` 前缀路由 + 逐字移植的 loopback
trust fence、纯函数 core 抽到 node ESM 产物供单测（pendingDeletesCore 模式）、
tsdown 双 target（node ESM host + CJS client bundle + purity gate）、`ctx.effect`
dispose 链、cordis.patch.yml 挂 bundle。理由：该模式已在真实 web profile 验证可加载、
可挂载路由、可干净卸载，重造没有收益。

### 1.2 host 半（node）

**inject：`['webServer']`**。唯一需要的服务是挂路由；指令发现只需请求体里的 `cwd`
（client 从会话快照带来），不 inject `sessions`——比 session-manager 少一个依赖面。

四个模块：

1. **指令发现自实现（约 60 行，零依赖）** —— `src/instructions.ts`。
   照 `dsh-agent-instructions/lib/index.js:473-586` 的逻辑：`findProjectRoot`
   （`.git` 标记向上走，无标记回退 cwd 本身）+ `ancestorChain`（root→cwd 目录链）
   + 每层查 4 个候选（`AGENTS.md`/`CLAUDE.md`/`AGENTS.local.md`/`CLAUDE.local.md`，
   默认值见该文件 15-17 行）+ 全局 `{dshHome}/AGENTS.md`（`USER_GLOBAL_FILE`，140 行）。
   与官方的一处有意分歧：**探测一律用 lstat 且拒收符号链接**（symlink 不收录，
   防止写回穿透项目根，INTERFACE §2.4）。cwd 不存在/不可读属正常边界：不报错，
   projectRoot 回退 resolve(cwd)，files 仅含可能存在的全局文件。
   dshHome 解析自实现 5 行（configured ?? `$DSH_HOME` ?? `~/.dsh`，空白视为未设，
   与 `dsh-home-paths/lib/index.js:73-81` 同语义）。
   **不 import 官方包**：RESEARCH Q3 确认其 import 链带 `dsh-llm`/`schemastery` 等
   value import，profile 下 pnpm install 会把 `@deepseek-ai/*` 物理复制成第二份导致
   Symbol 分裂；发现逻辑本身是纯路径+lstat，自实现零风险。
2. **指令文件读写（含路径逃逸校验）** —— 同模块。所有写回（和读取）前**现场重跑发现**，
   目标路径必须落在发现结果集合内（`path.resolve` 后字符串比对），且 basename 必须在
   4 候选白名单内。写回不创建新文件（文件不存在即拒）。**mtime 乐观锁**：save 带
   `expectedMtimeMs`，与当前 lstat 严格不等 → `mtime-conflict`（200）+ 当前 mtime，
   client 提示「文件已被外部修改」给「重新加载/强制覆盖」选择。**截断基准保护**：
   文件当前 >1MB 且未显式 `allowTruncatedBase:true` → `file-truncated`（200）拒绝，
   防止拿截断前缀当全文保存把尾部砍掉。覆盖写后重新 lstat 回传新 mtime 作为下一次
   基线。读上限 `MAX_SOURCE_BYTES = 1MB`（与官方默认一致，超出给 `truncated: true`
   + 最长合法前缀）。
3. **提示词库 JSON 下发** —— `src/prompts-store.ts`。数据文件
   `data/prompt-templates.json`（780 条，复制自 claude gui，随包发布、**不进 client
   bundle**——RESEARCH Q4：1.6MB 内联会让每次 web 加载都付费，面板是低频功能）。
   首次 `/ct/prompts` 请求时 readFile + 进程内缓存，下发前把 `prompt`/`description`
   的 `\r\n` 归一为 `\n`（RESEARCH Q4 坑②）。响应携带 `source`（名称/链接/
   `AGPL-3.0`）供面板标注。
4. **路由装配** —— `src/index.ts` + `src/handler.ts`，/sm 模式原样套用：
   `webServer.register({kind:'prefix', path:'/ct', handler})`；handler 内顺序 =
   trust fence 403 → POST-only 405 → 方法名解析 404 → 读体（`readRequestBody`
   逐字复用：content-length 预检 + 流式字节计数，上限 2MB）→ JSON parse 400 →
   分发。async handler 用 try/catch 兜底**永不 reject**（session-manager I-4 教训）。
   trust-fence.ts / http-util.ts 从 session-manager 逐字移植（它是官方
   `isTrustedApiRequest` 的忠实移植，行为已对账）。
   **⚠️ handler 的 ctx 传递方式**：`createCtHandler(ctx)` 闭包捕获 ctx（handler 只做
   端点分发，业务在 instructions.ts/prompts-store.ts 纯模块）；**`ctx.logger` 每次
   调用时现取 `ctx.logger.x(...)`，禁止存成局部变量跨异步回调**（pet-bridge 崩溃坑，
   AGENTS.md 红线 2）。

### 1.3 client 半（React）

**inject：`['slots', 'sessions']`**（sessions 用于拿 current sessionId 与 cwd）。

1. **入口按钮 + 面板挂载**：`ctx.slots.inject('conversation.input.right', cb)` 注册
   list entry（带唯一 id `dsh-composer-tools`）。用 `slots.inject` 而非直接 `register`：
   slot 声明由 conversation 插件完成、加载顺序不保证，`inject` 等声明出现再跑
   （RESEARCH Q1 推荐路径 + `dsh-client-runtime/lib/client.js:55`）。
   **⚠️ callback 必须返回 `ctx.slots.register(...)` 的返回值（disposer）**——runtime
   的 `slots.inject(key, callback)` 语义是 "creates one disposer or an iterable of
   disposers"（`dsh-client-runtime/lib/client.js:55-110`），漏返回会导致卸载/重挂时
   槽位不摘、面板残留（cordis 约束常见坑，开发时必查）。**面板本体直接
   在 entry 组件内渲染**（position fixed 浮层），不需要 session-manager 的 createRoot
   overlay——因为我们的 entry 就在 composer 里。entry 组件凭 standard props 拿到
   `useInput` / `inputActions`（provide channel，`client.js:9504-9514`）。
2. **方向键历史**：entry 组件 useEffect 挂 `document.addEventListener('keydown',
   fn, true)` capture 监听。capture 先于 React root 上的监听器触发（React 18 事件
   挂在 root 容器，RESEARCH Q1a 依据 `react-dom.development.js:9132`），命中时
   `preventDefault + stopPropagation` 让 InputBar 的 `onKeyDown` 完全收不到事件。
   命中条件 = INTERFACE §2.1 门槛纯函数（**焦点前置：e.target 必须是本 composer
   textarea 本身**，面板内编辑框/搜索框的按键一律放行；单行恒放行 / 首行↑ / 末行↓ /
   中间行不拦 / 修饰键不拦 / IME 合成期不拦 / 有选区不拦 / **菜单打开不拦**）。
   菜单打开的判定：聚焦 textarea 的 `data-phase` 属性 `!== 'plain'`（textarea 实时反映
   InputState phase， `client.js:3800`；input-trigger 菜单活跃时 phase 为
   adjudicating/claimed）；**fail-safe：属性读不到时按菜单打开处理**（宁可历史失效，
   不抢菜单按键）。data-phase 是 DOM 调试属性而非接口承诺，取值序列由 T0 spike 实测
   回填 INTERFACE §3。
   命中后 `inputActions.setDraft(historyText)` 回填（官方单写路径，不模拟 DOM 事件，
   RESEARCH Q1b），rAF 内 `setSelectionRange(len, len)` 光标到末尾。历史条目以 `/`
   开头也不弹斜杠菜单：setDraft 不走 `track()` 热检测，候选检测要下一次真实击键才
   恢复——恰好满足 BRIEF F1 的对应要求。
3. **历史采集（phase 机两段式）**：订阅 `useInput` selector 拿到的 `InputState.phase`。
   进入 `submitting`/`adjudicating` 时 draft 未清 → `capturePending(draft)`；随后
   draft 变 `''`（commitSend 已清，发送被受理）→ `commitPending`；phase 回到
   `plain` 且 draft 恢复为 pending 原文（发送失败 restore）→ `dropPending`，
   误录条目不进历史（RESEARCH Q2 结论与坑）。不用「draft 非空变空」当发送信号
   （误录源太多：手动清空、undo 到空、slash token 消费、工作区切换草稿迁移）。
4. **历史状态机 + 持久化**：`history-core.ts`（游标/草稿 stash/去重/上限 100）+
   `history-storage.ts`（localStorage，key = `dsh-composer-tools:history:<sessionId>`，
   按会话隔离）。sessionId 从 `ctx.sessions.list.getSnapshot().current` 取；状态机
   实例模块级 Map 按 sessionId 缓存，条目变更即 save。**session 切换 slot 组件随
   scope 重挂**（RESEARCH Q1 风险③）：所有 DOM 监听在 useEffect cleanup 摘除，
   apply 级资源进 `ctx.effect` dispose 链。
5. **面板两个 tab**：
   - 指令 tab：打开即 `/ct/instructions.list`；展开文件即 `instructions.read`；
     「重新加载」重跑 list 并使内容缓存失效（不长期缓存，RESEARCH Q3 坑③）；
     搜索框做**跨文件全文搜索**（client 侧：首次搜索时把未读的文件 read 一遍，
     **面板本次打开期间缓存 read 结果**，之后按 标题/路径/正文 过滤——不每次击键
     全量 fetch；命中列「文件+行号+行片段」，点击跳转定位）；编辑用 textarea + 保存
     走 `instructions.save`（保存前明确确认对话框：会改变模型行为；mtime 冲突给
     重载/覆盖选择；`file-truncated` 拒绝时提示改用外部编辑器）。
   - 提示词 tab：首次切入才 fetch `/ct/prompts`（按需加载）；按 `group[0]` 归类
     折叠浏览（与 claude gui 一致避免重复）；搜索按标题/描述/正文过滤（client 侧）；
     「发送到输入框」= `inputActions.setDraft(appendPromptToDraft(current, prompt))`
     （INTERFACE §2.5 空行规则；不覆盖不自动发送）；「复制」= 官方 `writeClipboard`
     （`dsh-client-ui-primitives`，已在 CLIENT_EXTERNALS，不触发 purity gate），
     返回 false 给「复制失败」提示；面板底部常驻来源+AGPL-3.0 许可标注（附链接）。

### 1.4 数据流：client ↔ host RPC 契约

与 /sm 完全同构：client `bridge.ts` 同源 `fetch` POST JSON（GET-free，浏览器自动带
`Sec-Fetch-Site: same-origin` + loopback Host，正好满足 fence）；host `/ct` 前缀路由
+ trust fence。四个端点 `/ct/instructions.list|read|save` + `/ct/prompts`，请求/响应/
错误契约（判定顺序、HTTP 状态码、code、文案）全部固定在 INTERFACE.md §0–§1。

client bundle 红线：react/react-dom/cordis/dsh-client-runtime 等走 CLIENT_EXTERNALS
平台模块表；`@deepseek-ai/*` 禁 value import（type-only import 会被擦除、过 gate）；
`writeClipboard` 所在的 `dsh-client-ui-primitives` 已在 external 白名单。

---

## 2. 文件结构

```
packages/dsh-composer-tools/
├── package.json              # main: lib/index.js；dsh.bundle.patch + dsh.client 声明
├── cordis.patch.yml          # bundle 挂载行（id: composer-tools）
├── build.mjs                 # 复用 session-manager：直接 node 跑 tsdown entry（无 shell）
├── tsdown.config.mjs         # 双 target；PLUGIN_ID = 'dsh-composer-tools'
├── tsconfig.json / tsconfig.client.json
├── data/
│   └── prompt-templates.json # 780 条提示词（host 侧读，随 files 字段发布）
├── src/
│   ├── index.ts              # host apply()：inject ['webServer']，挂 /ct 路由 + fence
│   ├── handler.ts            # createCtHandler：4 端点分发，判定顺序=INTERFACE
│   ├── instructions.ts       # 发现 + isDiscoveredPath + 读写（§1.2-1/2，纯 node fs）
│   ├── prompts-store.ts      # data JSON 读取 + 进程内缓存 + \r\n 归一
│   ├── trust-fence.ts        # 逐字移植（isTrustedSmRequest → isTrustedCtRequest）
│   ├── http-util.ts          # 逐字移植
│   └── client/
│       ├── index.tsx         # client apply()：inject ['slots','sessions']，slot 注册 + dispose 链
│       ├── bridge.ts         # /ct typed caller（薄封装）
│       ├── bridgeCore.ts     # postJson 纯逻辑（可注入 fetch，node 单测驱动传输失败）
│       ├── gate.ts           # 方向键门槛（INTERFACE §2.1，纯）
│       ├── history-core.ts   # 历史状态机（INTERFACE §2.2，纯）
│       ├── history-storage.ts# localStorage 读写（INTERFACE §2.3，注入 storage 可测）
│       ├── append.ts         # 提示词追加拼接（INTERFACE §2.5，纯）
│       ├── ComposerEntry.tsx # slot entry：按钮 + keydown 监听 + phase 采集 + 面板开关
│       ├── HistoryNav.ts     # 串联 gate + history-core + inputActions.setDraft + 光标复位
│       ├── Panel.tsx         # 浮层面板壳（tabs、关闭、许可标注条）
│       ├── InstructionsTab.tsx # 列表/重载/全文搜索/编辑保存（确认对话框 + mtime 冲突处理）
│       ├── PromptsTab.tsx    # 分类浏览/搜索/发送到输入框/复制
│       └── panel.css
└── tests/                    # unit / acceptance / integration（三层防线，见 BRIEF 测试策略）
```

tsdown node target 的 entry 除 host 模块外，把 `gate/history-core/history-storage/
append/bridgeCore` 五个纯 client core 也产出 node ESM（session-manager 的
pending-deletes-core 模式），node --test 直接驱动。

---

## 3. 对外接口约定

单独成文：`.devflow/INTERFACE.md`。内容：传输层公共契约（403/405/404/413/400 的
精确形态与判定顺序）、4 个 RPC 端点的请求/响应/逐条错误契约（含判定顺序）、
方向键门槛/历史状态机/localStorage/指令发现/文本追加的纯函数签名与语义、client 侧
平台依赖对照表。测试设计只读该文件。

---

## 4. 任务拆解（顺序依赖；标注"可并行"的互不依赖）

| # | 任务 | 依赖 | 并行 |
|---|------|------|------|
| T0 | **spike（约半天，先于一切开发）**：最小 client 插件实证四件事——① document capture keydown 是否先于 InputBar 生效（含 DSH shell 自有 document 级 keydown 监听的注册顺序，打日志看先后）；② slot entry props 能否拿到 `inputActions.setDraft` 且可写；③ 斜杠菜单打开时聚焦 textarea 的 `data-phase` 实际取值序列；④ 顺手验证 R3 黑魔法备案（native value setter + dispatchEvent）在 React 18.3.1 受控 textarea 上是否真生效。**结论回填 INTERFACE §3 后才定稿下游契约**；某条证伪则回方案层改对应设计，不带着未验证假设进开发 | — | — |
| T1 | 脚手架：package.json / tsdown.config.mjs / build.mjs / cordis.patch.yml / tsconfig×2 / data 目录 | — | 可与 T0 并行 |
| T2 | host 基建：trust-fence.ts + http-util.ts（逐字移植，改名 /ct） | T1 | 可并行 |
| T3 | host 指令模块 instructions.ts（lstat 发现 + symlink 拒收 + 范围校验 + 读写 + mtime 锁 + 截断基准保护） | T1 | 可并行 |
| T4 | host 提示词 prompts-store.ts + data/prompt-templates.json 落位（复制自 claude gui，标注来源） | T1 | 可并行 |
| T5 | host 装配 handler.ts + index.ts（路由、读体、错误映射、ctx.effect dispose） | T2 T3 T4 | — |
| T6 | client 纯逻辑：gate.ts / history-core.ts / history-storage.ts / append.ts | T0 结论、T1 | 可并行（与 T2–T5 全部并行） |
| T7 | client bridgeCore.ts + bridge.ts | INTERFACE 定稿（本方案） | 可并行 |
| T8 | client 入口与历史导航：index.tsx / ComposerEntry.tsx / HistoryNav.ts | T0 结论、T6、T7 | — |
| T9 | client 面板壳 + 指令 tab：Panel.tsx / InstructionsTab.tsx | T7 | 可与 T10 并行 |
| T10 | client 提示词 tab：PromptsTab.tsx（浏览/搜索/发送/复制/许可条） | T7 | 可与 T9 并行 |
| T11 | 三层测试 + 真实环境 e2e（headless profile 加载 + 假接收端） | T5 T8 T9 T10 | — |
| T12 | 发布：monorepo README 更新（含历史按 sessionId 明文存 localStorage 的隐私说明）+ 本机 profile link 安装 + **装后检查 `node_modules/@deepseek-ai/` 是否物理副本（是则按工作区 AGENTS.md 流程 mv 移走、回退 fallback symlink、重启验证）** + 卸载残留检查 + awesome-dsh-plugin PR。headless e2e（T11）与本机 profile 验证是两个环境，互不替代 | T11 | — |

---

## 5. 风险清单

### 5.1 非机械改动的失败模式与缓解

| # | What/Where | 失败模式 | 缓解 |
|---|------------|----------|------|
| R1 | 写回指令文件（host instructions.ts + save 端点）——**高风险** | ① client 传伪造绝对路径（`/etc/...`、项目外任意文件）把任意文件当指令写；② 列出后文件被外部改动，盲写覆盖他人编辑；③ **symlink 穿透**：项目内指向项目根外的符号链接被跟随链接的 stat 收录、scope 校验通过、写回写到范围外；④ **截断丢尾**：read 返回 truncated 的 1MB 前缀被当全文编辑保存，尾部静默丢失 | ① 双闸门：basename 4 候选白名单（400）+ 以请求 cwd 现场重跑发现、目标必须在发现集合内（200 path-out-of-scope），发现集合本身只含 `~/.dsh/AGENTS.md` 和项目祖先链内的 4 候选，**不存在"集合外的合法目标"**；② mtime 乐观锁（mtime-conflict + 当前值，client 给重载/覆盖选择）；③ 发现与 scope 一律 **lstat 且拒收符号链接**——symlink 不进发现集合，成员比对天然拒绝，"写不出项目范围"的承诺在 symlink 下同样成立（INTERFACE §2.4）；④ save 端点**截断基准保护**：文件当前 >1MB 且未显式 `allowTruncatedBase:true` → 200 `file-truncated` 拒绝，提示改用外部编辑器（INTERFACE §1.3 第 9 步） |
| R2 | 方向键 capture 拦截（HistoryNav）——**高风险** | ① 条件判错废掉命令菜单 ↑/↓ 导航或 IME 选字；② 中间行误拦导致光标无法上下移动（编辑被破坏）；③ 面板内编辑框/搜索框的按键被 document 级监听劫持；④ `data-phase` 在后续版本改名/不再实时同步，menuOpen 恒 false → 退化成失败模式① | ① 拦截前必查聚焦 textarea `data-phase !== 'plain'` + `e.isComposing` + 修饰键 + 选区，全部来自事件/DOM 实时值；门槛逻辑纯函数化（INTERFACE §2.1）逐条单测；② 首行/末行判定用「`slice(0,selectionStart)` 的 `\n` 计数」纯函数，单行/多行/中间行正反用例全覆盖 + e2e 在真实 dsh web 手测 BRIEF 成功标准 1 全项；③ **焦点前置条件**：`e.target` 必须是本 composer textarea 才进入判定（INTERFACE §2.1 规则 0）；④ **fail-safe 契约**：`data-phase` 读不到时按 menuOpen=true 处理（宁可历史失效不抢菜单），且取值序列由 T0 spike 实测后再定稿，不靠打包产物行号硬扛 |
| R3 | `inputActions.setDraft` / `useInput` props 未承诺稳定（RESEARCH Q1 风险②） | dsh 升级后 props 改名/消失，历史回填与采集静默失效 | ① 版本对齐 `@deepseek-ai/dsh@0.1.0-rc.6` 并在 README 标注兼容版本；② entry 组件对 props 缺失做防御（拿不到 setDraft 时按钮照常、历史功能降级并 console.warn，不崩溃）；③ 升级回归手段 = e2e（T11）重跑；④ 备案：原生 value setter + dispatchEvent('input') 路径——**该备案在 T0 spike 第④项实测验证后才算数，未验证前不作为缓解依据** |
| R4 | 提示词 AGPL-3.0 数据打包进 MIT 插件（BRIEF 敏感面 5） | ① 被认定为 AGPL 素材再分发；② 用户不知数据来源 | ① 用户已拍板接受（BRIEF 记录），README 显著位置 + 面板底部常驻标注来源/许可/链接，`/ct/prompts` 响应的 `source` 字段程序内携带同一信息；② 数据文件原样保留、不声称自有版权 |
| R5 | 历史误录（R2 采集链路） | ① 发送失败 restore 后历史里多一条"没发出去"的条目；② 手动清空/undo/slash 消费被当发送录入 | ① phase 机两段式（capturePending → commitPending / dropPending），restore 场景 drop，INTERFACE §2.2 语义单测；② 根本不订阅 draft 变化当发送信号（RESEARCH Q2 误录源清单），只有 phase 迁移才触发 capture |
| R6 | session 切换 / 插件卸载 | ① document capture keydown 没摘，旧会话组件继续改新会话草稿；② localStorage 串会话 | ① keydown 监听挂 entry 组件 useEffect cleanup（slot 组件随 session scope 重挂，unmount 即摘）；apply 级注册进 `ctx.effect` dispose 链（session-manager index.tsx:203-215 范本）；e2e 覆盖切换会话后旧监听器不触发；② 历史 key 严格带 sessionId，状态机 Map 按 sessionId 分实例 |
| R7 | localStorage | 配额写满抛错使输入链路异常 | saveHistory try/catch 返回 false（INTERFACE §2.3），失败仅丢持久化、不影响当次使用 |
| R8 | host async 路由 | 读体中途断流/死 socket 写响应导致 unhandled rejection 崩插件 | readRequestBody 永不 reject + handler 外层 try/catch 兜底（session-manager I-4 同款），契约固定为 400 bad-request |
| R9 | 指令大文件/同步 IO | 1MB+ 指令文件拖慢面板或爆内存 | lstat 预检 + `truncated: true` 截断下发（上限与官方 maxSourceBytes 一致）+ save 截断基准保护（R1④）；发现/读写用同步 fs（文件少而小，避免 stream 状态机），save content 上限 1MB（400 invalid-content） |
| R10 | slots.inject 时序 | conversation.input.right 声明晚于本插件加载，直接 register 会静默失败 | 用 `ctx.slots.inject` 等声明出现再注册（RESEARCH Q1 推荐路径，官方插件同款用法） |

### 5.2 BRIEF 敏感面逐项保证

1. **读取范围**（`~/.dsh/AGENTS.md`、项目内 4 候选、自己 localStorage key）：发现逻辑只
   lstat 固定 4 个文件名 + 1 个全局文件且拒收符号链接，无任何递归遍历/通配读；
   localStorage 只碰 `dsh-composer-tools:` 前缀的 key。
2. **写入范围**（全局 + 项目级指令文件、自己 localStorage）：save 端点双闸门
   （basename 白名单 + 发现集合成员校验，R1）保证写不出这两个范围；不创建新文件、
   无删除/trash 逻辑；写操作 UI 层强制确认对话框；mtime 锁防覆盖外部编辑。
3. **密钥/登录态**：不需要——代码不读任何 env 密钥、不碰 token 存储，fence 只校验
   Host/Origin/Sec-Fetch-Site 三个 header。
4. **外部地址**：零网络请求——host 只监听本地 webServer，client 只 fetch 同源 `/ct/*`，
   提示词数据随包内置不下载；package.json 无运行时依赖（devDependencies 仅构建链）。
5. **第三方数据（780 条 AGPL-3.0）**：R4 三处标注（README、面板常驻条、RPC `source`
   字段），链接指向 Cherry HQ/cherry-studio，用户可溯源。

### 5.3 cordis 红线落实（AGENTS.md 沉淀，开发时逐条对照）

- 服务属性全部 `inject` 声明（host: `webServer`；client: `slots`, `sessions`），可选读
  一律 `ctx.get()`，无裸访问未注入服务。
- `ctx.logger` 等 callable 服务**闭包持 ctx、每次现取**（`ctx.logger.warn(...)`），
  禁止存局部变量跨异步回调（HTTP handler 内同样遵守）。
- 核心属性（on/emit/logger/base/get/has）可裸访问；`ctx.get('logger')` 返回 undefined
  的坑不复现。
- 所有 DOM 监听 / 订阅 / slot 注册进 `ctx.effect` dispose 链或 React cleanup。
- 三层测试防线：单测（五个纯 core）→ 契约验收 + 严格替身（模拟 cordis 访问约束：
  核心属性放行、服务属性抛错）→ 真实环境 e2e（headless profile 真加载 + 假接收端，
  改代码必跑）。

## 6. 成功标准映射（BRIEF §成功标准 → 本方案落点）

1. F1 行为 → R2/R5 + INTERFACE §2.1/2.2 单测 + e2e 手测清单。
2. F2 发现一致性与编辑保存 → instructions.ts 照 473-586 行逻辑 + R1 双闸门 + mtime 锁。
3. F3 780 条浏览/搜索/发送/复制 + 许可 → prompts-store + PromptsTab + R4。
4. 三层测试 → §5.3 + T11。
5. 安装/卸载干净 → inject 硬依赖语义（缺服务 pending 不崩）+ dispose 链全覆盖。

---

## 7. 新增「新建项目级 AGENTS.md」（增量功能）

来源：用户口头需求「指令面板应该可以新建 agents md（如果没有的话），现在没有项目级」。
只做**项目根（.git 标记处）的 `AGENTS.md`** 新建；全局 `~/.dsh/AGENTS.md` 与本地
`AGENTS.local.md` 的新建不在本次范围（用户未提，不扩范围）。接口契约见
`.devflow/INTERFACE.md §1.5` 与 §2.4 的 `projectRootFound` 增补。

### 7.1 形态（一句话）

复用现有 `/ct` RPC + `instructions.*` 家族，加一个 `/ct/instructions.create`（body 仅
`cwd`，目标路径 host 硬推导），client 在指令 tab 文件列表区顶部加一个「新建项目级
AGENTS.md」按钮；点击 → host 建 `<projectRoot>/AGENTS.md`（带中文模板，见 INTERFACE
§1.5）→ 成功重载列表并自动展开到 new 文件的编辑器。创建后文件即入发现集合，编辑保存
**直接复用已有的 `/ct/instructions.save`**，不在 create 上叠加新保存契约。

### 7.2 需求

1. 项目根存在 `.git` 标记（真项目根）且 `<projectRoot>/AGENTS.md` 不存在时，指令面板展示
   「新建项目级 AGENTS.md」入口。
2. 点击 → host 创建该文件（2 行中文模板），成功后面板重载列表并自动展开让用户直接编辑。
3. 已存在 / 无项目根 → 不显示入口（见 7.3 决策）。
4. 只做项目级 AGENTS.md；全局 / 本地新建超出范围。

### 7.3 UI 交互设计

- **入口位置**：指令 tab 文件列表区顶部工具栏（「重新加载」按钮旁），一个「新建项目级
  AGENTS.md」按钮。
- **显示/隐藏判定**（单一规则，读 list 响应）：
  显示 ⇔ `phase==='ready' && list.canCreateRootAgents === true`。该字段已由 host 用
  realpath + lstat 算好（`projectRootFound=true` 且 `realpath(projectRoot)/AGENTS.md`
  不存在，符号链接/目录占用视为已存在），覆盖"无项目根""根 AGENTS.md 已存在""根恰好是
  symlink"等全部情况，**client 只读这一字段、不重复推导**。全局文件、链上子目录的
  AGENTS.md 是否存在**不影响**本按钮（它们不是根目录的那个）。
- **cwd 无项目根（如 /tmp、无 `.git`）：`canCreateRootAgents=false` → 隐藏，不禁用。**
  理由：① 隐藏无需解释文案，不邀请用户在非项目目录（尤其系统目录）乱落盘；② 与现有
  「无当前会话目录/未发现指令文件」的 phase 样式一致（属于"这个能力此刻不适用"的静默态，
  而非"有但去不了"的报错态）。设计成禁用+tooltip 会引入一条几乎只在非 git 目录出现的
  解释路径，收益极低。
- **点击流程**：按钮置禁用 + 文案「创建中…」→ `ctInstructionsCreate(cwd)` → 成功：
  重载 list（await 完成后）再把 `expanded` 设为新 `path`（Editor 复用现有 read-on-mount
  读入，内容即模板，用户直接编辑 → 保存走 save）；失败：面板内提示 `{code}: {message}`。
- **创建不加确认对话框**：新建是增量、非破坏（不动既有文件），模板由 host 定、无外部
  依赖；与 save 的「会改变模型行为」确认是两回事（save 是覆盖写）。见 7.5 R-C 讨论。

### 7.4 host 端点设计

新端点 `/ct/instructions.create`（INTERFACE §1.5）。判定顺序：
cwd 校验(400 `invalid-cwd`) → 现场发现（复用 `discoverInstructions`）→
`projectRootFound===false` → 200 `no-project-root` → **目录链 realpath 防护**：对
`projectRoot` 做 realpathSync 解开任意 symlink 组件、对 `realRoot` 复核 `.git` 标记，
不符 → 200 `path-out-of-scope`（详见 INTERFACE §1.5 判定 4）→ **原子创建**
`writeFileSync(realRoot/AGENTS.md, 模板, { flag:'wx' })`：`EEXIST` → 200 `path-exists`，
其余 IO → 200 `system-error` → 成功 `{path, content, mtimeMs}`。
**不接收客户端路径**；body 仅 `cwd`，越权写入唯一来源已封死。
为支撑入口显示判定，`instructions.list` 响应新增 `projectRootFound: boolean` 与
`canCreateRootAgents: boolean`（均 additive，客户端忽略未知字段，不破坏既有契约）——
client 显示只读 `canCreateRootAgents`，不重复推导真实路径/存在性。

### 7.5 文件结构变更清单

| 文件 | 变更 |
|---|---|
| `src/instructions.ts` | `DiscoveryResult` 增 `projectRootFound` 与 `canCreateRootAgents`；`findProjectRootSync` 暴露是否命中 `.git` 标记（不破坏既有回退语义）；新增纯函数 `createProjectAgentsTemplate()` 返回模板字符串、`canCreateProjectRootAgents()`（realpath + 存在性计算显示信号）、`projectRootAgentsTarget()`（realpath 后落盘目标），均可单测 |
| `src/handler.ts` | `ENDPOINTS` 加 `/ct/instructions.create`；新增 `doCreate`，判定顺序 = INTERFACE §1.5：realpath 目录链防护 + **原子 `flag:'wx'` 创建**（`EEXIST`→`path-exists`，`EPERM`/`EROFS`→`system-error`） |
| `src/client/bridge.ts` | 新增 `ctInstructionsCreate(cwd)`（返 `CtResult`） |
| `src/client/InstructionsTab.tsx` | 工具栏新建按钮 + 可见性判定（**只读 `list.canCreateRootAgents`**）+ 点击流程 + 成功自动展开 |
| `tests/…` | 开发阶段补齐 create 正反用例（无项目根 / 根为 symlink / **根 AGENTS.md 为 symlink** / 已存在 / **并发两次 create** / 成功 / IO 失败）；`instructions.list` 断言 `projectRootFound`、`canCreateRootAgents` 两字段；`canCreateProjectRootAgents`/`projectRootAgentsTarget` 单测 |

### 7.6 任务拆解

| # | 任务 | 依赖 | 并行 |
|---|------|------|------|
| T-C1 | instructions.ts：`projectRootFound` + `canCreateRootAgents` + `createProjectAgentsTemplate()` + `canCreateProjectRootAgents()` + `projectRootAgentsTarget()` | — | — |
| T-C2 | handler.ts：`doCreate` + ENDPOINTS 注册 + **realpath 目录链防护** + **原子 `flag:'wx'` 创建** | T-C1 | — |
| T-C3 | bridge.ts：`ctInstructionsCreate` | — | 可与 T-C1/T-C2 并行 |
| T-C4 | InstructionsTab.tsx：按钮 + 可见性 + 点击流 + 自动展开 | T-C2 T-C3 | — |
| T-C5 | 测试 + 真实环境实测（headless / 本机 profile）| T-C2 T-C4 | — |

### 7.7 风险清单（rules.md 格式：非机械改动至少 1 失败模式 + 缓解）

| # | What/Where | 失败模式 | 缓解 |
|---|---|---|---|
| R-C1 | create 端点路径推导（host）——**高风险** | 若按客户端传的 path 创建 → 任意路径写文件（越界）；若 projectRoot 判定过宽 → 在 /tmp 等非项目目录落 AGENTS.md | **接口根本不接收 path**（body 仅 `cwd`），目标硬编码 `join(projectRoot,'AGENTS.md')`；projectRoot 复用 `discoverInstructions` 的真项目根信号（`projectRootFound`），无 `.git` 标记一律 200 `no-project-root`。比"收 path 再比对"（read/save 的白名单风格）更严 |
| R-C2 | 已存在 / 符号链接 / TOCTOU（host 创建）——**高风险** | 目标已存在仍覆盖用户现有 AGENTS.md；目标若是同名的项目外向符号链接，跟随链接写穿项目根；「探测未占用→写入」窗口期被外部/并发抢先创建或换成 symlink 仍覆盖/跟随写入 | **原子 `flag:'wx'`（O_CREAT\|O_EXCL）**写入：不存在才创建，`EEXIST`（含并发对方先建成、或目标是任何实体的符号链接被 name 占住）→ `path-exists`，无"先探测后写入"的非原子窗口，从机制上杜绝 TOCTOU。绝不覆盖、绝不跟随（writeFileSync 对已存在路径在 `wx` 下直接 EEXIST，根本不会写） |
| R-C3 | 按钮显示与磁盘真实状态不一致（client） | 列表时根 AGENTS.md 缺失显示按钮，点击瞬间文件已被外部创建 → 返回 `path-exists` 吓到用户；或根缺失却因链上同名 / **根恰好是 symlink（列表不列出→误显按钮）** 而显示误导 | 可见性**只读 list 响应的 `canCreateRootAgents`**（host 用 realpath + lstat 算好，symlink 建视为已存在故为 false，列表不列出但磁盘有 symlink 时也不会误显按钮），client 不重复推导；`path-exists` 失败后客户端重载 list（文件届时已在列表，进入正常展开/编辑），不重复报错 |
| R-C6 | 目录链 symlink 越界（host 创建 + 发现）——**高风险** | projectRoot 或其上级沿路径若含 symlink 组件，字符级 `path.resolve` 判定"在范围内"，但真实物理位置可能在项目外，模板被写到物理越界处，「写不出项目范围」承诺对目录链失效 | `projectRootAgentsTarget()` 写前对 `projectRoot` 做 `fs.realpathSync`，目标落在 `realpath(projectRoot)`（真实物理目录）内，并对 realRoot 复核 `.git` 标记（与发现对同一物理位置判定一致），不符 → 200 `path-out-of-scope`（INTERFACE §1.5 判定 4）。`canCreateRootAgents` 对显示端同样用 realpath，两端口径一致 |
| R-C4 | 成功后的自动展开被重载副作用清掉（client） | `loadList()` 会 `setExpanded(null)`，create 成功回调里先 await 重载再 setExpanded 的顺序写错 → 自动展开落空，用户看不到新文件 | 契约固定：create 成功 → `await loadList()` 完成 → `setExpanded(newPath)`；Editor 在列表重载后文件必在（3 已入发现集合），复用现有读入 |
| R-C5 | 权限 / git 跟踪 / 模板内容（host） | 创建的文件权限异常；模板误打误撞进系统目录；模板混入敏感信息 | `writeFileSync` 默认 mode 走进程 umask（常规 0644），普通文本文件；仅写 projectRoot 内（R-C1 担保）；模板为 2 行中文标题+注释、无任何用户/密钥内容，随代码版本可控；项目若为 git 仓，新 AGENTS.md 自动成为 untracked 待提交文件，随 git 版本控制 |

### 7.8 成功标准

1. git 项目根缺 AGENTS.md → 面板显示新建按钮；点击后文件创建、列表出现并自动展开、内容为模板、可直接编辑保存（save 复用）。
2. 根 AGENTS.md 已存在 → 无新建按钮。
3. 无项目根（如 /tmp）→ 无新建按钮（隐藏）。
4. 根 AGENTS.md 是符号链接 → 无新建按钮（`canCreateRootAgents=false`），不误导。
5. 并发两次 create 同一 cwd → 恰好一个 `ok:true`、一个 `path-exists`，无覆盖。
6. `no-project-root` / `path-exists` / `path-out-of-scope` / `system-error` 四种失败场景反馈明确、不静默。

---

## 8. 增量 2：全局新建 + 删除 + 返回流程 + 拖拽修复

来源：用户实测后的增量需求（原文整理）——① 全局 `~/.dsh/AGENTS.md` 缺失时也要能新建；
② 已存在/新建的指令文件（全局/项目级）可删除（破坏性，必须确认）；③ 新建保存完能回到
初始面板（返回流程）；④ 修面板 header 拖拽手柄吞 tab 点击的 Bug。
接口契约见 `.devflow/INTERFACE.md §1.1`（`canCreateGlobalAgents`）、`§1.5`（scope 扩展）、
`§1.6`（delete）、`§2.4`（新增 helper）、`§3`（拖拽修复条目，纯 client）。

### 8.1 需求

1. **全局新建**：`~/.dsh/AGENTS.md` 不存在（`canCreateGlobalAgents=true`）时，指令 tab 显示
   「新建全局 AGENTS.md」入口；点击 → host 创建 `<realpath(dshHome)>/AGENTS.md`（同模板），
   成功进入新文件编辑态。
2. **删除**：指令 tab 每行文件（全局/项目级）提供删除，走新端点 `/ct/instructions.delete`；
   client 强制确认（window.confirm，全局文件明示影响 DSH 行为）。
3. **返回流程**：InstructionsTab 引入显式状态机（列表态 / 新文件编辑态 / 已有文件编辑态），
   编辑态提供「保存」与「返回列表」两个出口；保存成功回到列表初始态。
4. **拖拽 Bug 修复**：startDrag 排除 button/a 等交互目标 + 拖拽结束固化 left/top 到 state。
5. 明确不做：不加重命名、不加重置默认模板、不做批量新建/删除、本地（AGENTS.local.md/
   CLAUDE.local.md）不提供新建（只保留现有可编辑；delete 天然支持因为走发现集合白名单）。

### 8.2 UI 交互设计

**状态机（InstructionsTab 核心改动，纯 reducer 契约见 INTERFACE §2.6）**
- 用 `InstructionView = 'list' | { kind:'create', scope:'project'|'global' } | { kind:'edit', path }`
  替代现在的 `phase + expanded` 组合。**状态迁移逻辑抽为纯函数 `instructionViewReducer`**
  （`src/client/instruction-view.ts`，无 DOM/React 依赖，node 单测直接驱动，INTERFACE §2.6）——
  组件只负责「把事件喂给 reducer、把结果渲染」，状态迁移正确性由单测保证：
  - `'list'`：初始态。显示文件列表 + 「重新加载」+ 两个新建入口（按 §1.1 两字段显隐）。
  - `{ kind:'create', scope }`：新建态。点「新建…」进入，按钮置禁用（创建中）；create
    成功 → 保持此态并自动载入新文件编辑器（内容=create 响应的模板，按 scope 取项目模板或
    全局模板，§1.5）；编辑器顶部两个出口：**「保存」**（走 save）与**「返回列表」**。
  - `{ kind:'edit', path }`：已有文件编辑态（点开列表中的文件进入，等价于现在 `expanded`）。
    编辑器同样提供「返回列表」。

**新建入口显隐（两独立规则，互不干扰）**
| 入口 | 显示条件（读 list 响应） | 点击调用 |
|---|---|---|
| 新建项目级 AGENTS.md | `canCreateRootAgents === true` | `ctInstructionsCreate(cwd, 'project')` |
| 新建全局 AGENTS.md | `canCreateGlobalAgents === true` | `ctInstructionsCreate(cwd, 'global')` |

- 全部隐藏/显示由 host 计算字段决定，client 不重复推导（§1.1 契约）。两入口可同时显示
  （全局缺 + 项目根缺）；也可都不显示。
- **全局新建（scope='global'）点击后先 `window.confirm`**：文案明示「将创建全局指令文件，
  该指令对**所有会话**生效」——全局指令影响所有会话，可逆性弱于项目级，确认强度与删除
  对齐（审查建议）；项目级新建不加确认（§7 决策）。

**新建 → 编辑 → 保存 → 返回（用户要的闭环，事件名见 INTERFACE §2.6）**
1. 点「新建全局/项目级」→ reducer `start-create` → `{kind:'create', scope, pending:true}`，
   按钮「创建中…」→ `ctInstructionsCreate`（scope='global' 先过 §8.2 确认）。
2. 成功：reducer `create-succeeded(path)` → 停留 `{kind:'create', path}` 并载入编辑器
   （草稿=create 响应的模板，按 scope 取对应模板）。
3. 用户编辑（草稿变更 → `mark-dirty`）→ 点「保存」→ `ctInstructionsSave(cwd, path,
   content, create 返回的 mtimeMs)`（mtime-conflict / file-truncated 处理沿用 §7 已有逻辑）。
4. 保存成功 → reducer `saved(path)` → **回到 `'list'`**（重载列表）——即用户要的
   "新建保存完之后回到初始面板"。
5. 中途点「返回列表」→ reducer `cancel-edit`：若草稿未保存（dirty 或 create 已成功未保存）
   → confirm「放弃未保存的修改？」（确认后回列表，文件保留）；无未保存内容 → 直接回列表。

**删除交互**
- 每行文件右侧「删除」按钮 → `window.confirm`：
  - 项目级/local：「删除该指令文件？此操作不可恢复。」
  - 全局：「删除全局指令文件？将移除 DSH 加载的全局指令，影响模型行为。此操作不可恢复。」
- 确认 → `ctInstructionsDelete(cwd, path)` → 成功重载 list；失败面板内提示 `{code}: {message}`。

### 8.3 host 端点设计（增量）

1. **create 扩展（§1.5）**：复用现有端点，body 增加可选 `scope:'project'|'global'`
   （缺省 `'project'`，向后兼容 §7）。判定顺序：cwd → `invalid-scope`(400) → scope 分支
   （project 需 `projectRootFound`；global 无前置）→ realpath 目录链防护（**project 分支
   realpathSync 抛错 → `system-error`；global 同样**；project 仅以 realRoot 复核 `.git`
   标记为准，不要求字符级路径与 realpath 相等，不误杀 symlink 访问的合法项目）→
   原子 `wx` 创建（`path-exists`，文案按 scope 区分 project-level/global-level）→ 成功
   `{path, content, mtimeMs}`（`content` 为按 scope 选择的模板：project 用项目模板、
   global 用全局模板，§1.5）。**不接收客户端路径**（body 仍只有 cwd+scope）。
2. **delete（§1.6）**：新端点 `/ct/instructions.delete`，body `{cwd, path}`，与 read/save
   同款白名单校验风格（发现集合成员）；判定顺序：cwd → path 校验(400) → 发现集合范围
   (`path-out-of-scope`) → **父目录链 realpath 包含性校验**（对 `dirname(path)` realpath，
   按文件 level 校验落在 `realpath(dshHome)` 或 `realpath(projectRoot)` 前缀内，防目录链
   symlink 物理越界；realpath 抛错 → `system-error`）→ lstat 复核（`file-not-found` /
   symlink→`path-out-of-scope`）→ unlink → 成功 `{ok:true}`。删除全局文件 = 移除 DSH 实际
   加载的指令，client 确认已覆盖。
3. **list 扩展（§1.1）**：响应新增 `canCreateGlobalAgents: boolean`（additive）。

### 8.4 文件结构变更清单

| 文件 | 变更 |
|---|---|
| `src/instructions.ts` | `DiscoveryResult` 增 `canCreateGlobalAgents`；新增 `canCreateGlobalAgents(dshHome)`、`dshHomeAgentsTarget(dshHome)` 纯函数（§2.4）；模板函数按 scope 返回（project 模板 / global 模板，§1.5） |
| `src/handler.ts` | `ENDPOINTS` 加 `/ct/instructions.delete`；`doCreate` 扩 scope 分支（`invalid-scope`、project/global realpath 抛错均 → `system-error`、path-exists 文案按 scope）；新增 `doDelete`（§1.6 判定顺序，含父目录 realpath 包含性校验） |
| `src/client/bridge.ts` | `ctInstructionsCreate(cwd, scope?)` 加 scope 参数；新增 `ctInstructionsDelete(cwd, path)` |
| `src/client/instruction-view.ts` | **新增（建议 C）**：`instructionViewReducer` 纯函数（INTERFACE §2.6，无 DOM 依赖，node 单测驱动） |
| `src/client/InstructionsTab.tsx` | 状态机（对接 reducer：事件→reducer→渲染）+ 两个新建入口 + 全局新建确认 + 每行删除按钮/确认 + 保存/返回出口 |
| `src/client/Panel.tsx`（或 header 所在组件） | 拖拽修复：startDrag 排除交互目标 + left/top 状态固化（§8.6） |
| `tests/…` | create scope 正反用例（global 成功 / global 已存在 / invalid-scope / project|global realpath 失败）；delete 全判定顺序正反用例（不存在 / 越界 / **父目录 symlink 越界** / symlink / **并发双删一 ok 一 file-not-found** / 成功）；**`instructionViewReducer` 全事件单测**；list 断言 `canCreateGlobalAgents` |

### 8.5 任务拆解

| # | 任务 | 依赖 | 并行 |
|---|------|------|------|
| T-E1 | instructions.ts：`canCreateGlobalAgents` + `dshHomeAgentsTarget` + 模板按 scope | — | — |
| T-E2 | handler.ts：`doCreate` scope 分支（invalid-scope + project/global realpath → system-error）+ `doDelete`（父目录 realpath 校验）+ ENDPOINTS | T-E1 | — |
| T-E3 | bridge.ts：create 加 scope；新增 `ctInstructionsDelete` | — | 可与 T-E1/T-E2 并行 |
| T-E4 | instruction-view.ts：`instructionViewReducer` 纯函数（建议 C，先于 T-E5 可独立完成并单测） | — | 可与 T-E1/T-E2 并行 |
| T-E5 | InstructionsTab：对接 reducer + 两新建入口 + 全局新建确认 + 删除按钮/确认 + 保存/返回出口 | T-E2 T-E3 T-E4 | — |
| T-E6 | 拖拽修复（Panel header） | — | 可与 T-E5 并行 |
| T-E7 | 测试 + 真实环境实测（headless / 本机 profile）：含 reducer 单测、并发双删、父目录 symlink 越界用例 | T-E2 T-E3 T-E4 T-E5 T-E6 | — |

### 8.6 拖拽 Bug 修复设计（纯 client）

**根因**：面板 header 整行挂 `onMouseDown=startDrag`，tab 按钮（指令/提示词）在 header 内；
点击 tab 的 mousedown 冒泡到 header → `startDrag` 把面板从 CSS 右下定位（`insetInlineEnd`/
`bottom`）切到 `left/top` 定位并记 dragCtx；`mouseup` 后 dragCtx 清空，但 `left/top` 从未
固化 → 定位回退为 undefined 的同时 `insetInlineEnd` 已是 auto → 面板塌陷视觉消失。

**修复（两处，缺一不可）**：
1. **startDrag 前置排除**：`const el = e.target as HTMLElement; if (el.closest('button, a,
   input, textarea, [data-stop-drag]')) return;` —— tab/关闭按钮等交互元素上的 mousedown
   不启动拖动；拖拽只从 header 空白区发起。交互元素加 `data-stop-drag` 作为显式逃生口。
2. **拖拽结束固化定位**：把「当前 left/top」提升为 React state（如 `dragPos: {left, top} |
   null`）；`mousemove` 期间更新 state（或临时 ref），`mouseup`/`mouseleave` 时**把最终
   left/top commit 进 state** 且同时置 `insetInlineEnd:'auto'`，然后才清 dragCtx。面板样式
   从 `dragPos` state 派生——即使 dragCtx 清空，left/top 仍是 state 里的确定值，不会塌陷。

**验证**：面板默认不拖动 → 样式仍走 CSS 右下定位；拖动过一次 → left/top 固化、可继续拖；
点击 tab 不触发拖动、面板位置不变。回归点：现有点击 tab 切换、关闭面板、拖动均正常。

**对 INTERFACE 的影响**：无——纯 client DOM 交互修复，不涉及任何 /ct 端点、不改变响应
schema（已在 INTERFACE §3 注明）。

### 8.7 风险清单（rules.md 格式）

| # | What/Where | 失败模式 | 缓解 |
|---|---|---|---|
| R-E1 | create scope 扩展（host）——**高风险** | 误把全局目标解析到客户端可控位置；`scope` 值混乱导致目标推导错 scope；project/global realpath 失败未归类 | 目标仍全由 host 推导（`dshHomeAgentsTarget` = realpath(dshHome)+AGENTS.md；project 同款 realpath），body 只有 cwd+scope，无 path；`invalid-scope`(400) 卡死非法值；**project 分支 realpathSync 抛错与 global 一样 → `system-error`**（§1.5 判定 5），不发明新错误码 |
| R-E2 | delete 越界/误删（host）——**高风险** | 客户端传任意 path 把项目外/系统文件删掉；symlink 被跟随删除；**父目录链含 symlink 时字符级通过但物理删除范围外文件** | delete 走三闸门：basename 白名单(400) + 发现集合成员比对(`path-out-of-scope`) + **父目录 realpath 包含性校验**（按文件 level 验 `realpath(dirname(path))` ∈ `realpath(dshHome)` / `realpath(projectRoot)` 前缀；realpath 抛错 → `system-error`，§1.6 判定 5）；写前 lstat 复核防 TOCTOU（§1.6 判定 6） |
| R-E3 | 删除全局文件影响 DSH 行为（product 风险） | 用户误删全局 AGENTS.md，DSH 全局指令消失，模型行为变化 | client 强制确认（window.confirm 明示"移除 DSH 加载的全局指令、影响模型行为、不可恢复"）；方案层明确这是用户主动行为（§8.2）。不做回收站（范围外，不过度设计） |
| R-E4 | 状态机回归（client）——**高风险** | 「返回列表」与「保存」出口顺序写错导致保存后仍停编辑态；create 成功但未保存返回时草稿丢失误导 | **状态迁移抽纯 reducer（建议 C，INTERFACE §2.6）**，全事件正反例单测兜底（start-create/create-succeeded/saved/cancel-edit/dirty 边界）；保存成功 → `saved` → `'list'`+重载；未保存返回 → 调用层先确认再 `cancel-edit` |
| R-E5 | 拖拽修复不彻底（client） | 只排除 button 没排除 a/输入框/其他交互元素；或 left/top 未固化仍塌陷 | 双改齐上：closest 白名单（button,a,input,textarea,data-stop-drag）+ dragPos 状态固化 + `insetInlineEnd:auto` 显式；e2e/手测覆盖"点 tab 位置不变、拖一次后不塌陷"（§8.6） |
| R-E6 | 全局与项目级入口混淆（client） | 两入口按钮文案/行为混淆，点错 scope | 文案明确「新建全局 AGENTS.md」vs「新建项目级 AGENTS.md」；显隐各自只看自己的 canCreate 字段；create 响应 `path` 用于后续 save 基线，与 scope 无关 |
| R-E7 | 模板按 scope 分发（host，审查重要④）——**中风险** | 把项目模板写进全局文件（或反之），语义错配、内容误导 | 模板函数按 scope 返回单一来源（project 模板 / global 模板，§1.5 契约）；单测断言两个 scope 的 `content` 分别等于对应模板；响应 `content` 恒为实际写入的模板 |

### 8.8 成功标准

1. `~/.dsh/AGENTS.md` 缺失 → 显示「新建全局 AGENTS.md」；点击经确认 → 创建成功（内容是**全局模板**而非项目模板）、进入编辑态、保存后回到列表初始态（文件在列表、可再展开）。
2. 全局文件已存在 → 无全局新建入口；项目级入口逻辑同 §7.8 不变（两入口独立）。
3. 行内删除：确认后文件消失；全局删除确认文案含"影响模型行为"；`file-not-found`/`path-out-of-scope`/`system-error` 失败反馈明确、不静默。
4. 新建→编辑→保存→返回闭环一次走通；「返回列表」在编辑态可用且在未保存时给出明确提示。
5. 拖拽后面板不塌陷；点击 tab 不触发拖动、面板位置不变。
6. create 新 scope 与 delete 全判定顺序测试绿（含**并发双删一 ok 一 file-not-found**、**父目录 symlink 越界**用例）；`instructionViewReducer` 全事件单测绿；list 响应含 `canCreateGlobalAgents`。

### 8.9 其他建议项处理

| 审查建议 | 处理 | 落点 |
|---|---|---|
| dshHome 目录缺失边界 | **已覆盖**：global create 的 realpath 失败 → `system-error`（§1.5 判定 5）；`canCreateGlobalAgents` 在 dshHome realpath 失败 → false（§2.4）。不另加错误码 | §1.5 / §2.4 |
| 拖拽视口 clamp | **不采纳**：面板拖出视口是用户主动行为，可拖回；clamp 增加定位耦合与测试面，非本次 bug 核心。若后续用户反馈"面板拖不回来"再加 | §8.6 不变 |
| 编辑态未保存返回提示 | **已覆盖**：§8.2 闭环步骤 5 + reducer `cancel-edit` 语义（dirty 或 create 未保存 → confirm） | §2.6 / §8.2 |
