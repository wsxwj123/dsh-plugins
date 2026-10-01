# RESEARCH — dsh-turn-scrubber 在 0.2.0-rc.2 注册专有 RPC 通道的根因与最小修法

> 调研代理结论报告。只读调研，未改任何仓库代码（仅写了本报告与 /tmp 下的临时验证夹具，验证后已清理）。
> 本报告**推翻** `.devflow/INTERFACE-dsh-0.2-adapt.md` §1.1/§1.3 的旧假设——「给插件 inject 加 `webServer` 即可」是**错的**（前一轮 5 次尝试已证伪），正确修法是**不用 `rpc.handle`，改用 `ctx.webServer.register` 手写同形路由**。

---

## 0. 结论（先给）

1. **能不能在插件侧修好？——能。** 不需要改宿主，也不需要改客户端契约（客户端 `connection.rpc.call('/turn-scrubber','turnIndex',…)` 一字不动）。
2. **根因**：`dsh-client-connection` 在 0.2 把 `register()` 从 0.1.5 的 `(this.webCtx ?? owner).webServer.register(route)` 改成了 `owner.webServer.register(route)`。而 `owner` 是 cordis 的「影子上下文」（`symbols.shadow` 指向 connection 插件自己的 ctx），它读任何服务都从 **connection 插件的 fiber**（`inject=['credentials']`，不含 `webServer`）开始解析，所以 `owner.webServer` **必然**抛 `cannot get property "webServer" without inject`。给调用方插件加 `webServer` 注入**永远救不了**——影子的 fiber 重定向绕过调用方。
3. **`rpc.handle` 是宿主缺陷（回归）**：0.2 官方代码**没有任何一处**用 `rpc.handle` 挂专有通道（只定义、不调用）。官方挂路由的三条路是：`ctx.inject(['webServer'], cb)` + `webCtx.webServer.register(...)`、`rpc.intercept('/api', …)`（仅 api-gateway）、`ctx.connection.fetch.register({path:'/api/…',…})`。
4. **推荐修法（c）**：`ctx.effect(() => ctx.webServer.register({kind:'prefix', path:'/turn-scrubber', handler}))`，handler 内手工复刻 `rpc.handle` 的信封解析/应答 + `ctx.connection.requestRejection(req)` 的 trust fence。真机验证通过（见 §5）。
5. **双版本**：用 `requestRejection`（0.1.5 与 0.2 都有）而非 0.2 新增的 `admit`，修法在 0.1.5 上不报错。
6. **影响面**：只有**第三方插件用 `rpc.handle` 挂专有通道**才踩到；官方代码不踩（它压根不用 `rpc.handle`）。

---

## 1. 0.2 `rpc` 通道是怎么组织的（Q1）

源码（0.2.0-rc.2，从 app.asar 提取）：
`app.asar/dsh/node_modules/@deepseek-ai/dsh-client-connection/lib/index.js`（共 850 行）。

### 1.1 `get rpc()`（第 572–579 行）

```js
/** Generic channel registry scoped to the Context reading this service. */
get rpc() {
  const owner = this.ctx;                                    // ← this 是影子，见 §1.6
  return {
    handle: (channel, handler) => this.register(owner, channel, handler),
    intercept: (channel, matches, handler) => this.registerInterceptor(owner, channel, matches, handler)
  };
}
```

### 1.2 `register()`（第 640–657 行）—— 缺陷现场

```js
register(owner, channel, handler) {
  assertChannel(channel);
  const fetchHandler = rpcFetchHandler(channel, handler, this.operator);
  const route = {
    kind: "prefix",
    path: channel,
    handler: async (req, res) => {
      const admission = this.admit(req);
      if ("rejection" in admission) {
        res.writeHead(admission.rejection);
        res.end(admission.rejection === 401 ? "unauthorized" : "forbidden");
        return;
      }
      await bridge(req, res, fetchHandler);
    }
  };
  return owner.effect(() => owner.webServer.register(route), `client-connection: ${channel} rpc channel`);  // 656 行
}
```

对比 0.1.5 同函数（`~/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-connection/lib/index.js` **第 618 行**）：

```js
return owner.effect(() => (this.webCtx ?? owner).webServer.register(route), `client-connection: ${channel} rpc channel`);
```

