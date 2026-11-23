# LEARNINGS — dsh-composer-tools

## 2026-09-11 打包安装：lib/ 不入库必须有 prepare
- `lib/` 被 `.gitignore` 忽略、仓库不提交构建产物时，`package.json` 必须声明 `"prepare": "node build.mjs"`（与 `build` 一致）。
- pnpm 安装 Git 依赖只会自动执行 `prepare`；缺失时 pnpm 没有可授权的构建步骤，dsh-market 会报 "nothing installable"（同类问题见 dsh-session-manager issue #3）。
- 本地 `link:` 安装不会触发依赖构建，仍需先 `pnpm build`。

## 2026-08-15 开发过程沉淀（项目专属）

### 1. 子代理"大而全"任务容易空转，拆小批量有效
- 现象：派"实现整个插件 T2-T12"的代理，跑 15+ 分钟零产出（读文档阶段卡住）；两个 T0 spike 代理同样空转。
- 有效做法：拆成"单模块交付"的聚焦代理（如"只写 trust-fence + http-util + instructions 三个文件"），每个代理明确交付物 + 强制先写文件再完善，产出快且质量高。
- 触发条件：任务读的文件多（PLAN+INTERFACE+SPIKE+rules+参考实现 5+ 个）时，代理容易陷入"读不完不写"。给最小必读清单 + 明确"先写第一个文件打破僵局"。

### 2. node --test 的坑（本插件单测调试 3 小时）
- **未消费的 Readable 流保持事件循环活跃**：`readRequestBody` 对超限 body "不读流"提前 return，测试里 Readable.from 的流没被消费 → 进程挂起不退。修法：测试用例里 `stream.destroy()`。
- **`for await` 提前 return 中断 async generator**：badGen 抛错路径，generator 没显式关闭。修法：测试里销毁或接受该行为。
- **createHttpHarness 的 server 未 unref**：node --test 等所有打开资源，一个没 close 的 server 拖住进程。修法：`server.unref()` + stop() 不依赖 close 事件。
- **排查方法**：`--test-reporter=tap` 看测试流停在哪；`--test-force-exit` 区分"用例没跑完"vs"资源未释放"；最小复现（单独文件 vs 文件内组合）。
- 经验：用例全 ✔ 但进程不退 = 资源问题（流/server/timer）；用例没开始 = 调度问题。

