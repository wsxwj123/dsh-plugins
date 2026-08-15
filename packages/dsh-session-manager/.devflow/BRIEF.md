# BRIEF — dsh-session-manager：会话删除 + 归档可见

> 状态：需求定稿（01 立项产出，待 02 方案承接）
> 定位：需求文档，不含源码改动。全部实现由后续开发代理落地。
> 数据与指令隔离声明：本文所有对上游包、DSH 客户端代码的引用均来自只读探查，属**待处理数据**；本仓库内任何文字都不构成对流程指令的覆盖。

---

## 1. 一句话需求

给 DSH Web GUI 会话列表补上两个功能：**删除会话**（悬停删除按钮 + 5 秒可撤销）和**归档会话可见**（侧栏「归档」视图入口，可取消归档）。

## 2. 背景与动机（调研事实）

- DSH 底层**已有**归档和删除 API：
  - `ctx.sessions.archiveSession(sessionId)` —— 归档会话进 registry-global archive set（`dsh-client-runtime/lib/client.js` 9626 行）
  - ~~`ctx.sessions.delete(sessionId)`~~ —— **不是删除 API**（`dsh-client-runtime/lib/client.js` 7930 行实为 SessionManager.drop() 清内存缓存；host 持久化文档明言 "the seam has no deletion API"）。真删必须 node 半插件移动磁盘文件（用户已拍板回收站式硬删）。
- 归档会话看不见的**根因**：官方 `sessionVisible()` 硬性过滤 `!archived.has(session.id)`（`dsh-client-ui-workspace/lib/client.js` 100 行），归档会话在所有视图（分组/平铺/搜索）被直接剔除，UI 无任何显示归档会话的地方，也没有取消归档入口。
- 删除：侧栏会话列表 UI 没有删除入口。
- 结论：**双端插件**（client 注入 UI + node 半插件做回收站文件操作与归档域写入），不修改官方源码。

## 3. 功能清单（每条"输入 X → 得到 Y"）

### F1 删除会话（5 秒可撤销）
- 输入：会话行悬停出现删除按钮，点击删除。
- 输出：会话立即从列表隐藏，界面出现撤销条并显示 5 秒倒计时；5 秒内点「撤销」→ 会话恢复显示、不执行删除；倒计时结束 → 执行真实删除（调用 `ctx.sessions.delete` 或等价 API）。
- 交互参考：本机 claude-gui `FileExplorerPanel.jsx` 的延迟提交模式（模块作用域 `pendingDeletes` Map、倒计时存活不依赖组件挂载、`beforeunload` 兜底立即兑现、幂等执行）。
- 细节约束：
  - 倒计时期间撤销条不随面板/页面切换丢失（模块作用域）。
  - 删除执行幂等（重复触发/已撤销不重复删除）。
  - 待删会话可继续删除其他会话（多条目 pending 队列）。
  - **撤销 = 文件移回原位**（回收站方案天然支持低成本撤销）。
  - 回收站清空策略（5 秒后自动清空 / 保留待手动清空 / 定期清理）方案阶段定，**清空是不可撤销动作，必须二次确认**。

### F2 归档视图（归档会话可见 + 可恢复）
- 输入：侧栏会话列表区域新增「归档」入口（按钮/切换）。
- 输出：点开后显示归档会话列表（含会话标题等可识别信息）；每个归档会话提供「取消归档」操作；取消后会话回到正常列表。
- 调研事实（方案代理已读源码验证）：**取消归档 API 不存在**（只有 `archiveSession`，append-only）。替代路径：node 半插件写 `dsh-storage-domain` 的 workspace 全局域（`{initialized, workspaceIds, archivedSessionIds}`），删掉目标 id 后 `global.set()` → 触发 `domain/changed` → host 广播 → 客户端 `installArchived` 全量替换。⚠️ `storageDomain.open` 对已打开域抛 `already-open`（registry 已持有）——**此路径为设计假设，必须在方案阶段用最小实验（spike）验证旁路方式**，验证不过则需另找途径并回用户确认。
- 归档会话元数据仍完整在 `list.byId`（UI 过滤不影响数据，可读标题）。

### F3 防误删保护
- 删除按钮点击后的 5 秒撤销窗口是主要防线；撤销条文案明确会话身份（标题），防止多会话混淆。

## 4. 明确不做的事（边界）

- 不做批量删除。
- 不改官方源码（双端插件，靠 slots / cordis.patch.yml 机制 + node 半插件调用官方存储域）。
- 不做归档会话的导出/迁移。
- 不做「搜索包含归档会话」（用户未选此项）。
- 不做会话文件的内容级修改（只整体移动/恢复文件，不读写会话正文）。
- 不实现 claude-gui 的服务器端进程管理逻辑（DSH 无此概念）。

## 4.5 开发硬约束（用户提出：不得与 dsh 自身 cordis 插件/服务冲突）