**差异即根因**：0.1.5 有 `this.webCtx ?? owner` 回退（`this.webCtx` 是 connection 插件自己在 `apply` 里通过 `ctx.inject(['webServer'], webCtx => connection.webCtx = webCtx)` 存下的、正确注入了 webServer 的上下文，见 0.1.5 第 757–783 行）；0.2 删掉了这个回退，直接读 `owner.webServer`。

### 1.3 `intercept`（第 658–671 行）—— 不读 `owner.webServer`，所以能跑

```js
registerInterceptor(owner, channel, matches, handler) {
  if (channel !== "/api") throw new Error(`connection: invalid shared RPC channel ${JSON.stringify(channel)}`);
  const interceptor = { matches, fetchHandler: rpcFetchHandler(channel, handler, this.operator) };
  return owner.effect(() => {
    if (this.interceptors.has(channel)) throw new Error(`connection: shared RPC channel ${JSON.stringify(channel)} already has an interceptor`);
    this.interceptors.set(channel, interceptor);
    return () => { this.interceptors.delete(channel); };
  }, `client-connection: ${channel} rpc interceptor`);
}
```

只动 `this.interceptors`（服务实例自己的 Map），从不碰 `owner.webServer` —— 这就是 `rpc.intercept` 可跑、`rpc.handle` 崩的原因。

### 1.4 `rpcFetchHandler`（第 673–702 行）—— 信封契约（客户端 `rpc.call` 的镜像）

```js
function rpcFetchHandler(channel, handler, peer) {
  return {
    requestBodyMode: () => "buffered",
    async fetch(request) {
      const endpoint = endpointFromPath(channel, new URL(request.url).pathname);
      if (request.method !== "POST" || endpoint === void 0) return new Response("not found", { status: 404 });
      if (request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") return new Response("content type must be application/json", { status: 415 });
      let body;
      try { body = await request.json(); } catch { return new Response("body is not JSON", { status: 400 }); }
      const envelope = clientRequestSchema.safeParse(body);
      if (!envelope.success) return invalidEnvelopeResponse(body, envelope.error.issues);
      const message = envelope.data;
      if (message.method !== endpoint) return errorResponse(message.rpcId, { code: "gateway/bad-request", message: `method ${JSON.stringify(message.method)} does not match endpoint ${JSON.stringify(endpoint)}`, details: { issues: [] } });
      try {
        const result = await handler(endpoint, message.payload, request.signal, peer);
        return fullResponse(message.rpcId, result);
      } catch (error) {
        return new Response(`handler failure: ${String(error)}`, { status: 500 });
      }
    }
  };
}
```

`endpointFromPath`（第 711–716 行）：`pathname` 必须以 `${channel}/` 开头，取其后一段为 endpoint；段含空/`.`/`..` 或非法字符则拒绝。`fullResponse`（第 723–753 行）包出 `{type:'server-response', rpcId, result}`，并处理 `attachments`（FormData，turn-scrubber 用不到）。

### 1.5 客户端 `rpc.call` 到底发什么（Q3c 的依据）

`app.asar/dsh/node_modules/@deepseek-ai/dsh-client-connection/lib/client.js` 第 1212–1231 行：

```js
async call(channel, endpoint, payload, signal) {
  assertTarget(channel, endpoint);
  const rpcId = RpcId(randomUuid());
  const message = { type: "client-request", rpcId, method: endpoint, payload };
  const response = await send(`${channel}/${endpoint}`.slice(1), {           // POST turn-scrubber/turnIndex
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(message),
    ...signal === void 0 ? {} : { signal }
  });
  if (!response.ok) throw new Error(`transport failure for ${channel}/${endpoint}: HTTP ${response.status}`);
  const full = /* multipart ? 二进制解析 : */ parseConnectionResponse(await response.json());
  if (full.rpcId !== rpcId) throw new Error(`rpcId mismatch for ${endpoint}: sent ${rpcId}, got ${full.rpcId}`);
  return full.result;
}
```

所以客户端契约是：
- **路径**：`POST /{channel}/{endpoint}`（channel=`/turn-scrubber`，endpoint=`turnIndex` → `POST /turn-scrubber/turnIndex`）。
- **请求体**：`{"type":"client-request","rpcId":"<uuid>","method":"turnIndex","payload":{"sessionId":…}}`，`Content-Type: application/json`。
- **应答体**：`{"type":"server-response","rpcId":"<同值回显>","result":{"ok":true,"value":…} | {"ok":false,"error":{"code","message","details"}}}`。
- 客户端会**校验 rpcId 回显一致**，不一致抛错；非 200 抛错。

