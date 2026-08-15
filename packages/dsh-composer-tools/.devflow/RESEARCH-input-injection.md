# 调研报告：dsh web composer 输入注入与面板挂载

调研对象：dsh-composer-tools 插件（方向键翻输入历史 + 指令查看面板 + 提示词库面板）。
所有结论均有本机代码或官方文档依据。代码路径中的 `DSH` 指
`/Users/wsxwj/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/`。
运行环境：React / react-dom 18.3.1（`DSH../react-dom/package.json` 的 `"version": "18.3.1"`）。

---

## Q1：插件如何拦截 ArrowUp/Down 并改写受控 textarea 的值

**结论（一句话）**：推荐「capture 阶段原生 keydown 监听负责拦截 + slot 注入拿到的官方 `inputActions.setDraft()` 负责改写」的组合；不需要碰 React 受控组件模拟输入的技巧。

### a) capture listener + 原生 value setter + dispatchEvent('input')

- 拦截侧成立。React 18 把所有事件监听挂在 **root 容器**上而非 document：
  `react-dom/cjs/react-dom.development.js:9132` `listenToAllSupportedEvents(rootContainerElement)`，
  由 `29425`（createRoot 路径）调用。因此 `document.addEventListener('keydown', fn, true)`（capture）
  先于 React root 上的监听器触发，`e.preventDefault() + e.stopPropagation()` 可让 InputBar 的
  `onKeyDown`（`dsh-client-ui-conversation/lib/client.js:3457`）完全收不到该事件。
- 改写侧也成立但属黑魔法。react-dom 18.3.1 内置 inputValueTracking：
  `react-dom/cjs/react-dom.development.js:1698` `updateValueIfChanged(node)`。
  用原生 `HTMLTextAreaElement.prototype.value` setter 绕过 tracker 后 dispatch
  `new Event('input', {bubbles: true})`，React 会因 tracker 值与 DOM 值不一致而触发 onChange。
  这是社区通用技巧（react 测试工具同款思路），在 18.3.1 上机制仍在。
- 但 DSH 的 onChange 不只是 setDraft：`client.js:3505-3511` 里还有
  `keyboard.setDraft(next)` + `keyboard.track(next, selectionStart)`（触发 slash/@ 候选检测）。
  模拟 input 事件能让 onChange 跑，但 caret 需要自行恢复（InputBar 的 `restoreCaret`，3434 行，
  走 rAF + setSelectionRange）。**DSH 自身代码里没有 setNativeValue 之类的现成封装**
  （全仓 grep `setNativeValue|inputValueTracking` 无业务代码命中，只有 react-dom 内部）。
- 坑：若插件无差别拦截方向键，会废掉命令菜单的上下导航——InputBar 对 ArrowUp/Down 的处理是
  `keyboard.arbitrate()`（`client.js:3468-3471`），菜单打开时 input-trigger 的
  `arbitrate()` 返回 `"consumed"`（`dsh-client-ui-input-trigger/lib/client.js:356-372`，
  菜单关闭/IME 组合中返回 `"pass"`，此时 InputBar 不 preventDefault，方向键自由移动光标）。
  插件拦截前必须自行判断菜单是否打开（可用 textarea 的 `data-phase` 属性或命令菜单 DOM 状态旁证），
  或只在「光标在首行/末行」等条件下接管。

### b) 官方口子：有，且够用

- `ctx.get('conversation.input')` **拿不到东西**：全仓 grep `"conversation.input"` 作为服务名
  零命中；`InputHub`（`client.js:1334`）是 conversation 插件 `apply()` 内的模块局部变量
  （`client.js:9502` `const inputHub = new InputHub(ctx, t)`），只通过闭包喂给自己注册的 entry，
  从未 `ctx.provide` 成 cordis 服务。`keyboard(id)` 的注释也明说
  "package-internal, never across a plugin boundary"（`client.js:1412-1418`；
  类型侧 `types/client/input/contract.d.ts:84-88`）。
- 但 **provide channel 给了公开面**：`client.js:9504-9514` conversation 插件调
  `sessions.provide({ hooks: ["input"], props: ["inputActions"], ... })`，runtime 的契约写明
  「every session-scope slot component receives the contributed members as standard props」
  （`dsh-client-runtime/lib/types/client/sessions/service.d.ts:197-201`）。
  即插件往 session 级 slot（`conversation.input.left/right/dock/overlay`，均为 list/session 级，
  声明见 `client.js:9535-9554`）注册的组件，会收到 `useInput`（selector hook）和
  `inputActions` 两个 prop。`InputActions` 公开面含 `setDraft(text)` / `submit()` 等
  （`types/client/input/contract.d.ts:65-76`，注释明确 "Single public draft write path"）。
