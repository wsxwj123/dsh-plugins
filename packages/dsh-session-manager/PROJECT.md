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
- 04 e2e 启动崩溃修复 @2026-08-14（commit 05ae95b：inject 收敛为空 + 服务 ctx.get 可选读 + 降级语义；headless 真实加载验证通过）
- 04 client 半完成 @2026-08-14（commit dc3248b/62cde8f/0d54413/b5dd9df：删除按钮/撤销条/归档视图；单测 52 + 验收 65 + 桥接 65 全绿）
- 05 裁判验收 @2026-08-14（b1991f1：**不合格——B 区人工走查零证据**；A 区 65/65 可信；放行门槛=B1-B8 真机走查 + storageDomain 冒烟 + A 区复跑）
- 插件已 link 装进 web profile @2026-08-14（副本已处理），等柚子重启 dsh web 后走查

## 待处理事项

- [ ] pnpm-lock.yaml 出现在仓库根（开发代理 pnpm install 产生）——是否入库待用户确认
- [ ] 偏离决策 1：node 半用裸 /sm/* 路由 + 自移植 trust fence（官方 connection.rpc.handle 是 envelope 协议，与验收契约的裸 HTTP 面不兼容）——已向用户汇报
- [ ] 偏离决策 2：路径解析按契约用字面 cwd+id 段，真实 DSH 会话目录是编码名——T6 联调必须验证真实路径解析，最高风险项
- [ ] 偏离决策 3（client 半）：beforeunload 不 flush pending 删除——按 INTERFACE §0/§1.4"刷新清空 pending、会话仍在"实现，舍弃 PLAN §5.5 建议——已记录
- [ ] B6 缺口：client 半补 emptyTrash UI 入口（进行中）
- [ ] B 区真机走查：柚子重启 dsh web 后按 B1-B8 清单走查留证
- [ ] storageDomain 真机冒烟 + A 区独立复跑存档
- [ ] 代码质量抽查（05 必跑：碰用户文件删除）+ 05.5 安全审计
