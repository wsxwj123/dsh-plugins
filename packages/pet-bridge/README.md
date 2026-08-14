# dsh-pet-bridge

**dsh（DeepSeek Harness）↔ [cc-pet](https://github.com/wsxwj123/cc-pet) 桌面宠物状态桥**

让桌面宠物头顶的气泡实时显示 dsh 正在干什么——和 claude code / codex 一样的效果：

```
dsh 会话事件流 ──► pet-bridge 插件 ──► cc-pet HookServer (127.0.0.1:7779) ──► 宠物气泡
   turn/start        (挂在 dsh 进程里)        POST /bubble                       dsh · 读取 README.md
   tool/call
   turn/end
```

## 这是给谁用的

本插件**是 cc-pet 项目（桌面宠物）的配套**：pet 本身不认识 dsh，这个插件在 dsh 侧监听会话事件、翻译成 pet 能懂的推送协议，把状态送到宠物气泡上。

- 前置条件：本机已安装 **cc-pet**（`/Applications/cc-pet.app`，监听 `127.0.0.1:7779`）+ **dsh**
- pet 端代码**不需要任何修改**（HookServer 是通用接口）
- 本插件只装在 dsh 侧，卸载不影响 pet

## 气泡效果

| 阶段 | 气泡显示 |
|---|---|
| 回合开始 | `dsh · 思考中…` |
| 工具调用 | `dsh · 读取 README.md` / `dsh · 运行 pwd` / `dsh · 搜索 xxx` |
| 工具返回 | `dsh · 已读 README.md`（pet 自动转过去式） |
| 回合结束 | `dsh · 完成`（1.5 秒后消失） |
| pet 不认识的工具 | `dsh · 运行中…` |

## 安全边界

- **完整工具参数绝不上外发路径**：只提取最小摘要（文件名 basename / 命令首词 / 搜索词，≤24 字符）
- 全部通信仅本机回环 `127.0.0.1:7779`
- 不读凭据、不碰文件系统、不改 pet 任何配置
- pet 没开时插件静默降级，不影响 dsh 任何功能

## 安装（dsh web profile）

```bash
# 1. 把本包 link 进 web profile 的依赖解析链
ln -sfn /path/to/dsh-plugins/packages/pet-bridge ~/.dsh/profiles/web/node_modules/dsh-pet-bridge

# 2. 在 ~/.dsh/profiles/web/package.json 加：
#    dependencies:  "dsh-pet-bridge": "link:/path/to/dsh-plugins/packages/pet-bridge"
#    dsh.profile.bundles: "dsh-pet-bridge"（参照同仓 turn-scrubber 的部署方式）

# 3. 重启 dsh web 生效
```

⚠️ 不要在该 profile 里跑 `pnpm install` / `dsh plugin add`（会把官方 `@deepseek-ai/*` 包复制成物理副本导致工具调用全部报错，详见 ~/.dsh/AGENTS.md）。

## 配置

cordis 插件配置（默认值即可用）：

```jsonc
{
  "port": 7779,          // pet HookServer 端口（仅回环）
  "pollInterval": 250,   // 事件轮询间隔 ms（>0）
  "enabled": true        // 总开关，false 时零推送
}
```

## 卸载

1. 从 web profile 的 package.json 移除依赖与 bundles 条目
2. `mv ~/.dsh/profiles/web/node_modules/dsh-pet-bridge ~/...`（用 mv 保留可回退）
3. 重启 dsh web

## 测试

```bash
node --test --test-force-exit 'tests/acceptance/*.test.js'   # 契约验收测试（43 条，快）
node --test 'tests/unit/*.test.js'                           # 白盒单测（26 条）
node --test 'tests/e2e/*.test.mjs'                           # 真实 cordis 环境 e2e（约 11 秒，改代码后必跑）
```

> e2e 在真实 dsh headless 里加载插件跑任务（含真实模型调用），断言推送 payload 与
> 推送失败不崩——测试替身模拟不到的 cordis 语义（inject 约束、callable logger this 绑定）
> 由它把关。前置：本机 dsh 可用、`~/.dsh/profiles/node_modules/dsh-pet-bridge` symlink 存在。

## 工作原理（简版）

- 插件订阅 `agent/created` / `agent/disposed` 事件，对每个会话按 250ms 增量轮询 `session.events`
- 事件映射：`turn/start→user`、`tool/call→pre`（原始工具名 + 精简摘要）、`tool/result→post`、`turn/end→stop`、`agent/disposed→stop`（进程退出兜底）
- 推送协议与 pet 内置 provider 完全一致（`POST /bubble`，五字段 payload），pet 端自动复用它的气泡渲染