- `inputActions.setDraft` 走的是机器单写路径（diff scan 协调 occurrence，
  `facade.d.ts:60-66`），与键盘 onChange 殊途同归，**不需要模拟 DOM 事件**。
  缺的能力只有 `track()`（slash 候选热检测）——历史回填后用户再敲任意键即恢复检测，影响可忽略。

### c) 替换 conversation.composer.bar：技术上能 shadow，工程上等于重写输入框

- 该 slot 是 **single** 类型、session-maybe 作用域（`client.js:9531-9534`）。
  single slot 同 priority 重复注册直接 throw（`dsh-client-ui-slots/lib/index.js:71-74`），
  不同 priority 则「lowest renders」（`index.js:69` 错误提示原文 +
  `entriesOfSlot` 取每 cell 最小 priority，`index.js:179-194`）。DSH 自带 InputBar entry
  注册时不带 priority（`client.js:9624` 起，无 priority 字段），即 priority 0——
  插件须以 **priority < 0** 注册才能 shadow。
- 替换代价：InputBar 的 `keyboard` face 来自该 entry 自己的 inject（`client.js:9637-9657`，
  闭包抓模块局部 inputHub），插件 entry 拿不到；undo/redo、paste 组件化、图片拖放/粘贴、
  命令菜单、计划/模型选择子 slot（`conversation.input.plan/model`，由 InputBar entry 的
  children 声明，`client.js:9627-9636`；插件 entry 无权 renderSlot 别人的 children，
  见 `SlotOwnershipError`，`dsh-client-ui-slots/lib/index.js:8-9`）全部丢失。
  替换 = 重实现整条输入链路，仅为加方向键历史完全不值。

### 推荐路径

1. `ctx.slots.inject("conversation.input.right", () => ctx.slots.register({...}, Panel))`
   挂面板入口按钮（用 `inject` 而非直接 `register`，因为 slot 声明由 conversation 插件的 entry
   完成，加载顺序不保证——`inject` 会等声明出现再跑回调，见
   `dsh-client-runtime/lib/client.js:55` 起的实现与 `types/client/slots.d.ts:90` 文档；
   官方插件自身也这么用：`client.js:6306`）。
2. 该组件凭 props 拿到 `useInput` / `inputActions`；组件内挂
   `document` 级 capture keydown：目标是本 composer 的 textarea
   （DOM 定位锚点：textarea 带 `data-phase` 属性，容器有 `data-input-scroll` /
   `data-input-backdrop` / `data-input-mirror`，`client.js:3781/3788/3800`），
   命中 ArrowUp/Down 且判定菜单未开时 `preventDefault + stopPropagation`，然后
   `inputActions.setDraft(historyText)` 回填，再对聚焦 textarea `setSelectionRange` 移光标到行尾。

**风险**：① capture 拦截与命令菜单/IME 的仲裁逻辑并行存在，条件判断错了会破坏原生行为；
② `inputActions` 属 standard props，未在官方 changelog 里承诺稳定，升级需回归验证；
③ session 切换时 slot 组件随 scope 重挂，监听器必须在 dispose 里摘（`ctx.effect` 模式，
参考 dsh-session-manager `src/client/index.tsx:203-215`）。

---

## Q2：输入历史怎么采集"发送了"

**结论**：不可靠——「draft 从非空变空」会误录；可靠信号是 **InputState 的 phase 机**
（plain → adjudicating/submitting 时 draft 未清，此刻抓文本）+ 会话快照里新增
`kind:'user'` 节点做二次确认。

依据（发送链路，`dsh-client-ui-conversation/lib/client.js`）：

- 发送 = `keyboard.submit()`（InputBar Enter 分支 3503）→ 机器 enter →
  `defaultSink` → `InputHub.sink()`（1438-1451）：先 `shell.commitSend(imageIds)`
  （1441）把 draft 作为"已发送"清空（`commitSend` 982-986，dispatch `send-committed`，
  撤销历史被切断——Ctrl+Z 无法复活已发内容，facade.d.ts:81-87），再
  `conversation.sendSession()`（130-140）→ `session.prompt()`；失败则恢复 draft（1445）。
- 「非空→空」的误录源（都会清空 draft 但不是发送）：
  - 用户手动 Ctrl+A + Delete / 退格清空；
  - undo 到空草稿；
  - slash token 消费成功：`consumeToken` 的 bare-token 分支 `this.setDraft("")`（1140 行）；
  - 工作区切换时草稿迁移：`from.setDraft("")`（9576 行）；
  - 发送失败后的各种 restore 组合。