`assertTarget`（client.js 第 1317–1320 行）：channel 须匹配 `/^\/[A-Za-z0-9._~-]+$/`，endpoint 各段须匹配 `/^[A-Za-z0-9_$.-]+$/`。

### 1.6 影子上下文为什么拿不到 `webServer`（逐行追）

cordis 0.2（app.asar `dsh/node_modules/@deepseek-ai/cordis/lib/index.js`，version **4.0.4**）：

1. `ctx.connection` 不是裸服务，而是 `getTraceable`（第 84–90 行）包出的 traceable Proxy，tracker = `{associate:'connection', property:'ctx'}`（在 `Service` 构造函数里 `defineProperty(self, symbols.tracker, tracker)` 设置）。
2. 访问 `ctx.connection.rpc` 时，`rpc` 是 getter，无 `value` 描述符，于是走 `createTraceable` 的 get 分支（第 134–142 行）→ `createShadow(ctx, target, 'ctx', receiver)`：
   ```js
   function createShadow(ctx, target, property, receiver) {          // 第 111–115 行
     if (!property) return receiver;
     const origin = Reflect.getOwnPropertyDescriptor(target, property)?.value;  // target=服务实例, property='ctx' → origin = connection 插件自己的 ctx
     if (!origin) return receiver;
     return withProp(receiver, property, ctx.extend({ [symbols.shadow]: origin }));  // 影子 ctx = 调用方ctx.extend({shadow: connection_ctx})
   }
   ```
3. 于是 `get rpc()` 里的 `this.ctx`（即影子的自有 `ctx` 属性）返回这个「影子上下文」`owner`：自有属性只有 `symbols.shadow`（=connection_ctx），原型链指向调用方插件 ctx。
4. `register()` 第 656 行读 `owner.webServer`。属性查找一路落到根 ctx 的 Proxy（`ReflectService.handler.get`），**receiver = owner**：
   ```js
   get: (target, prop, ctx) => {                                     // 第 672–699 行
     ...
     const error = new Error(`cannot get property "${prop}" without inject`);  // 676 行
     ...
       let fiber = (ctx[symbols.shadow] ?? ctx).fiber;               // 683 行 ← 关键
       while (true) {
         const impl = fiber.store?.[prop];
         if (impl) return getTraceable(ctx, impl.value);
         if (prop in fiber.inject) { error.message = `cannot get required service "${prop}" in inactive context`; throw error; }
         if (!fiber.runtime) throw error;                            // 691 行：爬到 root → 抛「without inject」
         if (fiber.parent[symbols.isolate][prop] !== key) throw error; // 692 行
         fiber = fiber.parent.fiber;
       }
   ```
5. 第 683 行：`ctx` = receiver = `owner`；`owner[symbols.shadow]` = **connection_ctx**（不是调用方 ctx）。所以 `fiber = connection 插件的 fiber`，其 `inject = ["credentials"]`（0.2 index.js 第 798 行），**不含 `webServer`**。循环从 connection fiber 向上爬，沿途没有任何 fiber 的 `inject` 声明 `webServer`，最终爬到 root（`runtime=null`，第 691 行）抛「without inject」。

**结论**：`owner.webServer` 的解析**由 connection fiber 的祖先链决定，与调用方插件注入什么都无关**——影子的 `symbols.shadow` 把 fiber 解析硬重定向到 connection 插件自己。这就是「顶层 inject 加 `webServer` 是必要但不充分、加什么都白搭」的机制解释。

**设计使然 vs 宿主缺陷**：
- cordis 的「影子 / `symbols.shadow`」机制是**设计**：让服务方法内部读 `this.ctx.<service>` 时按「服务自己的 fiber」解析，这样 `owner.effect(...)` 注册的副作用能在 connection 插件卸载时正确清理，而不是挂在调用方插件生命周期上。
- `dsh-client-connection` 0.2 的 `register()` 写 `owner.webServer.register(...)` 是**宿主缺陷（回归）**：它把「调用方声明注入 webServer」误当成「影子能读到 webServer」，而影子机制恰恰让后者永不可能。0.1.5 用 `(this.webCtx ?? owner)` 绕开了影子；0.2 删掉回退后暴露。

