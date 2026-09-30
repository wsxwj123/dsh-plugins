# 调研：`ctx.connection.rpc.handle()` 在 0.2 下为何要求 `webServer`，正确修法

> 目标宿主：DeepSeek Harness 桌面版 **0.2.0-rc.2**（asar）
> 对照旧版：**0.1.5-rc.2**（npm-global 普通文件）
> 结论性质标注：**已证实** = 从源码逐行读到；**推测** = 需最小实验确认（附验证方法）。

---

## 0. 结论速览（TL;DR）

1. **根因**：0.2 的 `rpc.handle()` → `register()` 在 `dsh-client-connection/lib/index.js:656` **无条件**读 `owner.webServer`，而 `owner` 经 cordis 的 `createTraceable` 机制被解析成「**调用方上下文**」（不是 connection 插件自己的上下文），所以**调用方**必须注入 `webServer`。turn-scrubber 的 `inject` 里没有 `webServer`，cordis 在 `cordis/lib/index.js:676` 抛 `cannot get property "webServer" without inject`。

2. **最小修法**：把 `'webServer'` 加进 turn-scrubber 的 `inject` 数组即可（源码依据充分，见 §2）。0.2 已无官方插件再用 `rpc.handle`，但它是「专用 RPC 通道」的唯一注册 API，turn-scrubber 的客户端 `connection.rpc.call('/turn-scrubber', …)` 正需要它，**不需要换 API**。

3. **0.1.5 不会报错**：旧版 `register` 用的是 `(this.webCtx ?? owner).webServer`（`0.1.5 …/lib/index.js:618`），有 `this.webCtx` 回退，调用方无需注入 `webServer`；把 `webServer` 加进 inject 在 0.1.5 上也**不会报错**（向后兼容，见 §3）。

4. **影响面**：turn-scrubber 的 `src/` 里**唯一的未声明服务裸访问**，就是 `rpc.handle` 内部对 `webServer` 的传递读取；其余 `ctx.*` 全部命中已声明服务（§4）。

---

## 1. 问题 1：0.2 读 `webServer` 的位置与机制

### 1.1 直接读点：`register()` 第 656 行（已证实）

文件：`app.asar/dsh/node_modules/@deepseek-ai/dsh-client-connection/lib/index.js`
（已提取到 `/tmp/asar_out/dsh__node_modules__@deepseek-ai__dsh-client-connection__lib__index.js`）

```js
// line 640-657
register(owner, channel, handler) {
    assertChannel(channel);
    const fetchHandler = rpcFetchHandler(channel, handler, this.operator);
    const route = {
        kind: "prefix",
        path: channel,
        handler: async (req, res) => { /* …admit + bridge… */ }
    };
    return owner.effect(() => owner.webServer.register(route), `client-connection: ${channel} rpc channel`); // ← 656 行
}
```

`owner.webServer` 就是报错栈里 `index.js:656` 的那一步：`cannot get property "webServer" without inject`。

### 1.2 `owner` 从哪来：`get rpc()` 捕获 `this.ctx`（已证实）

```js
// line 572-579
get rpc() {
    const owner = this.ctx;                                        // ← 573/574 行
    return {
        handle: (channel, handler) => this.register(owner, channel, handler), // ← 576 行（栈里的 Object.handle）
        intercept: (channel, matches, handler) => this.registerInterceptor(owner, channel, matches, handler)
    };
}
```

### 1.3 关键：`this.ctx` 是「调用方上下文」，不是 connection 插件自己的上下文（已证实）

这是 cordis 的 `getTraceable` / `createTraceable` 机制：**服务实例被 `ctx.connection` 读到时会套一层代理，代理把实例的 `ctx` 属性覆写为「读它的那个上下文」**。

文件：`app.asar/dsh/node_modules/@deepseek-ai/cordis/lib/index.js`

```js
// line 123-129  createTraceable
const proxy = new Proxy(value, {
    get: (target, prop, receiver) => {
        if (prop === symbols.original) return target;
        if (prop === tracker.property) return ctx;   // ← 128 行：读 `.ctx` 时返回「调用方 ctx」
        ...
```