- 更可靠的 client 侧信号：
  1. **phase 机**：`InputState.phase` ∈ `plain|adjudicating|claimed|submitting`
     （`contract.d.ts:196`）。进入 adjudicating/submitting 时 draft 仍是原文
     （`submit()` 1022-1036 不清 draft），此刻 `useInput(s => s)` 订阅即可抓到待发文本；
     commitSend 随后清空即确认。发送失败会 restore draft（1445），可据此把误录条目剔除或容忍。
  2. **会话消息流**：`SessionFace = ISession & ObservableSnapshot<ConversationSnapshot>`
     （`dsh-client-runtime/lib/types/client/contract/session.d.ts` 末尾），
     `ConversationSnapshot.nodes` 含 `UserMessageNode`（`kind: 'user'`，
     `sessions/conversation.d.ts:61-62,260`）。插件 host 无关地经
     `ctx.sessions.binding(id).session` 订阅（`service.d.ts:341` binding(id)），
     新 user 节点出现 = 发送已被 host 受理。`snapshot.blank` 也在首个 accepted prompt 时翻 false
     （conversation.d.ts 对 blank 的注释）。注意节点里的文本是序列化后的 model 形态
     （chip 占位符已展开，见 facade.d.ts:203-208 sinkSerialized），要"用户原样输入"
     还得靠 phase 机抓的 draft。
  3. DOM 兜底：textarea 的 `data-phase` 属性实时反映 phase（`client.js:3800`），
     MutationObserver 也能看，但属间接信号，不推荐当主链路。

**坑**：submit 失败（promptError）时 draft 恢复——只按 phase 录入会产生一条"没发出去的历史"，
去重策略要考虑；`queue`/`steer` 模式（ accelerated Enter、`canSteerQueue` 3390）同样走
commitSend，phase 机覆盖得到。

---

## Q3：指令查看面板的数据来源

**结论**：host 端可以直接 `import { discoverBaselineInstructionFiles }`（或
`loadBaselineInstructions`）复用官方包，但它是纯函数、约 60 行逻辑，**自实现更稳**；
会话级"当前生效指令"没有对外查询口子，只做全局+项目两级。

依据（`dsh-agent-instructions`）：

- 包导出（`lib/index.js:1311` + `lib/types/index.d.ts:14-18`）：
  `Config`、`apply`、`discoverBaselineInstructionFiles`、`loadBaselineInstructions`、
  `name`、`renderWorkspaceContext`，及类型 `InstructionFile/LoadedInstructionFile`。
  `package.json`：`"type": "module"`，`main: lib/index.js`，`exports["."]` 指向同文件，
  license MIT。
- 发现逻辑：`discoverBaselineInstructionFiles(options)`（581-586）=
  `discoverInstructionFiles`（545-573）的路径瘦身版，覆盖：
  - 用户全局 `{dshHome}/AGENTS.md`（`USER_GLOBAL_FILE = "AGENTS.md"`，140 行；554-563）；
  - `findProjectRoot(cwd, markers)`（473-481，默认 marker 只有 `.git`，14 行），
    无 marker 时回退 cwd 本身；
  - `ancestorChain(projectRoot, cwd)`（488-501）每层目录查
    `AGENTS.md/CLAUDE.md` + `AGENTS.local.md/CLAUDE.local.md`
    （默认候选 15-16 行）。
  - 输入：`{ cwd, dshHome?, projectRoot?, signal?, 各候选数组? }`；`dshHome` 经
    `resolveDshHome`（来自 `@deepseek-ai/dsh-home-paths`）规范化（66-72）。
    `fileSystem` 参数可选，缺省走 node fs（`createReadStream`/`stat`，598 + 顶部 import）。
- 复用 vs 自实现的权衡：该包 import 链带 `@deepseek-ai/dsh-llm`、`dsh-home-paths`、
  `schemastery` 等 value import。按本机已知坑（profile 下 pnpm install 会把
  `@deepseek-ai/*` 物理复制成第二份导致 Symbol 分裂），把官方包列进插件依赖有分裂风险；
  而发现逻辑本身是纯路径+stat，无 cordis 依赖，**照 473-586 行自实现约 60 行即可，
  零依赖风险**。若坚持复用，须验证插件解析到的是主程序树的同一份文件。
