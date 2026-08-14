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
| `tool/call` | `pre` | `"dsh"` | `toolLabels(ev.data.name)` | `null` |
| `tool/result` | `post` | `"dsh"` | `null` | `null` |
| `turn/end` | `stop` | `"dsh"` | `null` | `null` |
| `assistant/message` | 不推送 | — | — | — |

**规则说明**
- `tool_name`：永远是 `toolLabels(ev.data.name)` 的**中文文案**，且**恒为字符串**（映射兜底「执行中」，见 §2.3）。
- `tool_input`：**恒为 `null`（所有事件）**——气泡只需要工具名文案，任何参数（命令全文/路径/密钥）一概不上外发路径，不外发即无泄漏面。
- 未列事件（如 `assistant/message`）**不产生任何推送**。
- 敏感隔离：只发工具**名**映射文案；`tool_input` 恒 `null`，不发送任何参数、凭据/密钥/文件内容/settings.yaml 数据。

### 2.3 工具名 → 中文文案映射规则表（开放集合的统一定义）

先匹配到即用，未命中给兜底。**禁止逐具体工具枚举。**

| 匹配规则（对 `ev.data.name`，**均首锚定+词边界，禁裸分支**） | 结果文案 |
|---|---|
| `^read\|^grep\|^glob\|^list\|^search\|(^\|[_-])search$` | `读取中` |
| `^write\|^edit\|^apply_patch\|^insert` | `写入文件` |
| `^bash\|^exec\|^run\|^command\|^shell` | `运行命令` |
| `^web_search\|^http\|^fetch\|^request\|^curl` | `联网检索` |
| `^subagent\|^agent\|^workflow\|^skill` | `编排任务` |
| （兜底，无条件命中） | `执行中` |

> 锚定规范：所有分支词首或带词边界，**禁止裸 `\|search` 之类可能 part-match 的写法**（如 `supersearch` 不得命中搜索类）。测试须含「意外 part-match 用例」。

序列化规则：正则**按表从上到下**做 `new RegExp(...).test(name)`；首个命中即返回对应文案；**恒有兜底**，因此 `tool_name` 永远非空字符串。

**错误契约**：任何 name 都返回非空字符串，不抛错、不返回 `undefined`。

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
- 对 `{agent:{session:{events:[{seq:1,type:'tool/call',data:{name:'bash_bar' ,arguments:'{}'}},{seq:2,...}]}}}` 的 agent 喂入：产生一次 `pre` 推送、`tool_name`=「运行命令」。
- 未知工具名（如 `frobnicateX`）推送 `tool_name`=「执行中」。
- **意外 part-match**：`supersearch`、`nonsearch` 不命中搜索类（走兜底「执行中」）；`run_all` 命中命令类「运行命令」。
- 所有事件推送的 `tool_input` 恒为 `null`（含 `tool/call`）。
- 无监听端口时推送不抛异常到调用方。
