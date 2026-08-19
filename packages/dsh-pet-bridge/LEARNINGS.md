# LEARNINGS（项目专属）

## [2026-08-14] 部署后启动崩溃：inject:[] 裸访问 ctx.agents

- 现象：插件部署到 web profile 后 `dsh web` 启动报 `cannot get property "agents" without inject`
- 根因：cordis 规定 inject 未声明的服务属性不能访问；`ctx.agents` 是服务属性不是核心属性
- 修复：`ctx.get('agents')` 可选读（未注册返回 undefined）
- 通用规则已记全局 `~/.learnings/LEARNINGS.md`（LRN-20260814-01）
- 测试盲区：验收测试 ctx 替身未模拟 cordis 访问约束，已补防回归用例