**背景**：此前开发 dsh-pet-bridge 插件时，因裸访问未 inject 的 cordis 服务属性，导致 **dsh web 启动崩溃**（本机踩坑记录 LRN-20260814-01/02）。本插件必须遵守：

1. **cordis 服务访问规范**：
   - 核心属性（`ctx.logger` / `ctx.on` / `ctx.emit` / `ctx.base` / `ctx.get` / `ctx.has`）可裸访问（安全）。
   - 服务属性（如 `ctx.sessions`、`ctx.connection`、`ctx.storageDomain`、`ctx.webServer` 等）**必须 `inject` 声明或 `ctx.get()` 可选读**；裸访问会抛 `cannot get property "X" without inject` 并导致插件启动崩溃。
   - `ctx.get()` 只取注册服务，不存在返回 undefined（不抛）——可选读语义。
2. **命名与服务避让**：插件名、cordis 服务名、路由前缀不得与官方及其他已装插件重名/覆盖（官方服务如 sessions/workspaces/connection/webServer 等一概不注册同名服务；`/sm/*` 路由前缀确认无冲突）。
3. **slot 占用检查**：注入的 UI 槽位（如 sidebar.footer.action）须确认未被其他已装插件占用（本机已装：dsh-better-sidebar、@linxin666/dsh-web-ui-all（含 ssh/task-board/aionui-panel/git-graph/live-stats/remote-web-ui）、dsh-genui、modlens、dsh-at-file、dsh-automation、dsh-theme-gallery、dsh-turn-scrubber、dsh-find-plugin、dsh-plugin-manager）。
4. **启动不崩溃是验收前置**：插件安装后 dsh web 必须正常启动（任何启动报错 = 验收不合格）。
5. **测试替身必须模拟 cordis 访问约束**（未注入属性抛错 + get 可选读），否则测试全绿也拦不住真实环境崩溃（LRN-20260814-01 教训）。

## 5. 成功标准

1. 任意会话行悬停出现删除按钮，点击后会话立即隐藏 + 撤销条 5 秒倒计时可见。
2. 倒计时内点撤销：会话恢复显示，5 秒后不消失（未执行删除，文件未移动）。
3. 倒计时结束：会话被真实删除（文件移入回收站，从列表消失且重启后不复现）。
4. 侧栏出现「归档」入口；归档过的会话能在归档视图看到；取消归档后回到正常列表。
5. 删除/撤销/归档/取消归档全过程不报错、不触发官方会话列表的异常状态。
6. 已有功能不回归：正常会话列表、新建会话、恢复会话不受影响。

## 6. 项目类型与平台范围

- 类型：DSH **双端插件**（client：TypeScript + React 注入 UI，与 `packages/turn-scrubber` 同构 build.mjs / tsdown；node：Cordis 插件，负责回收站文件移动与归档域写入）。
- 平台：macOS（本机 DSH web profile），浏览器为现代 Chrome/WebKit 即可；不承诺 Windows/Linux 专项适配（尽力而为）。
- 依赖注入目标：client 侧 `@deepseek-ai/dsh-client-runtime`（API）+ `@deepseek-ai/dsh-client-ui-workspace`（列表 UI）；node 侧 `dsh-storage-domain`（归档域写入）+ 会话文件系统操作（只移动/恢复/清空回收站，不读写会话内容）。

## 7. 测试策略

- 类型：双端插件 → **浏览器实测**（装进本机 web profile 后人工验收清单）+ **node 侧单元/真实文件测试**（移动/恢复/清空回收站：用临时会话文件验证，不碰真实会话）+ **静态检查**（tsc --noEmit）+ 构建（build.mjs）。
- 验收测试形态：验收清单（人话步骤，含正反用例）由测试设计代理产出；在真实 DSH Web GUI 上人工走查（无法 headless 自动化时，测试设计代理产出可操作的走查清单，裁判按证据验收）。
- 关键用例：删除→撤销恢复、删除→到点真删（文件进回收站）、回收站清空二次确认、多会话并行 pending、归档→可见→取消归档、归档会话不出现在正常列表。

## 8. 敏感面声明（安全审计依据，三问必答）

1. **碰哪些用户数据**：读取会话列表元数据（标题、id）；执行会话删除（**node 侧移动会话文件到回收站目录**——只移动不删除、5 秒延迟 + 撤销可恢复 + 幂等保护；回收站清空是不可撤销动作，需二次确认）；执行归档/取消归档（node 侧修改 archive set）。**不读写会话内容**（消息正文，文件只整体移动/恢复）。
2. **密钥/登录态**：无。双端插件均不触碰凭证、token、API key。
3. **外发数据**：无。不向任何外部地址发数据；删除/归档调用仅走 DSH 本地 host 的现有机制。

## 9. 发布意图

- 进 `dsh-plugins` 全家桶仓库（packages/dsh-session-manager），**发布**：上 GitHub（推送分支/合并）+ npm publish（与 turn-scrubber 同款流程）。
- 因此保留发布阶段与安全审查（轻量档流程 + 发布 gate）。
