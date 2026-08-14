# dsh-pet-bridge 对外接口约定

本文件只定义外部契约，不懂实现代码也能照着写测试。任何对外交互（插件装载、推送接线、卸载）都必须遵守这里列出的错误契约。

---

## 1. 插件导出的 cordis 插件接口

`package.json` 的 `main` 指向 `lib/index.js`，导出标准 cordis 插件对象。

### exports

```ts
export const inject: string[]            // 恒为 []
export function apply(ctx: Context): void | (() => void)
```

- `inject`：服务端插件无依赖注入，恒为 `[]`。供 cordis 装载器读取。
- `apply(ctx)`：被 cordis 调用，`ctx` 为插件上下文。执行动作：
  - 订阅 `ctx.on("agent/created", handler)`（payload 形如 `{ agent }`，`agent.session.events` 供读取）。
  - 对已存在 agent 逐个建立观察。
  - 返回一个卸载函数（**必须**）；cordis 卸载时调用它来清全部 timer / 解绑 handler / stop 推送。**若不返回/抛错则视为契约违约。**

### config schema（cordis 配置项）

```ts
interface PetBridgeConfig {
  /** pet HookServer 端口，默认 7779。仅回环 127.0.0.1 生效。 */
  port?: number
  /** 事件轮询间隔（毫秒），默认 250。必需 >0。 */
  pollInterval?: number
  /** 总开关，默认 true。false 时 apply 装载但完全不推送。 */
  enabled?: boolean
}
```

**错误契约：**
- `pollInterval ≤ 0`：`config.ts` 里的 schema 校验失败，cordis 抛装载错误（config 无效不启动 apply）。非法值不静默吞。
- `port` 越界（非 1–65535）：同上，schema 校验失败。
- `enabled=false`：契约上是「正常装载、零推送」，不视为错误。
- 其余字段默认值生效，不做额外抛错。

---

## 2. 推送协议（POST /bubble 的 payload 构造规则）

### 2.1 HTTP 约定

```
POST http://127.0.0.1:{port}/bubble
Content-Type: application/json
Body: { kind, agent_source, tool_name, tool_input, caller_pid }
```

- 仅 127.0.0.1 回环；`caller_pid: process.pid`（dsh 插件进程）。
- **`agent_source` 恒为常量 `"dsh"`**（用户拍板，不可配置、不使用 spike 的 `dsh-spike`）。
- **fire-and-forget**：发送即返回，不 await 结果；收到响应后 `res.destroy()` 关闭连接，避免 socket 堆积。
- **成功率判定**：HTTP 2xx 记为成功；其余（非 2xx / ECONNREFUSED / 网络错误）一律静默降级（见 §2.4）。

### 2.2 事件 → kind / 推送 payload 映射表

| dest db event | → kind | agent_source | tool_name | tool_input |
|---|---|---|---|---|
| `turn/start` | `user` | `"dsh"` | `null` | `null` |
| `tool/call` | `pre` | `"dsh"` | `ev.data.name`（原始工具名） | `summarizeToolInput(ev.data.name, ev.data.arguments)` |
| `tool/result` | `post` | `"dsh"` | `null` | `null` |
| `turn/end` | `stop` | `"dsh"` | `null` | `null` |
| `agent/disposed`（进程退出兜底） | `stop` | `"dsh"` | `null` | `null` |
| `assistant/message` | 不推送 | — | — | — |

**规则说明**
- `tool_name`（tool/call）：传**原始工具名** `ev.data.name`（如 `read`/`bash`/`web_search`），**不再翻译成中文分类文案**（claude codex 同款详细工具气泡）。其余事件恒为 `null`。
- `tool_input`（tool/call）：由 `summarizeToolInput(name, argumentsJSON)` 得出**精简安全摘要**（见 §2.3），或该事件无摘要时为 `null`。其余事件恒为 `null`。
- **进程退出兜底（`agent/disposed`）**：agent 销毁（含 headless 一次性场景进程退出前）时，插件必须监听 `agent/disposed`（payload `{agent}`，与 `agent/created` 同源），对销毁的 agent **补发一条 `kind:"stop"`**（与 `turn/end` 的 stop **相同 payload**），并清理该 agent 的轮询 timer 与 seq 游标。目的：轮询可能来不及捕获最后一个 `turn/end` 就随进程退出，漏发 stop 会让 pet 气泡残留；`agent/disposed` 兜底保证销毁前至少补发一次 stop。
- 未列事件（如 `assistant/message`）**不产生任何推送**。
- 敏感隔离：`tool_input` 仅含 §2.3 的精简摘要（文件名/命令首词/搜索词，≤24 字符）；**完整 `arguments` 从不上外发路径**。不发送任何凭据/密钥/文件内容/settings.yaml 数据。

### 2.3 tool_input 精简安全摘要提取规则表

`summarizeToolInput(name, argumentsJSON)` 从 arguments（JSON 字符串）提取 pet 渲染所需的最小字段。**按工具名分类**，未命中给 `null`（pet 兜底「运行中」）。

