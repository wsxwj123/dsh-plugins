# PLAN-REVIEW — dsh-composer-tools 方案审查报告

**总体判断：需修订后发布。** 没有发现致命问题：整体架构（复用 session-manager 工程模式、纯函数 core + 薄壳、双闸门写校验、phase 机两段式采集）方向正确，BRIEF 功能清单覆盖基本完整，敏感面逐项有保障。但有 4 个重要问题必须修订：INTERFACE.md 错误契约存在具体缺口（含一个静默丢数据路径）、三个决定 F1 成败的假设无最小实验实证且任务拆解里没有 spike 环节、方向键监听缺少焦点前置条件、发布意图未进任务拆解。修订量约半天到一天，不需要重做。

---

## 一、致命问题

**没发现致命问题。**

架构选型有先例背书（同仓库 session-manager 已在真实 profile 验证），写操作双闸门 + mtime 乐观锁 + 确认对话框的组合在设计上成立，cordis 红线逐条落实。没有发现"按此方案做下去必然返工/必然出事故"级别的问题。

---

## 二、重要问题（打回补全，按优先级排序）

### 重要-1：INTERFACE.md 错误契约不完整，03 反向用例有四处只能瞎猜

**位置**：`.devflow/INTERFACE.md` §1.2 / §1.3 / §1.1 / §2.2+§3

**为什么是问题**（逐条）：

1. **truncated 读 → save 的静默丢数据路径没有契约**（本条最严重）。§1.2 允许读返回 `truncated: true` 的 1MB 截断内容 + 当前 mtime；§1.3 允许 save 写任意 ≤1MB 内容。串起来就是：用户打开一个 1.2MB 的 AGENTS.md → 面板拿到截断内容 → 编辑保存 → 尾部 200KB 被静默覆盖丢失，且全程无报错。BRIEF 敏感面声明写操作"会改变模型行为需确认"，但没有任何条款防止"确认的编辑操作顺手砍掉文件尾巴"。
2. **符号链接逃逸未定义**。R1 声称"不存在集合外的合法目标"、BRIEF 要求"写回路径在项目根范围内"，但发现用的是 `stat`（跟随符号链接），§2.4 也没要求 `lstat` 拒收 symlink 或 `realpath` 比对。项目目录里一个指向 `~/other-project/AGENTS.md` 的符号链接会被发现收录、scope 校验通过、写回穿透到项目根外。"写不出项目范围"的承诺在 symlink 下不成立。
3. **`instructions.list` 对不存在/不可读的 cwd 行为未定义**。§1.1 只校验 cwd 是"非空绝对路径字符串"，没说不存在的目录返回什么（`files: []` 还是 `system-error`）。契约自述"本文未覆盖的行为属实现自由"，但这是一个正常会发生的边界（会话 cwd 被外部删掉），03 没法写断言。
4. **"手动编辑检测"机制缺失**。BRIEF F1 要求"翻历史途中手动编辑/退格 → 游标重置"，§2.2 提供了 `resetCursor`，但全文（含 §3 平台依赖表）没有任何地方说明**如何区分用户击键和 `setDraft` 程序化回填**——不区分的话，翻历史本身触发的 input 事件会被误判为"手动编辑"导致游标立即复位，功能自相矛盾。这是行为级契约，不是实现细节。

**怎么改**：在 INTERFACE.md 补四条：① save 增加前置——该文件最近一次 read 返回 `truncated: true` 时拒绝保存（新 code 如 `file-truncated`，提示用户用外部编辑器），或 save 端点要求 client 显式携带 `allowTruncatedBase: true`；② 发现与 scope 校验改用 `lstat` 且拒收符号链接（或 `realpath` 后再做集合比对），把"symlink 不收录"写进 §2.4 语义；③ §1.1 补"cwd 不存在/不可读 → 正常返回 `projectRoot = resolve(cwd)`、`files` 仅含可能存在的全局文件"之类的明确语义；④ §3 增加"手动编辑检测"条目（如：记录上一次 setDraft 写入的文本，input 事件值不等即视为手动编辑调 `resetCursor`）。

### 重要-2：三个"到底行不行"的假设无最小实验实证，任务拆解里没有 spike 环节

**位置**：`PLAN.md` §1.3-2/3（F1 全链路）、§4 任务表（T1–T11 无验证任务）、§5.1 R2/R3

**为什么是问题**：F1 整条链路压在三件事上，方案给出的依据全部是 RESEARCH 文档里对 **dsh 打包产物**（`client.js:3800`、`client.js:9504-9514`、`react-dom.development.js:9132`、`contract.d.ts:65-76`）的行号引用。读打包产物比瞎猜强，但它不是稳定的接口承诺，且三件事的实证等级不同：

