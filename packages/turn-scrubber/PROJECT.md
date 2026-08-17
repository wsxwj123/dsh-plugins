# dsh-turn-scrubber 项目状态账本

## 阶段进度

- 2026-08-14：项目已发布 v0.1.0 至 GitHub（wsxwj123/dsh-plugins/packages/turn-scrubber），profile 已切换为 monorepo link 安装
- 2026-08-14：新需求「回合刻度显示所有回合（含未加载的历史）」进入 02 方案（轻量档）
- 2026-08-15：spike #0/#0.5 实测通过（sessionPersistence 可用、turn 号 1 基、compacted 判定 269/276、RPC 协议确认；preview 取最后一条 user/message）
- 2026-08-15：卡点①②合并确认（方案定稿 + 测试清单锁定 41 项）@commit 0991836（docs: 回合刻度全量方案定稿）
- 2026-08-15：开发完成（feature/turn-index-full，8+1 commit；单测 25/25、typecheck、构建全绿）
- 2026-08-15：05 验收中——契约偏差已修正（sessionId 缺失→bad-request，connection.rpc 固定 HTTP 200）；待重启 dsh web 后跑端点验收 + 裁判盲判

## 待办

- [ ] 回合刻度显示所有回合（含 DSH 分页隐藏的历史回合）——开发中
- [x] 未加载回合的点击跳转行为（已确认：自动连续加载再跳转）
- [x] compaction 压缩掉的旧回合的显示策略（已确认：灰色占位）
- [ ] 验收（05）+ 用户实测（卡点⑤）
- [ ] 是否推送到 GitHub（发布）待用户确认

## Bug 台账

- （无）