| 工具名（`ev.data.name`，前缀/首锚定） | 提取字段 | 规则 |
|---|---|---|
| `read` | `{ file_path }` | `arguments.file_path`（或 `.path`）的 **basename** → pet 显示「读取 foo.ts」 |
| `write` / `edit` / `insert` / `apply_patch` | `{ file_path }` | 同上，`arguments.file_path` 的 basename |
| `bash` / `shell` / `exec` | `{ command }` | `arguments.command`（或 `.cmd`）**空格切第一个词** |
| `grep` / `search` | `{ pattern }` | `arguments.pattern`（或 `.query`），**截断 24 字符** |
| `web_search` | `{ query }` | `arguments.query`，**截断 22 字符** |
| 其余（glob / subagent / workflow / skill / 未知） | `null` | 无摘要，pet 兜底「运行中」 |

**序列化 / 边界规则**
- 所有提取值**额外截断到 ≤24 字符**（含 basename / 命令首词 / pattern / query）。
- basename：`file_path` 取末段（`/a/b/foo.ts` → `foo.ts`）；命令首词 = `command.trim()` 后按空格切第一个词。
- 提取的对象值缺省 / 非字符串 → 该字段回 `null`。
- 按工具名**前缀匹配**，命中即用；未命中表项 → `null`。

**错误契约**：任何 `(name, argumentsJSON)` 组合都返回 `object | null`（摘要对象或 `null`），不抛错。`argumentsJSON` 解析失败（非法 JSON）→ 返回 `null`。**绝不外发完整 `arguments`**。

### 2.4 错误降级契约

| 情况 | 行为（契约） |
|---|---|
| pet 未运行（ECONNREFUSED） | 记 1 条 debug 日志，不重试、不向上抛、**不影响 dsh 事件处理** |
| 推送非 2xx | 同上静默降级 |
| `agent.session.events` 缺失 | 该次轮询 tick 跳过 |
| config.enabled=false | 零推送，但插件正常装载 |

所有降级路径**不得抛出到 `apply` 之外**，不得影响 dsh 主流程。

**turn/end 缺失契约**：LLM 中途放弃（无 `turn/end`）时气泡可能停在工具名——**dsh 侧不做超时控制（auto-stop，YAGNI）**，气泡恢复依赖 pet 侧行为（见 PLAN §4.3 #1 spike 验证 pet 的 stop/超时行为）。

---

## 3. 部署 / 卸载接口

### 3.1 包声明

`package.json`：
- `name: "dsh-pet-bridge"`，`main: "lib/index.js"`，`private: true`（不上 npm）。
- `dsh.bundle.patch: "./cordis.patch.yml"`，声明 bundle patch（对照 dsh-turn-scrubber 的 `dsh.bundle.patch`）。

`cordis.patch.yml`（bundle patch）：
```yaml
- insert:
    - id: pet-bridge
      name: 'dsh-pet-bridge'
```

**依赖声明**：无第三方运行时依赖；`peerDependencies` 可选声明与 `@deepseek-ai/cordis` 的对应主版本一致（cordis 插件与主程序同树，见 AGENTS.md 的 Symbol 单例注意）。不要 `pnpm add` 第三方库。

### 3.2 部署流程（web profile）

1. 从 `packages/pet-bridge` 建 symlink 进 `~/.dsh/profiles/node_modules/`：`dsh-pet-bridge` → `packages/pet-bridge`（node_modules 解析链已含该目录）。
2. 在 `~/.dsh/profiles/web/` 用 `dsh plugin --profile web add` 或在 profile 的 bundle 栈/patch overlay 声明 `pet-bridge` 条目。
3. **改 profile 的 bundle 栈 / patch overlay / package.json 属配置文件修改 —— 需用户同意**（BRIEF 边界约束）。`--patch` 用 `insert` 语法：`- insert: [{id, name}]`。
4. 装载是否成功：profile 日志出现插件 loaded 标记，且无 schema / apply 抛错。

### 3.3 卸载流程

1. 从 profile 的 bundle patch overlay 移除 `pet-bridge` insert 条目（等价于恢复 patch）。
2. `mv` 掉 `~/.dsh/profiles/node_modules/dsh-pet-bridge`（**不是** `rm -rf`，保留可回退）。
3. cordis 卸载触发 `apply` 返回的卸载函数，清 timer / 解绑 / stop 推送。
4. 留痕：卸载用 `mv` 保证可回退；恢复 = `mv` 回去 + 加回 patch 条目。

---

## 附录：测试可对照的断言

- `apply` 返回类型是函数（可调用）。
- `config.pollInterval≤0` 装载失败；`enabled=false` 装载成功且零推送。
- 对 `{agent:{session:{events:[{seq:1,type:'tool/call',data:{name:'bash_bar' ,arguments:'{"command":"ls -la"}'}},{seq:2,type:'turn/end',...}]}}}` 的 agent 喂入：产生一次 `pre` 推送、`tool_name`=`'bash_bar'`（原始名）、`tool_input`=`{command:'ls'}`。
- `read` + `arguments:'{"file_path":"/a/b/foo.ts"}'` → `tool_input`=`{file_path:'foo.ts'}`。
- `web_search` + `arguments:'{"query":"<23 字符>"}'` → `tool_input`=`{query:'<截断 22 字符>'}`。
- 未知工具名（如 `frobnicateX`）→ `tool_name`=`'frobnicateX'`，`tool_input`=`null`。
- 非法 JSON 的 `arguments` → `tool_input`=`null`，不抛错。
- 非 tool/call 事件（turn/start/result/end/disposed）`tool_input` 恒 `null`；`tool_name` 恒 `null`。
- 所有外发字段 ≤24 字符；**完整 `arguments` 从不出现**在外发 payload。
- 无监听端口时推送不抛异常到调用方。