而每个 `Service` 实例在构造时都被打上 `tracker = { …, property: "ctx" }`：

```js
// line 1770-1783  Service 构造函数
constructor(ctx, name) {
    this.ctx = ctx;
    name ??= this.constructor["provide"];
    let self = this;
    const tracker = { associate: name, property: "ctx" };   // ← property 恒为 "ctx"
    ...
    self.ctx = ctx;
    self.name = name;
    defineProperty(self, symbols.tracker, tracker);
    self.ctx.reflect.provide(name, self, this[symbols.check]);
    return self;
}
```

报错本体在 cordis 的 `ReflectService.handler.get`：

```js
// line 672-676
static handler = {
    get: (target, prop, ctx) => {
        if (isSpecialProperty(prop)) return Reflect.get(target, prop, ctx);
        if (Reflect.has(target, prop)) return getTraceable(ctx, Reflect.get(target, prop, ctx));
        const error = new Error(`cannot get property "${prop}" without inject`); // ← 676 行：栈里的报错文案
        ...
```

**链条**：turn-scrubber 执行 `ctx.connection.rpc.handle('/turn-scrubber', …)`
→ `ctx.connection` 经 `getTraceable` 返回代理，代理把 `this.ctx` 覆写为 **turn-scrubber 的 ctx**
→ `get rpc()` 里 `owner = this.ctx` = turn-scrubber 的 ctx
→ `register()` 里 `owner.webServer` = 在 turn-scrubber 的 ctx 上裸访问 `webServer`
→ turn-scrubber 的 `inject = ['connection','sessionPersistence','sessions']` 不含 `webServer`
→ cordis 抛 `cannot get property "webServer" without inject`。

> 这也解释了为什么 connection 插件**自己**的 `inject`（`index.js:798 const inject = ["credentials"]`）不需要含 `webServer`：它自己直接访问时用的是自己的 ctx，只有把服务交给「别的插件」时，`this.ctx` 才会被覆写成那个插件的 ctx。

---

## 2. 问题 2：最小正确修法

### 2.1 把 `'webServer'` 加进 inject 数组就够（已证实）

依据：`register()` 只需要 `owner.webServer` 能被解析，而 `owner` = 调用方上下文。调用方注入 `webServer` 后，`owner.webServer` 就命中由 `dsh-host-webserver` 提供的服务。

文件：`app.asar/dsh/node_modules/@deepseek-ai/dsh-host-webserver/lib/index.js`

```js
// line 139 + 158
var WebServer = class extends Service {
    ...
    constructor(ctx, config) {
        super(ctx, "webServer");   // ← 158 行：服务名就叫 "webServer"
```

```js
// line 177-184：register(route) 收 {kind, path, handler}，正好接住 rpc.handle 造的 route
register(route) {
    const table = route.kind === "exact" ? this.exact : this.prefixes;
    if (table.has(route.path)) throw new Error(`webserver: duplicate ${route.kind} route "${route.path}"`);
    table.set(route.path, route);
    return () => { table.delete(route.path); };
}
```

所以「加 `'webServer'` 到 inject」是**充分**的：`owner.webServer` 解析到 `WebServer` 实例，`.register(route)` 正常注册 `/turn-scrubber` 前缀路由。

### 2.2 0.2 是否已不推荐 `rpc.handle`？（已证实 + 推测）

**已证实**：对 0.2 asar 内全部 **285 个 `@deepseek-ai/*` 包的 `lib/index.js`** 做了检索：

