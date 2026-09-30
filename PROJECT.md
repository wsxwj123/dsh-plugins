# PROJECT — 外观插件合并（theme-gallery + skin-gallery/skin-runtime → 单一插件）

## 当前目标

把 theme-gallery（15 主题）与 skin-gallery + skin-runtime（懒加载拆分的 9 皮肤画廊）合并为**一个**外观插件，且设置→通用打开与上下滚动不卡顿。dev-flow 标准任务。

## 已拍板决策（用户确认 @2026-08-17）

| 决策 | 结论 |
|---|---|
| 形态 | 设置页一个轻量入口按钮 → 点开二级完整面板（主题+皮肤两个区），延续懒加载路线 |
| 旧包处置 | 新建合并包；theme-gallery / skin-gallery / skin-runtime 三个旧文件夹从 packages/ 删除；README 写迁移命令 |
| 硬约束 1 | lib/client.js 必须带 `__ModuleLoader__.load` 自注册壳（≠ src；构建脚本须含壳校验）——LEARNINGS.md [LRN-20260817] |
| 硬约束 2 | settings.general.item 槽位遮盖语义：同 id 不同 priority 合法，数值最低者渲染；运行时 priority: -1 遮盖入口 0，不得删 |
| 验证方式 | `dsh web --port 3199` 隔离实例，日志 grep "failed to apply loader entry\|failed to import loader entry" 计数为 0 |
| 不回退 | 70c230d（另一会话的修复提交）保留 |
| 硬约束 3 | 新包 peerDependencies 中所有 @deepseek-ai/* 框架包版本范围必须写 `"*"`（防 pnpm autoInstallPeers 补装第二份框架副本导致 Symbol 分裂崩溃，dsh discussion #783 族）；框架包严禁进 dependencies。三仓存量 20 个 package.json 已按此修复（74982f8 / a878f4a / 0f537e2）@2026-08-17 |
| 硬约束 4 | **Windows 兼容**（用户 2026-08-17 补充）：所有插件 macOS + Windows 双平台可用。构建/校验脚本跨平台（node:path、无 shell 专属语法、无 macOS 专属工具）；session-manager 修复中所有路径逻辑（home 解析、trash 名单、realpath）必须平台感知（Windows 系统目录名单、盘符、大小写不敏感、保留名）；文档给 PowerShell 等价命令。BRIEF 已补"平台范围"节 |

## 待办

- [ ] 02 方案：现状调研（进行中）→ 方案代理 → 盲审 → 定稿 ⏸卡点1
- [ ] 03 测试设计 ⏸卡点2
- [ ] 04 开发
- [ ] 05 验收 ⏸卡点3 + 05.5 安全审计
- [ ] 06 发布（GitHub main + README 迁移说明）⏸卡点4
- [ ] 07 收尾：用户实测 ⏸卓点5

## 阶段进度

- 任务分级：标准任务 @2026-08-17
- 02 Step 0 需求岔路确认（形态=入口+二级面板；旧包=新包+删旧）@2026-08-17
- 止血：70c230d（壳修复+priority -1）已推 GitHub main（ce1151f..70c230d，ls-remote 核实）@2026-08-17
- 02 Step 1 调研完成：.devflow/RESEARCH-merge-baseline.md（505 行）。关键纠正：cordis 包级懒加载被证伪（启用条目宿主启动即 import）；滚动卡顿根因=5 皮肤 fixed 大图背景 + miku 45 处 blur；skin-gallery lib 手工产物会被 `pnpm -r build` 静默摧毁；theme scroll 测试已红、build-static 假绿 @2026-08-17
- 02 Step 2 方案完成：.devflow/PLAN.md（587 行）+ INTERFACE.md（276 行）。要点：新包 packages/appearance-gallery 单包单产物单槽位（id appearance-gallery/order 11）；UI 双工厂 createThemePanel/createSkinPanel；storage 8 键零迁移；卡顿治理=删 background-attachment:fixed + blur 限 ≤12 处 + 4 图转 WebP（1.19MB→≤700KB）+ readCustomItems 记忆化 + 面板懒挂载；形态维持"入口+二级面板"（React 条件渲染实现），并列形态 B（可折叠标题行）/ C（弹层，需 spike）供重选；5 个 spike 待实证（含 dsh plugin 卸载子命令名）@2026-08-17
- 02 Step 3 盲审完成：PLAN-REVIEW.md（446 行）——1 致命（G1 归因实验证不了主因+无预案）+ 12 重要，结论"需修订后定稿" @2026-08-17
- 02 Step 4 修订完成：F1 归因实验三组对照+Paint flashing、rAF spike 提前阶段 0、补两条预案分支、P9 升卡点；I1–I12 全采纳（状态归属表、panel deps 签名、a11y 三门禁+信任边界、串行化约定、门禁数值 TBD+900KB 兜底等）；新增待实证仅 S6（WebP 试压）@2026-08-17
- **卡点1已确认**：方案定稿（PLAN.md 756 行 / INTERFACE.md 348 行），形态 A（入口按钮+二级面板）用户重选后维持 @2026-08-17
- 03 测试设计完成：黑盒代理产出 tests/acceptance/appearance-gallery/（458 条 node --test，对契约 harness 393 绿 65 skip）+ e2e 16 条 + TEST-PLAN.md；守卫检查通过（无实现细节泄露）@2026-08-17
- **卡点2已确认**：验收测试锁定（软互斥按 INTERFACE §3.5；A1–A8 七处契约歧义 20 条 skip 挂账，解冻后先由方案代理补 INTERFACE 再解锁）@2026-08-17
- ~~任务冻结~~ → 用户解冻，两线并行 @2026-08-17
- **SM 线全部完成** @2026-08-18：18+1 条修复（含抽查 H2b 队尾串行）→ 裁判合格 → 用户确认 → 已合并推 GitHub main（92e4499）。遗留：H1 上游根治需 DSH issue；9 条真机 skip 待用户实测；回收站自动过期待用户拍板
- 合并线 03 补全：A1–A8 裁决（d4c9a0f）→ 7 条契约 skip 解锁+13 派生断言（471 例 413 绿）→ 重锁定（LOCK=d5b310e）@2026-08-18
- 合并线 04 开发完成 @2026-08-19：appearance-gallery 6 commit（骨架/双面板/资源治理/构建壳校验/单测接线/state 卸载即丢 65f7c8b）；spike：WebP -58%（815K→341K）、S1/S3 真机项走 PLAN B 支（G1 记卫生项收益 0）；旧三包已删（用户确认）；验收 464 绿/0 红/7 真机 skip + 包内单测 30 绿 + build --check 幂等（841KB<900KB 兜底）
- 合并线 05 裁判盲判 @2026-08-19：**合格但附条件**——7 条关单证据缺口（P9/P10/P11 真机采样、启动 loader=0、subject=real 回显、e2e E-1/E-13/E-14/E-15、Windows 真跑、P5 阈值 TBD、TEST-PLAN 旧注记对账瑕疵）。⏸ 卡点3/4 待用户
- 真机采证 @2026-08-19：换装成功（框架副本 0）、启动 loader 错误 0、验收在真实实现下 464 绿、帧率 p95 全部约 17ms（满帧）；灵敏度对照证明采样有效（强灌 blur=183ms）。**关键结论：删 fixed 背景零性能收益（走 PLAN B 支，记卫生项）；blur 是真凶，已 55→10**
- 收尾修复 @2026-08-19：qq98 属性名统一（5ed27e1，该皮肤此前样式完全不生效）+ data-slot-id 可测性（b96aed5）+ 三个「返回」aria 去重（c03cbea）+ **三目录统一 dsh- 前缀（c678cff，用户要求）** + 路径同步（3cb8ea6）+ README 重写（中英+迁移+PowerShell）
- **已发布** @2026-08-19：合并远端 SM 修复（冲突=旧包 package.json 保留删除）→ 全量复跑（验收 464/单测 31/SM regression 86 全绿）→ 推 GitHub main **e770f20**，ls-remote 核实
- 本机 profile 已按新路径重装（dsh-appearance-gallery link 有效，@deepseek-ai 副本 0）
- 遗留待办：① awesome-dsh-plugin 需提 PR（旧 theme/skin 两条→dsh-appearance-gallery 一条 + pet-bridge/turn-scrubber 改链接）② 另两个本地副本需 pull 对齐 e770f20 ③ pnpm-lock.yaml importers 仍是旧路径（需授权重生成）④ 截图 PR（可选，4 个包无图）⑤ tests/unit/skin-harness.mjs 的 loadSkinWithA11y 坏但零调用方
- 并行事项：dsh-session-manager 盲审完成（报告 packages/dsh-session-manager/.devflow/REVIEW-BLIND-20260817.md，在 claude 副本）——3 致命 4 高 5 中 6 低；**用户拍板：18 条全修（3致命+4高+5中+6低）**（dev-flow 修 bug 模式，工作基线=claude 副本 main 对齐 70c230d 后开 fix 分支，与合并任务物理隔离并行）@2026-08-17

---

## 2026-09-30 · 桌面端 DSH 0.2 适配（新任务）

**目标**：三个自研插件适配 DeepSeek Harness 桌面版 0.2.0-rc.2，完成后推 GitHub。

| 插件 | 类型 | 现象 |
|---|---|---|
| dsh-turn-scrubber | 修 bug | 启动即挂：`cannot get property "webServer" without inject`（lib/index.js:216 调 `ctx.connection.rpc.handle`，inject 缺 webServer） |
| dsh-composer-tools | 修 bug | 「指令/提示词」面板显示「无当前会话目录」：`snapshot.byId[sessionId]?.cwd` 在 0.2 取不到（0.1.5 正常） |
| dsh-appearance-gallery | 适配 | 能加载，但 3 个 `@deepseek-ai/dsh-client-ui-*` peer 写死 `^0.1.0-rc.6`，靠 profile 版本豁免强装；需查清 API 是否真的兼容再改 peer |

### 阶段进度

- 任务分级：**标准任务**（多模块 + 发布 + 外部网络）@2026-09-30，主会话判定，用户未反对
- 接手已有项目扫描 @2026-09-30：继承根 `.devflow/`（PLAN/INTERFACE/TEST-PLAN/LOCK）+ 各包 `.devflow/` + `LEARNINGS.md`；**主 clone = `app/dsh-plugins`**（origin=GitHub，与 origin/main 同步于 aea84ea），另两个副本待 pull 对齐
- 卡点0 用户拍板 @2026-09-30：① 开 **git worktree** 隔离（不碰主 clone 里 composer-tools 的 3 个已改 .devflow 文件 + 1 个未跟踪文件，属另一条未完的线）② **一个分支一个 PR** ③ 卡点③验收标准 = **真机 UI 实测**（不是只看启动无告警）④ 脱敏 = 排查既有版本
- 脱敏排查完成 @2026-09-30：305 个 commit 全历史无明文密钥/硬编码凭据；**但个人家目录绝对路径在 6 个既有文件里**（最重：`packages/dsh-composer-tools/tests/e2e/composer.e2e.spec.mjs`、`.devflow/RESEARCH-input-injection.md`），且提交者身份用的是个人邮箱（见 `git log --format='%ae'`，295 个 commit）——两者都已在公开历史里。清历史需 filter-repo + 强推（用户红线，未授权）→ 本次只保证新增内容干净 + 顺手清理上述文件的硬编码路径
- 工作区：`git worktree add ~/Desktop/app/dsh-plugins-wt-0.2 -b fix/dsh-0.2-adapt main`（基线 aea84ea）@2026-09-30
- 02 Step 1 调研派发 @2026-09-30：3 个独立调研代理（`deepseek-v4-pro`，workflow 工具并行，互不知情），产出 `.devflow/RESEARCH-ct-cwd-0.2.md`、`RESEARCH-turn-scrubber-inject-0.2.md`、`RESEARCH-appearance-gallery-0.2.md`
- 02 Step 2-3 方案 + 盲审 @2026-09-30：方案代理产出 `PLAN-dsh-0.2-adapt.md`(148 行) + `INTERFACE-dsh-0.2-adapt.md`(211 行)；盲审代理（只给 BRIEF+PLAN，白名单禁令）结论 **0 致命 / 4 重要 / 6 建议**
- 02 Step 4 修订 @2026-09-30：I1（两症状同一根因，证据 `InstructionsTab.tsx:80-84`，已补 BRIEF §6）、I2（INTERFACE 写全错误码表）、I3（新增 A7 运行时断言：非 loopback 调用被拒）、I4（主会话实测 `app-boot:300` 用 `includePrerelease:true` → peer 写双区间 `^0.1.0-rc.6 || ^0.2.0-rc.1`，两版都满足，成功标准#4 不降级）全部处理；S5 用户改判为采纳（加自动脱敏闸门）
- **卡点1已确认** @2026-09-30：方案定稿；用户补充决策 = ①三包各 bump 一个 patch ②脱敏固化为推送前自动闸门 ③turn-scrubber 死参数按方案删并补 A7
- 03 测试设计 @2026-09-30：独立代理黑盒产出 `tests/acceptance/dsh-0.2-adapt/`（静态门禁 + 行为级激活审计 + 3 个 playwright spec）+ `TEST-PLAN-dsh-0.2-adapt.md`；守卫检查通过（断言均可追溯 INTERFACE 必验清单，无清单外实现细节）
- 行为级补测 @2026-09-30（用户要求）：`A3-C2-activation-behavior.test.mjs` —— 造最小临时 profile（base+web-app+三个包 link，无版本豁免）真启动一次，断言输出无 `did not activate`/`without inject`/`skipping profile bundle`；单次约 38 秒，修复前实测红（三条标记全命中）
- **卡点2已确认** @2026-09-30：清单锁定，`LOCK-dsh-0.2-adapt = 4ca47cd1cb3724b18710ed46b99ef39b2b454e60`（23 个自动用例：修复前 11 红 13 绿）；e2e 实跑放 05
- 事故与修复 @2026-09-30：用户自行删除了两个冗余 clone（`Desktop/app/dsh-plugins-runtime`、`Desktop/claude/dsh-plugins`），导致 desktop profile 里 `dsh-pet-bridge` 的 link 断链 → 已用 `dsh plugin --profile desktop add dsh-pet-bridge@link:.../app/dsh-plugins/packages/dsh-pet-bridge` 重指并核实目标存在。两个 clone 的未跟踪文件（`RESEARCH-module-api-rc2.md`、session-manager 的 package-lock）随之丢失，已提交内容可从 GitHub 重新 clone
- 04 开发派发 @2026-09-30：单开发代理（用户选 `deepseek-flash` 高性价比档），一个包一个 commit；不拆并行 worktree（三处改动各 1-3 行，拆并行收益低于合并成本）。任务含三包适配 + 版本 bump + 推送前脱敏闸门（用户卡点1 决策）
- 04 开发结果 @2026-09-30：6 个 commit。composer-tools ✅（静态断言全绿）、appearance-gallery ✅（行为级审计里 `skipping profile bundle` 消失，免豁免即可加载）、版本 bump ✅、脱敏闸门 ✅（9 条规则自检 + 对分支 diff 实跑通过）。**turn-scrubber ❌：方案 §1.1 的 `inject` 修法在 0.2 真机上不成立**——开发代理按流程停下上报，未自行偏离
- turn-scrubber 机制调研 @2026-09-30（高推理代理，`RESEARCH-turn-scrubber-0.2-rpc.md`）：根因是**宿主回归缺陷**——0.2 把 `(this.webCtx ?? owner).webServer` 改成 `owner.webServer`，而 `owner` 是 cordis 影子上下文（inject 仅 `credentials`），故必抛；顶层 inject 永远救不了（影子 fiber 重定向）；`rpc.handle` 在 0.2 **官方零调用**，只有第三方插件踩。插件侧有个**已真机验证通过**的绕法（`ctx.webServer.register` 手写同形路由 + `requestRejection` fence，客户端契约不动），代价 ~40 行复刻宿主信封。报告里另含可直接贴的上游 issue 草稿
- **范围变更** @2026-09-30（用户决定）：turn-scrubber 是「Codex 风格回合刻度簇」（会话右缘细横线，每用户回合一根，含未加载/已压缩回合；悬停鱼眼、点击平滑跳转），用户判定优先级低 → **本次不修**。处置：回退其适配改动（`git revert`，版本退回 0.2.0、CHANGELOG 条目撤下），验收集收窄到 composer-tools + appearance-gallery 并重新锁定。以后要做时直接照上面那份调研改即可
- 脱敏闸门误报修复 @2026-09-30：闸门扫 diff 时命中已锁定测试 `D1-D2-release-gates.test.mjs` 里的规则字面量（它自身职责就是持有这些模式）。按规则性质分级修：密钥类对全部路径生效，个人路径/邮箱类跳过 `tests/**`（并注明为何不是文件白名单）