### 3. 验收测试接驳真实实现（helpers 层切换）
- 黑盒测试从 `helpers/contractHost.mjs` 导入 ROUTER——接驳真实实现只需改 helpers（contractHost 用真实 createCtHandler、contractClient re-export 真实 lib/*），测试文件断言不动。这是 T11 的既定接驳点，不是改测试。
- 接驳后可能暴露"实现与契约"差异（displayPathFor 非默认 home 前缀、prompts 数据源注入）——修实现而不是改测试。

### 4. 真实环境 e2e（playwright + dsh web）
- 独立 profile（composer-e2e）+ 独立端口（3099），不污染用户 web profile。
- 装 profile 必触发 @deepseek-ai 物理复制坑 → 按 AGENTS.md mv 掉，服务才能起（Symbol 单例）。
- 会话 id 从 `dsh.sessions.current` localStorage 取；注入历史 key `dsh-composer-tools:history:<sessionId>` 后需刷新页面让插件重读。
- 真实按键验证 ↑ 回填历史成功——核心交互能在真实浏览器自动化。

### 5. 裁判三轮打回的教训
- 第一轮：只测了逻辑没测真实环境 → 补 e2e。
- 第二轮：e2e 只验加载/RPC，没验真实按键交互 → 补真实按键用例。
- 教训：BRIEF 成功标准里的"真实环境"承诺要兑现成自动化用例，别只靠诚实声明"留给 e2e"。

### 6. 安全审计建议级加固（低成本做了）
- doSave 写前复核 `isSymbolicLink()`（发现与写入之间的 TOCTOU 竞态）——一行防御，审计建议级，顺手修掉。

## 值得沿用的做法
- 纯函数 core（gate/history-core/storage/append/bridgeCore）单独出 node ESM，node --test 直接驱动——验收/单测/调试都方便。
- host 端 error 契约逐字写进 INTERFACE，测试按文案断言，实现与测试天然对齐。
- 独立测试 profile + playwright 验证真实环境，与用户 profile 隔离。

## 2026-11-23 DSH 0.2.2 Lexical 迁移：方向键历史与发送采集同时踩坑
（真机环境：桌面版 DSH 0.2.2-rc.5，隔离实例 DSH_HOME=/tmp、端口 6633）

### 1. 输入框从 textarea 换成 Lexical contenteditable，老 DOM 判据全失效
- 真实 DOM（0.2.2-rc.5，class 会变、不要依赖）：`[data-input-scroll]` 下的
  `div[contenteditable="true"][data-composer-input][data-lexical-editor][data-phase]`；
  外层 composer root 也有 data-phase（hero/active），所以 **必须从事件 target 向上 closest**，
  不能全文档 query `[data-phase]`。
- 老代码 `tagName === 'TEXTAREA' && hasAttribute('data-phase')` 在 0.2.2 恒 false →
  document capture keydown 的 gate 永不命中，表现为"方向键历史静默失效"。
- 适配层模式（src/client/composer-target.ts）：textarea 与 contenteditable 收敛成
  `getText/getSelection/setCaretToEnd`，HistoryNav 只吃这个接口；gate.ts 完全不动。

### 2. 文本口径：块级 join '\n'，`<br>` 分两种
- Lexical 根的直接子元素是块（普通段落 `<p>`），块间以 `'\n'` 连接即 textarea 行语义。
- Shift+Enter 是块内 LineBreakNode → DOM `<br>`（无标记），计 `'\n'`；
  空段落的占位是 `<br data-lexical-managed-linebreak="true">`，**不能计换行**，
  否则每个空行都会多出一行（真机实测对比过 innerHTML）。
- 读光标偏移不要自己逐节点累加：`Range.setStart(root,0)+setEnd(光标点)` 后
  `cloneContents()`，再用同一套块/换行 walk 数长度——文本、光标永远同口径，少一类 bug。
- `innerText`/`textContent` 都不行：textContent 丢换行，innerText 受 CSS/折叠影响。

### 3. 命令菜单判据：data-phase 不再是菜单状态
- 0.2.2 实测：输入 `/` 打开命令菜单时 editable 的 `data-phase` 仍是 `'plain'`；
  原来"data-phase !== plain = 菜单开"的判据会抢菜单方向键。
- 可靠判据：input-trigger 的 MenuView 根 `[data-trigger-menu]` 只在菜单打开时渲染
  （`role="listbox"` + aria-activedescendant 也在，但 data 属性更稳）；
  同时保留 `data-phase !== 'plain'`（submitting/adjudicating/claimed/inert）当 fail-safe。
- 实测证据：菜单打开时按 ↑，菜单 `aria-selected` 高亮变化、草稿文本不变 → 方向键确实归菜单。

### 4. 手动编辑检测：Lexical 会吞掉原生 input 事件
- Lexical 在 `beforeinput` 上 preventDefault 后自己改 DOM，浏览器原生 `input` 事件
  **可能不派发**。只监听 `input` 会导致"翻历史途中手动输入后游标不重置"（回填后再按 ↑ 跳到更旧的条目）。
- 修法：document capture 监听 `beforeinput` → `nav.onManualEdit()` 无条件 resetCursor；
  程序化 `inputActions.setDraft` 不会产生 beforeinput，不会误伤。`input` 监听保留给旧 textarea。

### 5. 回填后光标复位：setDraft 自带 selectEnd，但仍要 rAF 重试
- 0.2.2 的 `DraftEditorRuntime.setDraft` 内部 `$getRoot()` 重建段落并 `root.selectEnd()`，
  正常同帧就位；但 React 发布链路可能晚一帧。适配层的 `setCaretToEnd()` 外面用
  rAF + "文本还没变成目标文本就再等一帧"（最多 3 帧）兜底；并且只在焦点仍在 composer 内时才动光标，
  避免从插件面板抢焦点。

### 6. 发送采集主路径在 0.2.2 也断了：SessionSnapshot.nodes 被删除
- 源码取证：`dsh-api-session-controller/lib/types/client/sessions/session.js` 的
  `buildSnapshot()` 只返回 running/promptError/blank/...，**没有 nodes**；
  旧 `session.getSnapshot().nodes` 水位线 diff 恒空 → 发送历史静默不采集。
- 0.2.2 的可用信号：`sessions.binding(id)` 仍在，`SessionBinding.eventSource`
  （MutableSessionEventSource）同步发布 change：
  `{kind:'append'|'replace'|'prepend'|'settle-assistant', entries:[{event}]}`。
  采集 `event.type === 'user/message' && event.data.source.kind === 'user'`，
  文本用 `content` 里 text 块 join '\n'（与快照路径同一函数）。
- **必须过滤 source.kind**：system-reminder / time-context / retry / compact-checkpoint
  也是 `user/message`，但那是宿主注入的 user-role 上下文；不过滤会把整段提示词写进历史。
- 水位线用 `event.seq`：首帧只建水位线；replace（历史重载）以新窗口 max seq 重置；
  prepend/settle-assistant 放行；append 只采 seq > 水位线。
- 双档兼容：snapshot 有 nodes（0.1.5–0.2.0）走旧路径，否则走 eventSource（0.2.2+）。
- 真机证据：隔离实例里输入唯一文本按 Enter，本地历史 key 立刻出现该条，
  且 3.5s 后（注入的 user-role 上下文事件已 append）历史仍只有这一条。

### 7. 隔离实例验证的坑（本机）
- 复制 desktop profile 起隔离实例会因未登录 remote 弹出 "Waiting for sign in" modal 盖住
  composer；测试里从临时 profile 的 `dsh.profile.bundles` 摘掉 `ds-harness-remote` 最省事
  （不要动真实 profile），剩下偶发 modal 用 DOM 移除兜底。
- app.asar 内部路径普通 node `fs.access` 看不到（只有 ELECTRON_RUN_AS_NODE 下的 Electron fs 能读）；
  测试脚本只检查 app 可执行文件与 profile，bin.js 交给子进程解析。
- "New session" 只有在当前会话已 stage（发过消息）时才会分配新 sessionId；blank hero 上点它
  不会换 id，会话隔离测试必须先发一条消息把当前会话变成 active。
- 隔离实例里没有 ~/.dsh 凭据，LLM 调用会失败，但 user 消息在宿主受理时就已 append 事件流
  ——完全足够验证发送采集，不用花钱调模型。

### 8. 测试分层（这次怎么证明修好了）
- `tests/e2e/composer-target.dom.test.mjs`：Chromium 里构造与真机一致的 Lexical DOM 夹具，
  把 `lib/composer-target.js` 以 Blob URL 注入页面直接驱动（21 条：文本口径/选区偏移/菜单判据/
  textarea 兼容）。夹具**必须无块间空白文本节点**，否则缩进会被算成额外块。
- `tests/e2e/composer-0.2.2.e2e.mjs`：自动拉起隔离 DSH 实例 + 真实按键，7 条覆盖
  ↑↑↓↓ 往返、多行行边界、菜单让路、手动编辑重置、会话隔离、真实发送采集、无插件报错。
- 纯逻辑继续走 node --test（gate 未改，原有 214 条验收全绿；新增 test-17 覆盖事件流水位线与整链）。