- `rpc.handle`（含 `.rpc.handle`）**零处**被官方插件调用（只有 `dsh-client-connection` 自己定义它）。
- 官方插件只用两种替代方式：
  1. 共享 `/api` 通道用 **`rpc.intercept`**（**不**需要 `webServer`）：

     文件：`app.asar/…/dsh-api-gateway/lib/index.js:623-624`
     ```js
     ctx.inject(["connection"], (connectionCtx) => {
         connectionCtx.connection.rpc.intercept("/api", (endpoint) => this.claimsEndpoint(endpoint), (endpoint, payload, signal, peer) => this.dispatchRpc(endpoint, payload, signal, peer));
     });
     ```
  2. 需要 `webServer` 时，用 **`ctx.inject(["connection", "webServer"], cb)`** 或顶层 `inject` 同时声明两者：

     文件：`app.asar/…/dsh-api-gateway/lib/index.js:626` 与 `:642`
     ```js
     ctx.inject(["connection", "webServer"], (webCtx) => {
         ...
         yield webCtx.webServer.registerUpgrade(route);   // 642 行
     });
     ```
     文件：`app.asar/…/dsh-host-frontend-static/lib/index.js:21`
     ```js
     const inject = ["webServer", "connection"];
     ```

**结论**：`rpc.handle` 本身**没有弃用标记**（源码/README 都无 deprecation 字样），它仍是「专用 RPC 通道」（host 端 `rpc.handle` ↔ client 端 `connection.rpc.call(channel, endpoint, …)`，见 0.2 `dsh-client-connection/lib/client.js:1209-1212`）的唯一官方注册入口。turn-scrubber 的客户端正是 `connection.rpc.call('/turn-scrubber', 'turnIndex', …)`，所以**无需换 API**，只需补 inject。

> **推测**（未完全证实）：`rpc.handle` 是否被官方「边缘化」无法从源码 100% 断定，只能说「0.2 官方插件已无使用」。最小验证：`grep -rn "rpc.handle\|\.rpc\.handle" dsh/`（asar 解出后全树检索）或看 `dsh-client-connection` 的 CHANGELOG 是否有移除/弃用说明；没有就按「仍可用」处理。

### 2.3 附带发现：第三个参数 `{ authority: 'loopback' }` 是死参数（已证实）

0.2 与 0.1.5 的 `handle` 签名都是**两个参数** `(channel, handler)`，第三个参数被静默忽略：

```js
// 0.2 index.js:576
handle: (channel, handler) => this.register(owner, channel, handler),
```

turn-scrubber `src/index.ts:141` 传入的 `{ authority: 'loopback' }` 在 0.1.5/0.2 均不生效（类型声明 `src/index.ts:55-59` 里的 `options` 是旧 API 残留）。建议一并删掉，避免误导。

---

## 3. 问题 3：这个修法在 0.1.5 上会不会反而不报错

### 3.1 旧版 `register` 有 `this.webCtx` 回退，调用方**本就不需要**注入 webServer（已证实）

文件：`/Users/wsxwj/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-connection/lib/index.js`

```js
// line 602-618
register(owner, channel, handler) {
    assertChannel(channel);
    const fetchHandler = rpcFetchHandler(channel, handler);
    const route = { /* … */ };
    return owner.effect(() => (this.webCtx ?? owner).webServer.register(route), `client-connection: ${channel} rpc channel`); // ← 618 行
}
```

`this.webCtx` 由 connection 插件自己在 `apply` 里注入 webServer 时挂上：

```js
// line 757-759
const connection = new HostConnectionService(ctx, trustedHosts, await BrowserAuth.create(/* … */));
ctx.inject(["webServer"], (webCtx) => {
    connection.webCtx = webCtx;   // ← 759 行
```

所以 0.1.5 里 `(this.webCtx ?? owner)` 优先用 connection 插件自己的 webCtx，`owner`（调用方）根本不会被读 webServer。这就是 turn-scrubber 在 0.1.5 能正常跑、在 0.2 挂掉的分界点：**0.2 把 `this.webCtx` 回退删掉了**（0.2 的 `apply` 已无 `connection.webCtx = …`，`register` 变成 `owner.webServer`）。

### 3.2 加 `webServer` 进 inject 在 0.1.5 也不会报错（已证实）

- 0.1.5 的 `dsh-host-webserver` 同样提供 `webServer` 服务名：
  文件：`…/dsh-host-webserver/lib/index.js:157` → `super(ctx, "webServer")`。