---

## 2. 官方插件在 0.2 怎么挂路由/RPC（Q2）

全量 grep app.asar 内所有 `dsh-*` 包的 `lib/index.js` / `lib/client.js`，结果：

- **`rpc.handle`**：**零处调用**。只有 `dsh-client-connection` 自己定义它（第 576 行）。← 铁证：专有通道 API 在 0.2 从未被官方代码使用。
- **`rpc.intercept`**：仅 1 处 —— `dsh-api-gateway`（lib/index.js 第 623–624 行）。
- **`connection.fetch.register`**：`dsh-api-session-controller`（第 2396 行）、`dsh-client-file-upload`（第 171 行）、`dsh-client-ui-deliverables`（第 49/55/84 行）。
- **`webServer.register`**：`dsh-client-hmr`（第 141 行）、`dsh-webhook-github`（第 190 行）、`dsh-client-connection` 自己挂 `/api`（第 820–843 行）、`dsh-host-open-in-app`、`dsh-host-frontend-static`（`registerFallback` 第 87 行）。

### 2.1 官方三种可用写法与适用场景

| 写法 | 出处（文件:行） | 适用场景 | 客户端契约 |
|---|---|---|---|
| `ctx.inject(['connection'], cb => cb.connection.rpc.intercept('/api', matches, handler))` | dsh-api-gateway:623–624 | **只**挂到共享 `/api` 通道、且 `/api` 尚未被占（全局仅 1 个 intercept 槽） | `rpc.call('/api', endpoint, …)` |
| `ctx.effect(() => ctx.connection.fetch.register({path:'/api/…', methods, requestBody, fetch}))` | dsh-api-session-controller:2396；client-file-upload:171 | 挂 `/api` 下的**精确** Fetch 路由（handler 收原始 `Request`，**不是** client-request 信封） | 裸 `fetch('/api/…')`，非 `rpc.call` |
| `ctx.effect(() => ctx.webServer.register({kind:'exact'\|'prefix', path, handler(req,res)}))` | client-hmr:141；webhook-github:190；client-connection:820–843 | **任意路径**（含专有前缀通道）的裸 HTTP 路由，最通用 | 裸 HTTP，自行定信封 |

关键例证——`dsh-client-connection` 自己挂 `/api` 用的是第三种（第 820–843 行）：

```js
ctx.inject(["webServer"], (webCtx) => {
  ...
  const route = { kind: "prefix", path: API_PATH, handler: async (req, res) => {
    const admission = connection.admit(req);
    if ("rejection" in admission) { res.writeHead(admission.rejection); res.end(...); return; }
    await webCtx.waterfall("connection/request", req, res, () => bridge(req, res, fetchHandler, maxRequestBodyBytes));
  }};
  webCtx.effect(() => webCtx.webServer.register(route), "client-connection: /api route");  // 843 行
});
```

即：**官方对「挂路由」的标准姿势就是 `ctx.inject(['webServer'], cb)` + `webCtx.webServer.register(route)`，从不走 `connection.rpc.handle`。**

---

## 3. turn-scrubber 最小可行修法（Q3）

四条候选逐条判定：

### a. `ctx.inject(['webServer'], scope => scope.connection.rpc.handle(...))` —— ❌ 不行

**结论：`scope.connection` 还是 `ctx.connection` 都一样崩。** 前一轮不是「搞错了用哪个 ctx」——两者产出的影子上下文完全相同。

**源码依据**：`get rpc()`（第 572–579 行）里 `const owner = this.ctx`，`this.ctx` 是 `createShadow` 造的影子（§1.6），其 `symbols.shadow` 恒为 `connection_ctx`（取自 `Reflect.getOwnPropertyDescriptor(服务实例, 'ctx').value`，与「你在哪个 ctx 上读 `.connection`」无关）。随后 `register()` 第 656 行读 `owner.webServer`，fiber 解析被硬重定向到 connection fiber（`inject=['credentials']`），抛错。注入作用域 `scope` 自己的 webServer 完全不参与这条链。

### b. 改用 `rpc.intercept` —— ⚠️ 能跑，但**不符合契约且槽位被占**