- 会话级口子：**没有**。`reconcileInstructionContext`（896 行）不在包导出列表里
  （1311 行只导出上述 6 个），其产物作为 `source.kind='agent-instructions'` 的
  user/message 写进 agent 会话事件流（1170-1200 行）；RPC 层 grep `instruction`
  在 `dsh-api-remotes` 零命中——host/web 都没有"当前会话生效指令摘要"的查询端点。
  要做只能读会话事件流反推，成本高且不稳定，**建议不做**。

**坑**：① `.local.md` 候选与常规候选同层并列，展示时要标注来源层（全局/项目/local）；
② 文件内容读取有 `maxSourceBytes` 上限（默认 1MB，17 行），面板展示大文件要自行截断；
③ 文件可能随会话进行被编辑，面板要么打开时现读、要么轮询，不要缓存一次了事。

---

## Q4：提示词库数据（780 条 Cherry Studio 预设）

**结论**：**有许可风险，不建议原样打包进 MIT 插件**；claude gui 代码注释里写的"MIT"是错的
——Cherry Studio 当前主分支是 AGPL-3.0，历史上是 Apache-2.0+附加商用条款，从来不是 MIT。
若要用，须标注来源并接受 copyleft/附加条款风险；更稳的做法是作为可选外部数据或换数据源。

### 数据结构（实测 `/Users/wsxwj/Desktop/claude/claude gui/server/data/prompt-templates.json`）

- 1,641,806 字节（约 1.6MB），**780 条**，每条字段齐全：
  `id`(uuid) / `name` / `description` / `prompt` / `emoji` / `group`（数组）——780/780 全有。
- `group` 共 33 个分类（按数量：工具 283、教育 274、职业 273、创意 166、商业 162、写作 121…，
  一条可属多组；claude gui 前端按 `group[0]` 归类避免重复，
  `client/src/components/MemoryPanel.jsx:300-310`）。
- 文件首尾无许可头/版权注释。

### 许可线索

- claude gui 仓库内仅有的来源说明是代码注释：
  `server/routes/prompt-templates.js:7-9`「引入 Cherry Studio 开源的 780 条中文助手预设
  (MIT, resources/data/agents-zh.json)」；`MemoryPanel.jsx:282` 同述。仓库自身 LICENSE 是
  MIT（copyright wsxwj）——但那是 claude gui 项目的许可，**不能传导给第三方数据**。
- 上游实情（在线核实）：
  - `https://raw.githubusercontent.com/CherryHQ/cherry-studio/main/LICENSE` =
    **GNU AGPL v3** 全文；
  - `resources/data/agents-zh.json` 在主分支存在（HTTP 200），即数据文件在 AGPL 仓库内；
  - 历史版本（v0.9.10）LICENSE 是「Apache-2.0 + 附加条款」（商用授权、贡献者协议等，
    见 raw.githubusercontent.com/CherryHQ/cherry-studio/v0.9.10/LICENSE），也不是 MIT。
- 结论：标注"MIT"无依据。把 780 条 prompt 文本打包进 MIT 许可的开源插件，存在被认定为
  AGPL 素材再分发的风险。**需要标注来源（最低限度）+ 风险提示；合规优先则换数据或做可选下载**。

### 1.6MB JSON 怎么进插件

- client 端直接打包：session-manager 的 client 构建是 tsdown 单文件 CJS bundle
  （`dsh-session-manager/tsdown.config.mjs`：`noExternal` 内联一切非平台模块，
  自定义 CSS 插件处理 .css，**没有任何 assets/JSON loader 配置**，但 rolldown 原生支持
  JSON import，会内联成 JS 字符串）。后果：client.js 体积 +1.6MB（转义后更多），
  每次 web 加载/刷新都全量下载+解析，而提示词面板是低频功能——**不划算**。
- host 端下发（推荐）：claude gui 自己就是这么做的——
  `server/routes/prompt-templates.js:11-27` 读文件、进程内缓存一次、HTTP 端点下发。
  dsh 插件有同构机制：host 半经 `webServer.register(route)` 挂原始 HTTP 路由
  （session-manager `src/index.ts:236-325` 挂 `/sm/*`，client 半
  `src/client/bridge.ts` 同源 fetch）。面板首次打开时 fetch 一次即可，
  JSON 放插件包的 data 目录（host 侧 `readFile`），不进 client bundle。
- 对比：client 内联 = 零运行时 IO 但每次页面加载都付费；host 下发 = 按需加载、
  可流式/可分片、还能做"用户自定义提示词"的写回。**选 host 下发**。

**坑**：① host 路由要过 loopback trust fence（session-manager 的做法，见
`src/index.ts` 注释与 trust-fence.ts），别做成裸开端点；② 数据含 `\r\n` 换行，
前端展示/回填前统一 `\n`；③ 若最终决定不打包该数据，面板要留"导入自定义 JSON"的空态。