- 0.1.5 的 cordis 同样有 `createTraceable` 覆写机制：
  文件：`…/cordis/lib/index.js:128` → `if (prop === tracker.property) return ctx;`。

因此 inject 里多一个已存在的 `webServer` 服务，只会让 `owner.webServer` 也可解析，与旧版的 `this.webCtx` 回退**并存不冲突**。结论：**这个改法在 0.1.5 上安全，双向兼容**。

---

## 4. 问题 4：turn-scrubber `src/` 裸访问未声明服务普查

对 `packages/dsh-turn-scrubber/src/` 全量 `grep` 了 `ctx.` / `ctx[` / `.get(` / `.inject`。结果如下。

### 4.1 Node 半（`src/index.ts`，`inject = ['connection','sessionPersistence','sessions']`，第 22 行）

| 位置 | 代码 | 服务 | 判定 |
|---|---|---|---|
| `src/index.ts:94` | `ctx.sessions.get(sessionId)` | `sessions` | ✅ 已声明 |
| `src/index.ts:103` | `const persistence = ctx.sessionPersistence` | `sessionPersistence` | ✅ 已声明 |
| `src/index.ts:141` | `ctx.connection.rpc.handle('/turn-scrubber', …)` | `connection`（声明）→ 内部读 `webServer`（**未声明**） | ❌ **本 bug** |

第 141 行是唯一出问题处：`connection` 本身声明了，但 `rpc.handle` 内部对 `webServer` 的传递读取，把「调用方必须注入 webServer」的要求压到了 turn-scrubber 头上。

### 4.2 Client 半（`src/client/index.tsx`，`inject = ['sessions','connection']`，第 28 行）

| 位置 | 代码 | 服务 | 判定 |
|---|---|---|---|
| `src/client/index.tsx:66` | `const sessions = ctx.sessions` | `sessions` | ✅ 已声明 |
| `src/client/index.tsx:67` | `const connection = ctx.connection` | `connection` | ✅ 已声明（客户端 `connection.rpc.call`，不经 host `rpc.handle`） |
| `src/client/index.tsx:202` | `ctx.effect(() => () => { … })` | `effect` | ✅ 核心属性，永可裸访问 |

### 4.3 其它文件：无 ctx 服务访问（已证实）

`src/turn-index.ts`、`src/client/hostIndex.ts`、`src/client/ensureTurnLoaded.ts`、`src/client/TurnRail.tsx`、`src/client/context-types.ts` 均只做纯函数/类型声明，无 `ctx.` 服务裸访问（`context-types.ts:109` 的 `slots: unknown` 只是类型字段，非运行时访问）。

**普查结论**：除 §4.1 第 141 行引发的 `webServer` 传递读取外，**没有第二处**未声明服务裸访问。同一类 bug 目前只此一处。

---

## 5. 建议改法（含 diff 骨架）

### 5.1 最小正确改法（推荐）

`packages/dsh-turn-scrubber/src/index.ts`：

```diff
- export const inject = ['connection', 'sessionPersistence', 'sessions']
+ export const inject = ['connection', 'sessionPersistence', 'sessions', 'webServer']
```

并顺手清掉死参数（可选，见 §2.3）：

```diff
  export function apply(ctx: NodeContext): void {
-   ctx.connection.rpc.handle('/turn-scrubber', turnIndexHandler(ctx), { authority: 'loopback' })
+   ctx.connection.rpc.handle('/turn-scrubber', turnIndexHandler(ctx))
  }
```

同时把 `src/index.ts:55-59` 里 `handle` 的类型签名改成 0.2 的真实二参签名（删掉 `options`）：

```diff
    handle(
      channel: string,
      handler: (endpoint: string, payload: unknown, signal?: AbortSignal) => unknown,
-     options?: { authority?: 'loopback' | 'trusted' },
    ): unknown
```

> 说明：`webServer` 服务在桌面宿主里由 `dsh-host-webserver` 恒定提供（见 §2.1），注入它是把「可选依赖」变「必选依赖」——对本插件场景（宿主必然起 web 服务）是可接受的。若未来要在无 webServer 的 headless 组合里加载本插件，需改成 §5.2 的可选写法。

