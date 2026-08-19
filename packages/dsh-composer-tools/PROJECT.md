# PROJECT — dsh-composer-tools

输入体验增强插件：方向键输入历史 + 指令查看 + 提示词库。移植自 claude gui。

## 待办

- [ ] 02 方案：调研 DSH input 仲裁/插槽接入点、claude gui 数据文件提取、指令发现机制复用
- [ ] 03 测试设计：验收测试清单
- [ ] 04 开发：host 端（指令文件读取/提示词库数据）+ client 端（历史导航核心/面板 UI）
- [ ] 05 验收：三层测试
- [ ] 05.5 安全审计
- [ ] 06 发布：推 GitHub + README + awesome PR
- [ ] 07 收尾：实测

## Bug 台账

（空）

## 阶段进度

- 卡点⓪ 立项确认：工作文件夹=dsh-plugins monorepo 新包 packages/dsh-composer-tools；需求定稿（输入历史门槛按用户标准：首/末行任意列；历史持久化；指令面板放输入框；提示词库复用 claude gui 780 条）@已提交（chore: 立项）
- 02 方案：调研完成（RESEARCH-input-injection.md），关键结论：
  - 注入：`ctx.slots.inject('conversation.input.right')` 注册 → 组件拿官方 `inputActions.setDraft()`；方向键用 document capture keydown 拦截（先于 React root 监听）
  - 历史采集：InputState phase 机（adjudicating/submitting 时抓 draft）+ 会话快照 user 节点二次确认
  - 指令发现：host 端自实现约 60 行（避免官方包 Symbol 分裂风险）；无会话级口子
  - ⚠️ 提示词库许可：Cherry Studio 实为 AGPL-3.0（claude gui 注释"MIT"是错的）→ 用户拍板打包+标注来源
  - 剪贴板：官方 `writeClipboard`
- 02 方案：PLAN.md + INTERFACE.md 已落盘（方案代理产出）；盲审（PLAN-REVIEW.md）无致命、4 重要已全部修订：truncated→save 双保险（file-truncated + allowTruncatedBase）、symlink lstat 拒收、cwd 不存在语义、isComposerTarget 焦点前置、手动编辑检测、T0 spike（4 项实证）、data-phase fail-safe、T12 发布 @已提交
- 卡点① 方案定稿：用户确认（含 cordis 约束核查补丁：slots.inject 返回 disposer、handler ctx 闭包 + logger 现取）@已提交
- 卡点② 验收测试锁定：11 文件 131 用例全绿（黑盒基于 INTERFACE 契约参考实现），TEST-PLAN.md 63 条人话清单，用户确认锁定（LOCK=8fbbc2f）@已提交
- 04 开发：T1 脚手架 ✅；T0 spike ✅；T2-T10 实现 ✅；验收接驳真实实现 ✅（131/131）；T11 单测 ✅（112）；**全量 243/243 绿**；e2e ✅（headless 加载 + playwright 真实 dsh web）；剩 T12 发布
- 05 验收：三轮裁判——①不合格（第三层 e2e 缺失）②不合格（无真实按键交互）③**合格**（补齐真实按键 e2e 7 条 + TEST-PLAN 接线说明，250 项全绿：验收131+单测112+e2e7）@已提交；卡点③待用户确认
- 05.5 安全审计：**可发布**（0 致命/重要，4 建议级；symlink 竞态建议已加固——doSave 写前复核 isSymbolicLink），全量 243 绿 @已提交
- 06 发布：**代码已推 GitHub main（29254dc）** ✅；README（包内 + monorepo）✅；密钥终检 ✅；**awesome PR #489 已提交**（OPEN 等合并）✅；部署实测 ✅（composer-e2e 全 bundles + 最新构建，7/7 e2e 过）；已装进 web profile（物理复制坑已处理）
- 07 收尾：LEARNINGS 同步（项目 + 全局）✅；feature 分支清理 + 临时文件 ✅；**剩卡点⑤用户实测（web profile 重启后体验方向键/面板/提示词库）**
- 主会话已确认的技术事实（供方案代理复用，来自代码阅读）：
  - DSH InputBar 方向键已走 keyboard.arbitrate()：input-trigger 菜单打开时 ↑↓ 被消费、关闭时 pass（放行光标移动）→ 历史导航监听在放行路径上做
  - DSH 无原生输入历史（只有草稿恢复）→ 空白区
  - 指令发现机制：dsh-agent-instructions 导出 discoverBaselineInstructionFiles/loadBaselineInstructions（全局 ~/.dsh/AGENTS.md + 项目根到 cwd 每层 AGENTS.md/CLAUDE.md/.local）
  - host RPC 模式：同源 POST + loopback trust fence（复用 session-manager 的 trust-fence/http-util）
  - client bundle：window.__ModuleLoader__.load({id, factory}) 注册（tsdown browser target）
  - 提示词库 schema：{id,name,emoji,group[],description,prompt} 780 条、33 分类，MIT（Cherry Studio agents-zh.json）
  - claude gui 输入历史关键行为：发送时去重后 unshift 置顶、上限 100、IME 合成期不劫持、翻历史中编辑重置游标

## 关键决策

- 两个功能合成一个插件（用户拍板），模块隔离
- 历史持久化 localStorage、按会话隔离、100 条上限
- **指令面板全局 + 项目级均可编辑保存**（用户拍板，写回双闸门 + mtime 乐观锁 + 截断保护）
- 提示词库复用 claude gui prompt-templates.json（Cherry Studio **AGPL-3.0**，打包+标注来源，用户已确认）
- 提示词"发送到输入框"= 追加到末尾、已有内容前空一行（不覆盖不自动发送）
- 指令面板支持跨文件全文搜索

## 增量：新建项目级 AGENTS.md（轻量档）

- 卡点①②（合并确认）：方案定稿 + 测试锁定——PLAN §7 / INTERFACE §1.5（POST /ct/instructions.create，只收 cwd，realpath 目标，flag:'wx' 原子创建，list 增补 projectRootFound/canCreateRootAgents）+ test-12 22 条黑盒用例（LOCK=52846fc）@用户确认 23:12

## 增量 2：全局新建 + 删除 + 返回 + 拖拽修复（轻量档）

- 卡点①②（合并确认）：PLAN §8 / INTERFACE §1.5 扩展+§1.6 delete+§2.4+§2.6 reducer+§3 拖拽修复；审查修订后定稿（5 重要项全处理）；test-13 31 条锁定（LOCK=f2c5c4b）@用户确认 08-17 09:xx
- 04 开发完成（4 commit：host create scope/delete/list 字段 + client reducer/双入口/删除/返回 + 拖拽修复）→ 05 裁判盲判：合格（184 验收+145 单测全绿，25ms 会合窗口专项判定接受）@待用户实测确认
- 真实环境实测（playwright 3080）：面板打开✓ 提示词 tab 不塌陷✓ 拖拽后点 tab 不塌陷✓ 项目级显示+删除按钮✓ ——但发现运行中 web（12:25 启动）host 是旧版（增量1），delete 404 + 无 canCreateGlobalAgents → 需重启 web 生效
- 卡点⑤待用户：重启 dsh web 后实测（删除可用/新建全局按钮/提示词不塌陷）
