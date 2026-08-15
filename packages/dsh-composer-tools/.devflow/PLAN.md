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

### 1.3 client 半（React）

**inject：`['slots', 'sessions']`**（sessions 用于拿 current sessionId 与 cwd）。

1. **入口按钮 + 面板挂载**：`ctx.slots.inject('conversation.input.right', cb)` 注册
   list entry（带唯一 id `dsh-composer-tools`）。用 `slots.inject` 而非直接 `register`：
   slot 声明由 conversation 插件完成、加载顺序不保证，`inject` 等声明出现再跑
   （RESEARCH Q1 推荐路径 + `dsh-client-runtime/lib/client.js:55`）。**面板本体直接
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