1. **document capture keydown 抢在 React 18 root 监听之前**——这一条可靠。capture 相位自顶向下，document 先于 root 容器，React 18 把 keydown 挂在 root 是公开文档可查的行为，不需要 spike。**真正的未知在另一半：DSH shell 自己有没有更早的 document 级 keydown 监听**（注册顺序决定谁先生效），这靠文档确定不了。
2. **`inputActions.setDraft` 经 slot standard props 可达**——半可靠。有类型契约文件背书 + R3 备了黑魔法退路（native setter + dispatchEvent），失效代价可控。
3. **`data-phase` 属性作为命令菜单打开状态的旁证**——最脆。这是把 DOM 调试属性当状态 API 用，没有备案；一旦 rc.6 之后改名/不再实时同步，`menuOpen` 恒为 false，后果是 R2 自己标注的高危失败模式①——**废掉命令菜单的 ↑/↓ 导航**。

方案目前的兜底是"T11 e2e 手测"，但那是全部 11 个任务做完之后。如果假设 3 在 T11 才证伪，T6/T8 的 gate + HistoryNav 要返工。这正是"依赖了却没 spike 实证"的标准形态。

**怎么改**：在任务表最前面插一个 T0（半天工作量）：写一个最小 client 插件只做三件事——挂 document capture keydown 打日志验证拦截先于 InputBar 生效、打印 slot entry props 确认 `inputActions.setDraft` 存在且可写、打开斜杠菜单观察聚焦 textarea 的 `data-phase` 实际取值序列。三个结论回填 INTERFACE §3 后再定稿。同时给 `data-phase` 判定加 fail-safe 契约：属性读不到时 `menuOpen` 按 true 处理（宁可历史功能整体失效，不可抢菜单的键）。

### 重要-3：方向键监听缺"焦点在 composer textarea"前置条件，面板内编辑会被历史导航劫持

**位置**：`PLAN.md` §1.3-2（document 级 capture 监听）、`INTERFACE.md` §2.1 `ArrowGateInput`（无 target/焦点字段）、§3 menuOpen 条目

**为什么是问题**：监听器挂在 document 上，而面板自身有两个可输入组件——InstructionsTab 的**指令编辑 textarea** 和两个 tab 的搜索框。用户正在面板里编辑多行指令文件，光标在第一行按 ↑：此时 document 监听读到的是 composer textarea 的 `data-phase`（plain）和文本状态，gate 可能返回 `'older'`，于是 `preventDefault + stopPropagation` 拦截了本该属于面板编辑框的按键，还把历史条目灌进输入框。§3 只写了 menuOpen 由"聚焦 textarea 是本 composer textarea 时"读 `data-phase`，但 gate 的输入契约和 PLan 正文都没有把"事件目标必须是 composer textarea 本身"列为放行的必要条件。

**怎么改**：INTERFACE §2.1 的 `ArrowGateInput` 增加前置说明（或新增 `isComposerTarget: boolean` 字段）：仅当 `e.target` 就是本 composer 的 textarea 时才进入判定，否则一律返回 `null` 放行。一行契约 + 一条单测，成本极低，不补则面板编辑功能与 F1 直接互斥。

### 重要-4：BRIEF 发布意图未进任务拆解，本机安装验证（含物理复制坑）无人认领

**位置**：`BRIEF.md` §发布意图 vs `PLAN.md` §4 任务表

**为什么是问题**：BRIEF 明确要求：推送 dsh-plugins 仓库、更新 monorepo README、提交 awesome-dsh-plugin PR、**本机 profile link 安装测试**。任务表到 T11（测试 + headless e2e）就结束了。其中本机 profile link 安装不是走过场——工作区 AGENTS.md 白纸黑字记录了"`pnpm install` 导致 `@deepseek-ai/*` 物理复制、Symbol 分裂、全会话工具调用报废"的坑，而本插件恰恰要在真实 profile 里装。成功标准 5（安装后正常启动、卸载干净无残留）没有对应任务承载，等于成功标准悬空。

**怎么改**：任务表补 T12（发布）：monorepo README 更新 + 本机 profile link 安装 + 装后检查 `node_modules/@deepseek-ai/` 是否为物理副本（是则按 AGENTS.md 流程移走）+ 卸载残留检查 + awesome-dsh-plugin PR。headless e2e（T11）与本机 profile 验证（T12）是两个环境，不能互相替代。

---

## 三、建议（不阻塞，改了更好）

