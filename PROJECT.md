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
- **任务冻结**（用户拍板省额度）：合并任务停在测试锁定态；解冻路径=方案代理补 A1–A8 契约 → 测试解 skip → 04 开发（开发代理用本会话模型）。SM 修复线优先推进 @2026-08-17
- 并行事项：dsh-session-manager 盲审完成（报告 packages/dsh-session-manager/.devflow/REVIEW-BLIND-20260817.md，在 claude 副本）——3 致命 4 高 5 中 6 低；**用户拍板：18 条全修（3致命+4高+5中+6低）**（dev-flow 修 bug 模式，工作基线=claude 副本 main 对齐 70c230d 后开 fix 分支，与合并任务物理隔离并行）@2026-08-17