### 5.2 备选：显式子上下文注入（对齐官方 `dsh-api-gateway` 写法）

若担心 `webServer` 在极端组合里缺失，可用「注入子上下文」显式表达依赖，语义更清晰：

```diff
- export const inject = ['connection', 'sessionPersistence', 'sessions']
+ export const inject = ['connection', 'sessionPersistence', 'sessions']
  export function apply(ctx: NodeContext): void {
-   ctx.connection.rpc.handle('/turn-scrubber', turnIndexHandler(ctx), { authority: 'loopback' })
+   ctx.inject(['webServer'], (webCtx) => {
+     webCtx.connection.rpc.handle('/turn-scrubber', turnIndexHandler(ctx))
+   })
  }
```

依据：0.2 `dsh-api-gateway/lib/index.js:626` 正是 `ctx.inject(["connection", "webServer"], (webCtx) => { … webCtx.webServer.… })` 的官方写法。注意此时必须用 `webCtx.connection`（让 `this.ctx` 覆写为 `webCtx`），不能继续用外层 `ctx.connection`。

> 二者选一即可。对本插件，**5.1 更短且与 0.1.5 双向兼容**，是首选。

### 5.3 验证方式（最小实验）

1. 改 `inject` 后重新构建 `dsh-turn-scrubber`，装入 0.2.0-rc.2 宿主，观察启动不再抛 `webServer without inject`，且浏览器端 `connection.rpc.call('/turn-scrubber','turnIndex',…)` 能返回 `{ok:true, value:{total,…}}`。
2. 回退到 0.1.5 宿主再加载一次，确认不报「webServer」相关错误（§3 已论证安全，此步做回归确认）。
3. `grep -rn "webServer without inject"` 于宿主日志，确认无同类残留。

---

## 附录：证据文件清单

| 版本 | 文件 | 关键行 |
|---|---|---|
| 0.2 | `app.asar/dsh/node_modules/@deepseek-ai/dsh-client-connection/lib/index.js` | 573/576（get rpc + handle）、640/656（register 读 webServer）、798（inject=credentials）、820/843（自注入 webServer 挂 /api） |
| 0.2 | `app.asar/dsh/node_modules/@deepseek-ai/cordis/lib/index.js` | 84（getTraceable）、128（tracker.property→ctx）、676（without inject 报错）、1770-1783（Service tracker） |
| 0.2 | `app.asar/dsh/node_modules/@deepseek-ai/dsh-host-webserver/lib/index.js` | 158（super ctx "webServer"）、177-184（register route） |
| 0.2 | `app.asar/dsh/node_modules/@deepseek-ai/dsh-api-gateway/lib/index.js` | 623-626（官方 connection+webServer 注入范例）、642 |
| 0.2 | `app.asar/dsh/node_modules/@deepseek-ai/dsh-host-frontend-static/lib/index.js` | 21（`inject=["webServer","connection"]`） |
| 0.2 | `app.asar/dsh/node_modules/@deepseek-ai/dsh-client-connection/lib/client.js` | 1209-1212（client 端 rpc.call） |
| 0.1.5 | `/Users/wsxwj/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-connection/lib/index.js` | 618（`(this.webCtx ?? owner).webServer`）、758-759（挂 webCtx） |
| 0.1.5 | `…/dsh-host-webserver/lib/index.js` | 157（super ctx "webServer"） |
| 0.1.5 | `…/cordis/lib/index.js` | 128（同样 createTraceable 覆写） |
| 插件 | `/Users/wsxwj/Desktop/app/dsh-plugins-wt-0.2/packages/dsh-turn-scrubber/src/index.ts` | 22（inject）、94/103/141（ctx 访问）、55-59（handle 旧签名） |
| 插件 | `/Users/wsxwj/Desktop/app/dsh-plugins-wt-0.2/packages/dsh-turn-scrubber/src/client/index.tsx` | 28（inject）、66/67/202（ctx 访问） |
