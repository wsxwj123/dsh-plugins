# 项目状态：dsh-session-manager

## 当前目标

给 DSH Web GUI 会话列表加两个功能：删除会话（悬停删除按钮 + 5 秒可撤销）和归档会话可见（侧栏「归档」视图入口 + 取消归档）。作为 dsh-plugins 全家桶的新插件发布。

**当前阶段（goal）：把代码修复到没有优化空间，再提交推送 GitHub。**

## 修复面（代码质量 7 重要 + 14 建议 + 安全 7 建议）

### 代码质量 — 重要（7，全部修）
- [ ] I-1 归档域读失败被吞 → 幽灵行 + 覆盖写丢 workspace 数据
- [ ] I-2 回收站 move 非事务 → 孤儿条目永久丢
- [ ] I-3 partial-failure 客户端不可区分 → 误报恢复
- [ ] I-4 /sm body 流 unhandled rejection
- [ ] I-5 bridge 网络错误无反馈
- [ ] I-6 同标题会话删错目录
- [ ] I-7 dispose 空实现 → 停用/热重载残留

### 代码质量 — 建议（14，全部消化）
- [ ] S-1 同构包含判断重复实现
- [ ] S-2 makeHandler 无用透传
- [ ] S-3 SESSION_MARKER 死导出 + marker 校验缺失
- [ ] S-4 魔法数字 256 重复
- [ ] S-5 'workspace' 域名字符串散落
- [ ] S-6 元数据记录损坏静默吞 + 非原子写
- [ ] S-7 build.mjs 硬编码 /bin/sh（Windows 必挂）
- [ ] S-8 MutationObserver 无防抖 O(n²)
- [ ] S-9 failed 窗口内同 id 重删静默拒绝
- [ ] S-10 deletedIds 永不清理、与 host 不对账
- [ ] S-11 归档视图 trashCount 刷新面窄 + 错误残留
- [ ] S-12 点击重解析死代码 → 运行中判定过期跳过确认
- [ ] S-13 每次点击全量 console.debug 含 cwd
- [ ] S-14 _metadata 与 id 命名空间冲突

### 安全审计 — 建议（7，消化关键项）
- [ ] S1 回收站根目录配置校验（SM_TRASH_ROOT 误配删错目录）
- [ ] S2 body 大小上限
- [ ] S3 HTTP 方法白名单
- [ ] S4 client console.debug 脱敏
- [ ] S5 deletedIds 无失效机制（与代码 S-10 同源）
- [x] S6 撤销窗 10s→5s 文档同步（已修 commit 0c1beaa）
- [ ] S7 发布卫生（.gitignore / lib 产物 / devDeps 版本）

## 待办（发布前）

- [ ] 开发代理修 7 条重要（进行中，子代理 56930115）
- [ ] 消化 14 条建议 + 安全 S1-S5/S7
- [ ] 全量回归（单测 + 验收 65 + 桥接 69 + build + 双 tsc）
- [ ] 代码复审（修复后抽查）
- [ ] 合并 main + push GitHub
- [ ] awesome-dsh-plugin 提 PR
- [ ] pnpm-lock.yaml 是否入库（待用户确认）

## 阶段进度

- 01-05 完成（立项/方案/测试/开发/真机走查）
- 真机走查通过（柚子确认核心功能全链路）
- 安全审计通过（可发布，0 致命 0 重要）
- 代码质量抽查：0 致命 7 重要 14 建议（426c288 落盘）
- 测试基线：单测 73 + 验收 65 + 桥接 69 全绿
