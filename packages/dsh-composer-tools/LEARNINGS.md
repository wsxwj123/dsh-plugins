# LEARNINGS — dsh-composer-tools

## 2026-08-15 开发过程沉淀（项目专属）

### 1. 子代理"大而全"任务容易空转，拆小批量有效
- 现象：派"实现整个插件 T2-T12"的代理，跑 15+ 分钟零产出（读文档阶段卡住）；两个 T0 spike 代理同样空转。
- 有效做法：拆成"单模块交付"的聚焦代理（如"只写 trust-fence + http-util + instructions 三个文件"），每个代理明确交付物 + 强制先写文件再完善，产出快且质量高。
- 触发条件：任务读的文件多（PLAN+INTERFACE+SPIKE+rules+参考实现 5+ 个）时，代理容易陷入"读不完不写"。给最小必读清单 + 明确"先写第一个文件打破僵局"。

### 2. node --test 的坑（本插件单测调试 3 小时）
- **未消费的 Readable 流保持事件循环活跃**：`readRequestBody` 对超限 body "不读流"提前 return，测试里 Readable.from 的流没被消费 → 进程挂起不退。修法：测试用例里 `stream.destroy()`。
- **`for await` 提前 return 中断 async generator**：badGen 抛错路径，generator 没显式关闭。修法：测试里销毁或接受该行为。
- **createHttpHarness 的 server 未 unref**：node --test 等所有打开资源，一个没 close 的 server 拖住进程。修法：`server.unref()` + stop() 不依赖 close 事件。
- **排查方法**：`--test-reporter=tap` 看测试流停在哪；`--test-force-exit` 区分"用例没跑完"vs"资源未释放"；最小复现（单独文件 vs 文件内组合）。
- 经验：用例全 ✔ 但进程不退 = 资源问题（流/server/timer）；用例没开始 = 调度问题。

### 3. 验收测试接驳真实实现（helpers 层切换）
- 黑盒测试从 `helpers/contractHost.mjs` 导入 ROUTER——接驳真实实现只需改 helpers（contractHost 用真实 createCtHandler、contractClient re-export 真实 lib/*），测试文件断言不动。这是 T11 的既定接驳点，不是改测试。
- 接驳后可能暴露"实现与契约"差异（displayPathFor 非默认 home 前缀、prompts 数据源注入）——修实现而不是改测试。

### 4. 真实环境 e2e（playwright + dsh web）
- 独立 profile（composer-e2e）+ 独立端口（3099），不污染用户 web profile。
- 装 profile 必触发 @deepseek-ai 物理复制坑 → 按 AGENTS.md mv 掉，服务才能起（Symbol 单例）。
- 会话 id 从 `dsh.sessions.current` localStorage 取；注入历史 key `dsh-composer-tools:history:<sessionId>` 后需刷新页面让插件重读。
- 真实按键验证 ↑ 回填历史成功——核心交互能在真实浏览器自动化。

### 5. 裁判三轮打回的教训
- 第一轮：只测了逻辑没测真实环境 → 补 e2e。
- 第二轮：e2e 只验加载/RPC，没验真实按键交互 → 补真实按键用例。
- 教训：BRIEF 成功标准里的"真实环境"承诺要兑现成自动化用例，别只靠诚实声明"留给 e2e"。

### 6. 安全审计建议级加固（低成本做了）
- doSave 写前复核 `isSymbolicLink()`（发现与写入之间的 TOCTOU 竞态）——一行防御，审计建议级，顺手修掉。

## 值得沿用的做法
- 纯函数 core（gate/history-core/storage/append/bridgeCore）单独出 node ESM，node --test 直接驱动——验收/单测/调试都方便。
- host 端 error 契约逐字写进 INTERFACE，测试按文案断言，实现与测试天然对齐。
- 独立测试 profile + playwright 验证真实环境，与用户 profile 隔离。
