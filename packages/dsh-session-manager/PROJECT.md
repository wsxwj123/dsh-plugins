# 项目状态：dsh-session-manager

## 当前目标

给 DSH Web GUI 会话列表加两个功能：删除会话（悬停删除按钮 + 10 秒可撤销）和归档会话可见（侧栏「归档」视图入口 + 取消归档）。作为 dsh-plugins 全家桶的新插件发布。

## 待办

- [x] 01 立项：调研底层 API、确认工作目录（全家桶 packages/dsh-session-manager/）、BRIEF 落盘
- [x] 02 方案：方案代理产出 PLAN.md + SPIKE 实验 + 审查代理盲审（12 条全修）+ cordis 兼容性节
- [x] 03 测试设计：65 条自动化 + 32 场景走查清单，锁定 hash ba7ccb1
- [ ] 04 开发：node 半完成（测试全绿）；client 半待开发
- [ ] 05 验收：走查验收 + 裁判
- [ ] 安全审查（发布前）
- [ ] 06 发布：推 GitHub + npm publish
- [ ] 07 收尾：用户实测

## 阶段进度

- 01 立项完成 @2026-08-14
- 卡点①②确认 @2026-08-14（用户确认方案+测试清单，含 cordis 硬约束）
- 04 node 半完成 @2026-08-14（commit dc18275/97f8843，单测 37 + 验收 65 + 真实 handler 桥接 65 全绿）

## 待处理事项

- [ ] pnpm-lock.yaml 出现在仓库根（开发代理 pnpm install 产生）——是否入库待用户确认
- [ ] 偏离决策 1：node 半用裸 /sm/* 路由 + 自移植 trust fence（官方 connection.rpc.handle 是 envelope 协议，与验收契约的裸 HTTP 面不兼容）——已向用户汇报
- [ ] 偏离决策 2：路径解析按契约用字面 cwd+id 段，真实 DSH 会话目录是编码名——T6 联调必须验证真实路径解析，最高风险项
- [ ] client 半开发（UI：删除按钮/撤销条/归档视图）