---

## Q5：剪贴板写入

**结论**：dsh web 跑在 `http://127.0.0.1:3080`（localhost = secure context），
`navigator.clipboard.writeText` 可用；且有官方现成封装
**`writeClipboard`**（`@deepseek-ai/dsh-client-ui-primitives` 导出），自带
execCommand fallback，直接当平台 external import 即可，不用抄 claude gui。

依据：

- `dsh-client-ui-primitives/lib/index.js:1747-1778` `writeClipboard(text)`：
  先 `navigator.clipboard.writeText`，失败/不存在则建隐藏 textarea +
  `document.execCommand('copy')`；导出列表见 5855 行末尾（`writeClipboard` 在列）。
  该包已在 session-manager 的 `CLIENT_EXTERNALS`（`tsdown.config.mjs`）里，
  属"平台模块"，插件 client bundle 可直接 external 引用，不触发 purity gate。
- claude gui 的 `client/src/utils/clipboard.js` `copyText`：同一思路，额外处理了
  iOS Safari 要显式 `setSelectionRange`、以及非安全上下文（手机经 LAN/Tailscale http 访问）
  的 fallback——其注释说明 fallback 存在的唯一理由是非安全上下文。
- fallback 要不要处理：dsh web 本体是 loopback 页面，常规场景 clipboard API 稳可用；
  若插件也想覆盖"手机访问 dsh web（http LAN 地址）"场景，直接用 `writeClipboard`
  就已含 fallback，零额外成本。

**坑**：Electron/Tauri 宿主下 clipboard 一般也可用，但权限拒绝时 `writeText` 会 reject
——`writeClipboard` 的 catch 分支返回 false 而非再 fallback（它只在 API 不存在时才走
execCommand；reject 直接 false），UI 上要给"复制失败"提示（claude gui MemoryPanel 的
`copy()` 就是这么处理的）。

---

## 推荐技术路径总览

| 层 | 做法 | 关键依据 |
|---|---|---|
| client 注入 | `ctx.slots.inject('conversation.input.right', ...)` 注册面板入口按钮（list slot，带唯一 `id`）；面板本体可用同一 entry 渲染或 `createRoot` 挂 fixed overlay（session-manager 模式，`src/client/index.tsx:186-199`） | slots 声明 `client.js:9547-9554`；`slots.inject` 等声明 `dsh-client-runtime/lib/client.js:55` |
| 方向键历史 | slot 组件拿 `inputActions`（standard prop）+ document capture keydown 拦截（先于 React root 监听），命中即 `preventDefault+stopPropagation`，`inputActions.setDraft()` 回填；拦截前判断命令菜单未开（arbitrate 语义） | provide channel `client.js:9504-9514`；React root 监听 `react-dom.development.js:9132`；arbitrate `input-trigger/lib/client.js:356` |
| 历史采集 | 订阅 `useInput` 的 phase：进入 adjudicating/submitting 抓 draft 文本；可用会话快照新 user 节点二次确认；失败 restore 时剔除/容忍 | phase 机 `contract.d.ts:196`；commitSend/restore `client.js:982,1441-1445`；UserMessageNode `conversation.d.ts:61` |
| 指令面板数据 | host 半自实现发现逻辑（约 60 行：`.git` 找根 + 祖先链 + 4 个候选文件名 + `~/.dsh/AGENTS.md`），经 webServer 路由下发；不做会话级 | `dsh-agent-instructions/lib/index.js:473-586`；无会话级 RPC（dsh-api-remotes 零命中） |
| 提示词库分发 | JSON 放插件包 data 目录，host 半 webServer 路由按需下发（进程内缓存），不进 client bundle；**许可先解决再谈打包**（Cherry Studio 实为 AGPLv3，claude gui 注释的 MIT 不成立） | session-manager `/sm/*` 模式；`prompt-templates.js:11-27` |
| 剪贴板 | `import { writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'`（平台 external），失败给 UI 反馈 | `dsh-client-ui-primitives/lib/index.js:1747-1778,5855` |

### 共性红线（来自 cordis 插件开发约束，落实时必查）

- 服务属性一律 `inject` 声明或 `ctx.get()`，禁止裸访问未注入服务；
- `ctx.logger` 等 callable 服务禁止存局部变量跨异步回调，闭包持 ctx 现取现用；
- 所有 DOM 监听/MutationObserver/React root 都必须挂进 `ctx.effect` 的 dispose 链，
  插件卸载/HMR 时干净摘除（session-manager `index.tsx:203-215` 是范本）。
