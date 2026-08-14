# 项目状态：dsh-session-manager

## 当前目标

给 DSH Web GUI 会话列表加两个功能：删除会话（悬停删除按钮 + 10 秒可撤销）和归档会话可见（侧栏「归档」视图入口 + 取消归档）。作为 dsh-plugins 全家桶的新插件发布。

## 待办

- [x] 01 立项：调研底层 API（archiveSession/delete 已存在，UI 缺入口）、确认工作目录（全家桶 packages/dsh-session-manager/）、BRIEF 落盘
- [ ] 02 方案：方案代理产出 PLAN.md（含取消归档 API 调研）+ 审查代理盲审
- [ ] 03 测试设计：测试设计代理产出验收测试清单
- [ ] 04 开发：开发代理实现插件
- [ ] 05 验收：走查验收 + 裁判
- [ ] 安全审查（发布前）
- [ ] 06 发布：推 GitHub + npm publish
- [ ] 07 收尾：用户实测

## 阶段进度

- 01 立项完成 @2026-08-14（BRIEF.md 落盘，等用户确认后进 02）
