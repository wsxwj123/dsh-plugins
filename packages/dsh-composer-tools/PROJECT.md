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
- 04 开发：开始（模型=高性价比档），先 T0 spike 后按 T1–T12 实现
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
