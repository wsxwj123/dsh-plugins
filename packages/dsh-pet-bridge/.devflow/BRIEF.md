# dsh-pet-bridge

让 cc-pet 桌面宠物的气泡实时显示 dsh（DeepSeek Harness）会话状态。

## 需求（BRIEF 定稿）

### 要解决的问题
用户同时使用 dsh web（网页 GUI 干开发/写作）和 cc-pet（桌面宠物）。
dsh 干活时（读文件、跑命令、搜索、思考），pet 气泡无任何显示——两者没有通道。
用户要求：dsh 跑任务时，pet 头顶气泡实时显示 dsh 正在干什么。

### 功能清单
1. dsh 会话发生工具调用时，pet 气泡显示 `dsh · <原始工具名> · <摘要>`（claude codex 同款详细工具气泡，如「读取 foo.ts」「bash ls」）——`tool_name` 传原始工具名，`tool_input` 传精简安全摘要
2. 回合开始显示「思考中」，回合结束显示「完成」后消失
3. 支持 dsh web profile 下所有会话（用户主要使用场景）
4. 不影响 dsh 自身行为；可随时卸载

### 成功标准
- 在 dsh web 里发起一个会调用工具的任务（如「列出当前目录」），pet 气泡依次显示：思考中 → 工具名 → 完成
- 推送延迟 ≤ 1 秒（工具调用发生到气泡更新）
- 卸载插件后 dsh 完全恢复正常（无残留）

### 非目标（明确不做）
- 不做 pet 到 dsh 的反向控制（点气泡跳转 dsh 窗口，依赖 caller_pid 与 ps 解析，spike 阶段先不做，仅传 caller_pid 保留能力）
- 不做会话级聚合（多会话并发时取最新活跃会话即可，先不做复杂合并）
- 不发布到 npm，仅本机使用

### 敏感面声明
- 插件只读 dsh 会话事件（工具名、工具参数、消息文本），只写 pet 的 127.0.0.1:7779
- 工具参数可能含敏感内容（命令、路径、用户数据）——`tool_input` 仅发精简安全摘要（文件名/命令首词/搜索词，≤24 字符）且仅本机回环；**完整工具参数绝不上外发路径**
- 不读取/不发送任何凭据、密钥、settings.yaml 内容
- 所有网络通信仅本机回环 127.0.0.1

### 技术事实（spike 已验证）
- dsh 服务端插件经 `--patch` insert 或 profile bundles 装载，cordis 插件形态（inject + apply）
- `ctx.on("agent/created")` 拿到 agent 实例；轮询 `agent.session.events` 增量可实时拿到 `turn/start` / `tool/call`（data.name + data.arguments）/ `tool/result` / `turn/end` / `assistant/message`
- pet HookServer：`POST http://127.0.0.1:7779/bubble`，body `{kind: pre|post|user|stop, agent_source, tool_name, tool_input, caller_pid}`，无 CORS（仅本机进程可发）
- agent_source 传任意字符串（气泡显示名），如 `dsh`
- headless profile 可作测试环境（每次新进程，不打断 web）

### 边界与约束
- 运行环境：macOS，本机 dsh（~/.dsh/profiles/web）+ cc-pet（/Applications/cc-pet.app）
- 插件部署：`~/Desktop/claude/dsh-plugins/packages/pet-bridge`，link 进 web profile（参照 dsh-turn-scrubber 的部署方式），改 profile package.json 属配置文件修改，需用户同意
- pet 未运行 / 7779 无监听时：插件静默降级（不报错、不影响 dsh），可配置开关