1. **砍掉 `clearHistory`（INTERFACE §2.3）**——过度设计。BRIEF 功能清单和边界里都没有"清空历史"入口，方案里也没有任何调用方。纯函数多一个不多，但它会被当成公共契约维护、被 03 写测试，为用不上的能力付永久成本。删。
2. **`/ct/prompts` 响应的 `version` 字段（§1.4）疑似无消费方**——面板标注来源用 `source` 字段即可，`version` 是硬编码字符串 `"cherry-studio-agents-zh-780"`，没有任何契约说明谁读它。要么说明用途（如缓存比对），要么删。
3. **404 响应字段名 `error` 与全篇 `code` 不一致（§0-7）**——方案注明是刻意对齐 /sm 行为，可接受，但建议在 INTERFACE 里补一句"新代码不要学这个"的注释，防止后来者当成漏洞去"修"。
4. **指令全文搜索的"拉全量 read"未说明缓存策略（§1.3-5）**——每次击键都全量 fetch 所有文件就是自建 N+1；面板会话内缓存一次 + 「重新加载」失效即可满足需求，建议在方案里写明一句，免得 04 实现走样。
5. **phase 机对 `claimed` 的归属未说明（§1.3-3 / §3）**——`InputState.phase` 枚举有四个值，采集逻辑只提了 `submitting`/`adjudicating`/`plain`，`claimed` 进来时 capture/drop 都不动——大概率正确（claimed 是菜单仲裁不是发送），但属于状态机漏枚举的嫌疑，建议 INTERFACE §3 一句话钉死。
6. **R3 的黑魔法备案（native value setter + dispatchEvent）与 client bundle purity gate 的关系未验证**——备案本身依赖 DOM API 模拟 React 内部受控输入，真启用时是否踩红线、是否被 React 18 的 value tracker 吞掉都未知。建议要么在 T0 spike 里顺手验证备案可行性，要么从风险表里删掉"备案"字样，别把没验证过的退路当缓解措施写。
7. **历史持久化的隐私提示**——输入历史按 sessionId 明文存 localStorage，BRIEF 已声明在范围内，不算问题；建议 README 提一句，公开发布的插件这是对用户的基本交代。

---

## 四、四维度核查记录（逐项过，无问题的写明理由）

### 1. 正确性
- 错误契约：见重要-1，四处缺口。
- 边界场景：空历史（recallOlder → null 放行）、空 body、2MB body、1MB 文件、超限裁剪、非 string 过滤、配额满——契约都有。缺：truncated→save（重要-1-①）、cwd 不存在（重要-1-③）、symlink（重要-1-②）、面板焦点（重要-3）。
- 状态漏态：方向键状态机本身闭环（cursor/stash/pending 迁移都有定义，含"cursor 已在最旧仍消费"这个易漏点）；pending 在 session 切换中途悬挂——无害（下次 capture 覆盖），可接受。写回并发有 mtime 锁兜底，达标。
- 手动编辑检测缺失：重要-1-④。

### 2. 安全
- BRIEF 敏感面 5 项逐项有保障（§5.2 对照表成立），信任边界清晰（loopback fence + 同源 fetch，不 inject 多余服务），无密钥面、无网络面、无注入面（React 默认转义，方案未出现 dangerouslySetInnerHTML 类设计）。
- 唯一穿透点：symlink 使"写不出项目根 + 全局文件"的承诺失效（重要-1-②）。写 `~/.dsh/AGENTS.md` 的路径校验与项目文件同机制，发现集合不含即拒，设计成立。
- fence 是"逐字移植 + 行为已对账"，属不可核的转述，但有 e2e 守门，可接受。

### 3. 性能
- 架构层面无明显低效：指令发现是固定 4 文件名 × 祖先链的 stat（无递归遍历），提示词 1.6MB 按需加载 + 进程内缓存（正确拒绝了内联进 bundle），document keydown 每次击键跑的是纯字符串函数。
- 唯一隐患是搜索"拉全量 read"未写缓存策略（建议-4），属实现走样风险而非架构必然。

### 4. 可维护性
- **过度设计**：`clearHistory`（建议-1）、prompts `version` 字段（建议-2）两处，都是小件，砍了即可。除此之外没有为想象需求预留的抽象——bridgeCore 注入 fetch、五个纯 core 出 node ESM 都是测试驱动，有真实消费方。
- **抽象不足**：未发现。4 候选白名单、错误码表、phase 枚举都是封闭集合，枚举处理正确；4 个端点共享 cwd/path/scope 校验，契约以引用方式复用，方向正确；指令发现自实现 60 行有明确理由（物理复制 Symbol 分裂），不是重复造轮子。
- 模块拆分合理：host/client/纯 core 三层分明，ComposerEntry 一身四职（按钮/keydown/采集/面板开关）略重，但 HistoryNav、Panel 已拆出，可接受。

---

## 五、修订清单（给作者的执行顺序）

1. 补 INTERFACE 四条契约（重要-1，约 2 小时，含 truncated→save 保护、symlink 拒收、cwd 不存在语义、手动编辑检测）。
2. 任务表插 T0 spike（重要-2，约半天），结论回填 INTERFACE §3，并给 `data-phase` 缺失加 fail-safe。
3. gate 契约加 `isComposerTarget` 前置（重要-3，一行 + 一条单测）。
4. 任务表补 T12 发布（重要-4，含物理副本检查）。
5. 顺手处理建议-1/2/6（删 clearHistory、删或注明 version、spike 里验证或删除黑魔法备案）。

改完 1–4 即可放行进入 03 测试设计。