- `registerInterceptor`（第 658–671 行）确实不读 `owner.webServer`，机制上可跑。
- 但第 659 行 `if (channel !== "/api") throw`：只接受 `/api`。
- 且第 665 行：每个 channel 只允许**一个** interceptor。`dsh-api-gateway` 已占用 `/api`，第三方插件再 intercept `/api` 会抛 `already has an interceptor`。
- 即便能占，客户端也得改成 `rpc.call('/api', 'turnIndex', …)`，破坏「通道仍叫 `/turn-scrubber`」的既有契约。
- **判定：不可作为 turn-scrubber 的修法。**

### c. 绕过 `rpc.handle`，`ctx.webServer.register` 手写同形路由 —— ✅ 推荐

**唯一同时满足「客户端契约不变 + 插件侧可修 + 双版本不回归」的修法。** 依据 §1.4/§1.5 的信封契约，手写一个与 `rpc.handle` 完全同形的 `prefix` 路由：`POST /turn-scrubber/turnIndex`，收 `client-request` 信封，回 `server-response` 信封，前置 `requestRejection` trust fence。

> 用 `ctx.connection.requestRejection(req)`（0.1.5 第 553 行与 0.2 第 586 行**都有**，返回 `403|401|undefined`）而非 0.2 新增的 `admit`（第 591 行，0.1.5 **没有**），以保双版本。

### d. 其他正确路径

- `ctx.connection.fetch.register({path:'/api/turn-scrubber/turnIndex', methods:['POST'], …})`：走共享 `/api` 的精确路由，但 handler 收原始 `Request`（非 client-request 信封），且客户端得改打 `/api/…`——**不满足 `rpc.call('/turn-scrubber',…)` 契约**，排除。
- 结论：**c 是唯一正解。**

### 3.1 diff 级代码骨架（最小改 `apply`）

`src/index.ts` 的 `apply` 改为（`NodeContext` 增加 `webServer.register`、`connection.requestRejection` 结构面即可，无需改 `inject` 的四个元素）：

```ts
export function apply(ctx: NodeContext): void {
  ctx.effect(() => {
    const dispose = ctx.webServer.register({
      kind: 'prefix',
      path: '/turn-scrubber',
      handler: async (req, res) => {
        const rejection = ctx.connection.requestRejection(req)
        if (rejection !== undefined) {
          res.writeHead(rejection)
          res.end(rejection === 401 ? 'unauthorized' : 'forbidden')
          return
        }
        const pathname = new URL(req.url ?? '/', 'http://dsh.internal').pathname
        const endpoint = endpointFromPath(pathname)                 // 复刻 rpcFetchHandler 的 endpointFromPath
        if (req.method !== 'POST' || endpoint === undefined) { res.writeHead(404); res.end('not found'); return }
        const ct = (req.headers['content-type'] ?? '').split(';', 1)[0].trim().toLowerCase()
        if (ct !== 'application/json') { res.writeHead(415); res.end('content type must be application/json'); return }
        let body: any
        try { body = await readJsonBody(req) } catch { res.writeHead(400); res.end('body is not JSON'); return }
        const rpcId = body?.rpcId
        if (body?.type !== 'client-request' || typeof body.method !== 'string' || typeof body.rpcId !== 'string') {
          return writeJson(res, { type: 'server-response', rpcId: typeof rpcId === 'string' ? rpcId : 'invalid-request',
            result: { ok: false, error: { code: 'gateway/bad-request', message: 'invalid client-request message', details: { issues: [] } } } })
        }
        if (body.method !== endpoint) {
          return writeJson(res, { type: 'server-response', rpcId: body.rpcId,
            result: { ok: false, error: { code: 'gateway/bad-request', message: `method ${JSON.stringify(body.method)} does not match endpoint ${JSON.stringify(endpoint)}`, details: { issues: [] } } } })
        }
        const result = await turnIndexHandler(ctx)(endpoint, body.payload)   // 复用既有 handler，保持业务契约不变
        return writeJson(res, { type: 'server-response', rpcId: body.rpcId, result })
      },
    })
    return dispose
  }, 'turn-scrubber: /turn-scrubber rpc channel')
}
```

要点：
1. `endpointFromPath` 复刻 host 的语义（`/turn-scrubber/turnIndex` → `turnIndex`；空段/`.`/`..`/非法字符拒绝）。
2. `readJsonBody` 按 host 的 `bridge` 语义 buffered 读 body（`requestBodyMode: () => 'buffered'`）。
3. `writeJson` = `res.writeHead(200, {'content-type':'application/json'}) + res.end(JSON.stringify(body))`。
4. `ctx.effect(...)` 包住 `register`，返回 disposer → 插件卸载时自动摘路由，与 `rpc.handle` 的 `owner.effect(...)` 语义等价。
5. **不需要** `rpcFetchHandler` 的 `peer`（第四参）：turn-scrubber handler 只收 `(endpoint, payload, signal)`，三参即可。

