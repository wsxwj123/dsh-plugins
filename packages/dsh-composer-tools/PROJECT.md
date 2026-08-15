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

- 卡点⓪ 立项确认：工作文件夹=dsh-plugins monorepo 新包 packages/dsh-composer-tools；需求定稿（输入历史门槛按用户标准：首/末行任意列；历史持久化；指令面板放输入框；提示词库复用 claude gui 780 条）@未提交

## 关键决策

- 两个功能合成一个插件（用户拍板），模块隔离
- 历史持久化 localStorage、按会话隔离、100 条上限
- 指令面板只读（不编辑 AGENTS.md）
- 提示词库复用 claude gui prompt-templates.json（Cherry Studio 开源 780 条）
