# dsh-pet-bridge

把 dsh 会话状态实时推送到 claude-pets 桌面宠物气泡。

## 阶段进度

- 卡点①②（方案 + 测试清单）已确认 @e0ae374 (2026-08-14)
- 卡点③（验收合格）已确认 @3f1c8a3 之后 3 commits（ef69efb / 2efdb15 / 7695f79）(2026-08-14)
- 部署到 web profile：待用户同意 + 重启 dsh web
- 真机实测（卡点⑤）：待部署后用户点验

## 待办

- [ ] 部署：web profile 加 dependencies link + bundles 条目 + node_modules symlink（改配置需用户同意）
- [ ] 重启 dsh web 生效
- [ ] 用户实测：dsh 跑任务看 pet 气泡（思考中→工具名→完成）
- [ ] 真机补验：caller_pid 与回环绑定（裁判存疑项 #7）

## Bug 台账

- （无）