---

## 4. 真机验证（Q4）—— 已在 0.2.0-rc.2 真机跑通

工具：`/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh`，`DSH_HOME=/tmp/rpc-verify-home`（临时 home，未碰 `~/.dsh/profiles/desktop`，未动正在跑的桌面 App）。

### 4.1 基线（broken 插件，复现缺陷）

profile bundles = `@deepseek-ai/dsh-base` + `@deepseek-ai/dsh-web-app` + `dsh-turn-scrubber`（link 工作区现有产物）。

```sh
DSH_HOME=/tmp/rpc-verify-home dsh --profile rpc-verify --no-open
```

关键输出（原始栈，与用户事实 #2 完全一致）：

```
dsh: warning: 1 entry did not activate
turn-scrubber (dsh-turn-scrubber): Error: cannot get property "webServer" without inject
    at Fiber.<anonymous> (…/dsh-client-connection/lib/index.js:656:35)
    at Object.handle (…/dsh-client-connection/lib/index.js:576:39)
    at new apply (…/dsh-turn-scrubber/lib/index.js:224:21)
dsh web: http://127.0.0.1:3080/?token=…
```

### 4.2 修法（fixed 夹具，选项 c）

在 /tmp 建最小夹具 `/tmp/rpc-fixed-plugin`（node 半身只做注册 + 信封 + fence，`inject=['connection','webServer']`），替换 bundle。启动输出：

```
dsh web: http://127.0.0.1:3080/?token=…
```

**无 `without inject`、无 `did not activate`、无任何告警。**

### 4.3 真实 HTTP 验证通道真能应答

```sh
# 1) 用启动 token mint 浏览器会话 cookie（303 + Set-Cookie）
curl -si -c /tmp/cookies "http://127.0.0.1:3080/?token=-nFedVYXyV9WrrkEEh8-MWYcPauLi54yq0Ss4wym_TA"

# 2) 未认证 POST → 401（trust fence 生效）
curl -s -o /dev/null -w 'HTTP %{http_code}\n' -X POST http://127.0.0.1:3080/turn-scrubber/turnIndex \
  -H 'content-type: application/json' \
  -d '{"type":"client-request","rpcId":"t1","method":"turnIndex","payload":{"sessionId":"abc"}}'
# → HTTP 401

# 3) 带 cookie 的 POST → 200 + server-response 信封（rpcId 回显一致）
curl -si -b /tmp/cookies -X POST http://127.0.0.1:3080/turn-scrubber/turnIndex \
  -H 'content-type: application/json' \
  -d '{"type":"client-request","rpcId":"t1","method":"turnIndex","payload":{"sessionId":"abc"}}'
# → HTTP/1.1 200 OK  content-type: application/json
# → {"type":"server-response","rpcId":"t1","result":{"ok":false,"error":{"code":"session-not-found","message":"session not found","details":{"sessionId":"abc"}}}}
```

夹具 handler 对不存在会话返回确定性业务失败 `session-not-found`（`ok:false`），但**信封、rpcId 回显、fence、路径解析全部与 `rpc.call` 契约逐字节一致**——`ok:true` 路径走同一个 `writeJson`，无额外分支。客户端 `rpc.call` 会拿到 `full.result` 并返回，不再抛传输错。

### 4.4 清理

已 `pkill` 临时实例、删除 `/tmp/rpc-verify-home` 与 `/tmp/rpc-fixed-plugin`；`~/.dsh/profiles/desktop/package.json` mtime 未变（`Sep 30 17:33`），未动用户真实配置。

---

## 5. 双版本：推荐修法在 0.1.5 会不会反而报错（Q5）

**不会，前提是用 `requestRejection` 而不是 `admit`。**

- `ctx.webServer`：turn-scrubber 顶层 `inject` 已含 `webServer`（0.1.5/0.2 的 `webServer` 服务均存在），`ctx.webServer.register(...)` 两版可用。
- `ctx.connection.requestRejection(req)`：
  - 0.1.5 `~/.npm-global/…/dsh-client-connection/lib/index.js` **第 553–556 行**存在，返回 `403|401|undefined`。
  - 0.2 app.asar `…/lib/index.js` **第 586–589 行**存在，语义相同。
- ⚠️ **不要用** 0.2 新增的 `admit`（第 591–594 行，返回 `{peer}|{rejection}`）—— 0.1.5 **没有**这个方法，用了会在 0.1.5 抛 `cannot get property "admit" without inject`（或 `undefined is not a function`）。

即：修法里 fence 一律写 `const rejection = ctx.connection.requestRejection(req)`，天然双版本安全。

---

## 6. 宿主缺陷：上游 issue 草稿（Q6）

```markdown
## dsh-client-connection 0.2.0-rc.2: `connection.rpc.handle()` cannot register a dedicated channel ("cannot get property webServer without inject")

### Versions
- @deepseek-ai/dsh-client-connection 0.2.0-rc.2
- @deepseek-ai/cordis 4.0.4
- Regression vs 0.1.5-rc.2

### Summary
In 0.2.0-rc.2, `HostConnectionService.register()` reads `owner.webServer`
(owner = the cordis "shadow" context passed by `get rpc()`), but the shadow's
`symbols.shadow` redirects fiber resolution to the connection plugin's own
fiber (inject = ["credentials"], which never declares `webServer`), so
`owner.webServer` always throws. 0.1.5 used `(this.webCtx ?? owner).webServer`
and worked. No official plugin calls `rpc.handle`, which is why the regression
was not caught internally.

### Minimal reproduction (any third-party bundle plugin)
```js
export const inject = ['connection', 'webServer']
export function apply(ctx) {
  ctx.connection.rpc.handle('/demo', async (endpoint, payload) => ({
    ok: true, value: { endpoint, payload }
  }))
}
```

### Error
```
Error: cannot get property "webServer" without inject
    at Fiber.<anonymous> (…/dsh-client-connection/lib/index.js:656:35)
    at Object.handle (…/dsh-client-connection/lib/index.js:576:39)
    at new apply (<plugin>/lib/index.js:<line>)
```

### Impact
Only third-party plugins registering a DEDICATED channel via the public
`rpc.handle` API are affected. Official code never uses `rpc.handle`:
it mounts routes via `ctx.inject(['webServer'], cb => cb.webServer.register(...))`
(dsh-client-connection itself, dsh-client-hmr, dsh-webhook-github),
`rpc.intercept('/api', …)` (dsh-api-gateway only), or
`connection.fetch.register({path:'/api/…', …})` (api-session-controller,
client-file-upload). So no core surface breaks, but the public dedicated-channel
API is effectively dead in 0.2.

### Suggested fix
Restore the 0.1.5 fallback in `register()`:
```js
return owner.effect(() => (this.webCtx ?? owner).webServer.register(route), …);
```
and keep `this.webCtx` set in `apply` via `ctx.inject(['webServer'], webCtx => this.webCtx = webCtx)`.
```

---

## 7. 结论摘要

1. **能在插件侧修好**：把 `ctx.connection.rpc.handle('/turn-scrubber', …)` 换成 `ctx.effect(() => ctx.webServer.register({kind:'prefix', path:'/turn-scrubber', handler}))`，handler 手工复刻 client-request/server-response 信封 + `ctx.connection.requestRejection` fence。
2. **客户端契约一字不改**：`connection.rpc.call('/turn-scrubber','turnIndex',{sessionId})` 仍有效（信封、路径、rpcId 回显逐字节兼容）。
3. **给插件 inject 加 `webServer` 是必要但不充分**——影子上下文把 `owner.webServer` 的 fiber 解析硬重定向到 connection 插件（`inject=['credentials']`），加什么注入都救不了 `rpc.handle`。
4. **`rpc.handle` 是宿主回归缺陷**：0.1.5 `(this.webCtx ?? owner).webServer` → 0.2 `owner.webServer` 删掉了回退；官方代码从不调用 `rpc.handle`，所以影响面仅限用它的第三方插件。
5. **真机已验**：0.2.0-rc.2 下 broken 版复现 `without inject`，fixed 版启动零告警、HTTP 200 返回正确 `server-response` 信封、未认证 401。
6. **双版本安全**：fence 用 `requestRejection`（两版都有），不用 0.2 新增的 `admit`。
