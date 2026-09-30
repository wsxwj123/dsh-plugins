# 调研报告：`dsh-appearance-gallery` 在 DSH 0.2 下的兼容性

## 结论（先给答案）

**只改 peer 范围就够，代码不用动。** 插件实际消费的 5 个运行时 API（`theme.overrideTokens`、`slots.inject`/`slots.register`、`settings.general.item` 槽名、`modules` 服务、`window.__ModuleLoader__`）在 0.1.5 → 0.2 之间**全部存在、签名未变、语义未变**。peer 范围改成 `^0.2.0-rc.1` 已足够（实测 semver 满足 `0.2.0-rc.2`）。`cordis.patch.yml` 的 `insert` 机制与 row 格式在 0.2 仍然有效，节点侧零服务依赖、客户端侧只硬依赖 `slots` 服务（0.2 由 `dsh-client-ui-renderer` 恒提供）。

---

## 0. 版本勘误（必须说明）

- 提示词写「对照旧版 0.1.5-rc.1」，但实际参考目录 `/Users/wsxwj/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/` 里读到的 `dsh-client-ui-theme` / `-settings` / `-settings-general` 版本号均为 **`0.1.5-rc.2`**（见各包 `package.json` 的 `"version"` 字段）。本报告按实际读到的 `0.1.5-rc.2` 标注对照侧。
- 0.2 侧三个 peer 包版本均为 **`0.2.0-rc.2`**（`dsh-client-ui-theme` / `-slots` / `-settings` 的 `package.json`）。
- 0.2 源码从 asar 提取到 `/tmp/asar_out/`，文件名中 `/` 变 `__`。下文「0.2 侧」行号均指提取文件，其 asar 内路径为 `dsh/node_modules/@deepseek-ai/<pkg>/lib/<file>`。

---

## 1. 插件对 peer 包（及注入的其它 @deepseek-ai 包）的全部调用清单

关键事实：插件客户端产物是**单个 CJS factory**（`build.mjs` 把所有 `src/*.js` 拼进同一作用域），**不 `import`/`require` 任何 `@deepseek-ai` 包**，唯一模块级依赖是 `react`。所有宿主能力都经 **cordis 服务**间接获取。

| 位置 | 用到的符号 / 调用 | 实际提供方（0.2） |
|---|---|---|
| `packages/dsh-appearance-gallery/package.json:33-37` | `dsh.client.inject = ["@deepseek-ai/dsh-client-ui-theme","-settings","-slots"]` | 加载顺序提示（软） |
| `packages/dsh-appearance-gallery/build.mjs:111` | `window.__ModuleLoader__.load({ id, factory })` | `dsh-client-modules` 全局 |
| `packages/dsh-appearance-gallery/build.mjs:113` | `const React = require('react')` | `react` peer |
| `packages/dsh-appearance-gallery/build.mjs:116` | `exports.inject = ['slots']` | `slots` 服务（硬依赖） |
| `src/client.js:500` | `ctx.get('slots')` | `slots` 服务 |
| `src/client.js:512-515` | `slots.inject('settings.general.item', () => slots.register({ name:'settings.general.item', id:SLOT_ID, order:11 }, runtime.AppearanceEntry))` | `slots` 服务 + 槽名 |
| `src/client.js:523` | `ctx.get('theme')` | `theme` 服务 |
| `src/client.js:532-537` | `ctx.inject(['theme','slots'], cb)` | cordis 核心 API |
| `src/client.js:186 / 245 / 318` | `themeService.overrideTokens('dsh-appearance-gallery', tokens, themeId)` | `theme` 服务 |
| `src/client.js:559-560` | `ctx.get('modules') ?? globals.__DSH_MODULES__ ?? null` | `modules` 服务 |
| `src/skin-engine.js:152 / 290` | `modules.invalidate(id)` | `modules` 服务 |
| `src/skin-engine.js:154` | `(await modules.import(id)).apply` | `modules` 服务 |

要点：
- 三个 peer 包里，**代码真正消费的服务只有 `theme`**（`ctx.get('theme')` → `overrideTokens`）。
- `slots` 服务其实由 **`dsh-client-ui-renderer`** 提供（不是 `dsh-client-ui-slots`）；`ui-slots` 只是纯核心（`SlotCore` 类），插件不 import 它的任何导出。
- `modules` 服务由 **`dsh-client-modules`** 提供；插件既不 inject 也不把它列进 peer（用 `ctx.get()` 软读 + `__DSH_MODULES__` 兜底）。
- `settings.general.item` 槽名由 **`dsh-client-ui-settings-general`** 声明；插件既不 inject 它也不把它列进 peer（槽注册靠 `slots.inject` 的「声明就绪后重放」机制等待）。
- `@deepseek-ai/dsh-client-ui-settings` 在 0.2 是「settings 基座包（表单 + 槽类型契约）」，插件代码不消费它的任何导出。

---

## 2. 逐符号对照（0.1.5 vs 0.2）

### 2.1 `theme.overrideTokens(source, tokens)` — 未变

已证实。两侧签名都是 `(source, tokens)` 两个参数，语义都是「按 source 叠一层 token override，返回 disposer；同 source 再调即整体替换」：

- 0.1.5 侧：`/Users/wsxwj/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-ui-theme/lib/client.js:1364`
  ```js
  overrideTokens(source, tokens) {
      const layer = { seq: this.overrideSeq++, tokens: validateOverrides(source, tokens) };
      this.overrides.set(source, layer);
      this.publish();
      return () => { if (this.overrides.get(source) !== layer) return; this.overrides.delete(source); this.publish(); };
  }
  ```
- 0.2 侧：`/tmp/asar_out/dsh__node_modules__@deepseek-ai__dsh-client-ui-theme__lib__client.js:1474`
  ```js
  overrideTokens(source, tokens) {
      const layer = { seq: this.overrideSeq++, tokens: validateOverrides(source, tokens) };
      this.overrides.set(source, layer);
      this.publish();
      return () => { if (this.overrides.get(source) !== layer) return; this.overrides.delete(source); this.publish(); };
  }
  ```

服务名也一致：`ctx.provide("theme", theme)` — 0.1.5 `:1472`、0.2 `:1582`。`tokens` 形状校验（值必须是 `{ light, dark }` 字符串对，裸字符串抛错）两版逐字一致（0.1.5 `:1430 validateOverrides`，0.2 `:1540`）。

> 注意：插件在 `src/client.js:186/245/318` 传了**第三个参数** `themeId`（`overrideTokens(source, tokens, themeId)`）。两侧宿主该方法都只声明 2 个形参，第三参被 JS 静默丢弃，**不报错、无行为差异**（死参数）。不影响兼容，但属冗余。

### 2.2 `slots.inject(key, cb)` / `slots.register(options, component)` — 未变

已证实。`slots` 服务在 0.1.5 与 0.2 均由 `dsh-client-ui-renderer` 提供（同名同包）：

- 0.2 侧服务构造：`/tmp/asar_out/dsh__node_modules__@deepseek-ai__dsh-client-ui-renderer__lib__client.js:1323` `super(ctx, "slots")`。
- 0.2 `inject`：`.../dsh-client-ui-renderer__lib__client.js:1343`
  ```js
  inject(key, callback) {
      const ctx = this.ctx;
      const disposeController = ctx.effect(() => { /* ... 声明就绪或重放 callback ... */ });
      return () => { disposeController(); };
  }
  ```
- 0.2 `register`：`.../dsh-client-ui-renderer__lib__client.js:1788`
  ```js
  SlotRegistry.prototype.register = function register(rawOptions, component) {
      const options = rawOptions;
      return this.ctx.effect(() => this["_register"](options, component), "slots.register()");
  };
  ```

插件用法与 0.2 官方主题/设置包**逐字同构**——0.2 主题自己就写 `ctx.slots.inject("settings.general.item", () => ctx.slots.register({ name:"settings.general.item", id:"appearance", order:10, ... }, AppearanceRow))`（`.../dsh-client-ui-theme__lib__client.js:1603-1610`）。`SlotCore.register` 对 `list` 槽要求 `options.id`、支持 `options.order`（`/tmp/asar_out/...dsh-client-ui-slots__lib__index.js:181-185`、`:221`），与插件 `{ name, id, order }` 精确匹配。

### 2.3 设置页槽名 `settings.general.item` — 未变，且声明方一直没变

已证实。该槽**始终由 `dsh-client-ui-settings-general` 声明**（不是 `dsh-client-ui-settings` 基座包）：

- 0.1.5 侧：`/Users/wsxwj/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-ui-settings-general/lib/client.js:657-660`
  ```js
  children: { "settings.general.item": {
      kind: "list",
      scope: "root"
  } }
  ```
- 0.2 侧：`/tmp/asar_out/dsh__node_modules__@deepseek-ai__dsh-client-ui-settings-general__lib__client.js:1177-1180`（内容逐字相同，`kind: "list"`，`scope: "root"`）。

`kind: "list"` 与插件 `{ name, id, order }` 的注册形参吻合（list 槽按 `priority` 再按 `order` 排序）。

### 2.4 `modules` 服务 + `window.__ModuleLoader__` — 未变

已证实。

- 服务名 `modules`：0.1.5 `dsh-client-modules/lib/client.js:364` `ctx.reflect.provide("modules", moduleSystem)`；0.2 `dsh-client-modules/lib/client.js:868` `ctx.reflect.provide("modules", modules)`。
- `import(specifier)`：0.1.5 `:311`；0.2 `:743`（async，返回 exports 含 `.apply`）。
- `invalidate(id, rev)`：0.1.5 `:328`；0.2 `:824`（`rev` 可选）。插件只传 1 参 `invalidate(entry.package)`，两版均兼容。
- `window.__ModuleLoader__.load({ id, factory })`：0.1.5 `client.js:1`；0.2 `client.js:1` 与 `index.js:456`。未变。

> `__DSH_MODULES__` 全局：在 0.1.5 与 0.2 的 `dsh-client-modules` 源码里均 **grep 不到**（两版都只用 `reflect.provide("modules", …)`，不再挂 window 全局）。插件 `src/client.js:559` 的 `globals.__DSH_MODULES__` 兜底分支只对 ≤rc.7 老宿主有意义，在 0.1.5/0.2 上都是**死代码**，无害。

### 2.5 cordis 核心 `ctx.get` / `ctx.inject([...], cb)` — 未变

`ctx.get('slots'|'theme'|'modules')` 与 `ctx.inject(['theme','slots'], cb)` 是 cordis 核心 API，0.1.5/0.2 无差异（0.2 renderer 内部 `inject` 实现本身就用 `ctx.effect` 承载，见 2.2）。

---

## 3. 核心结论：只改 peer 范围够不够

**只改 peer 范围就够，代码不用动。**

依据：插件运行时唯一接触宿主的 5 个能力面（§2.1–2.5）在 0.2 全部存在且签名/语义未变；这与「0.2.0-rc.2 上已实测能加载、启动审计无告警」的外部事实一致。

需要知道但**不阻塞**的三点：

1. 三个 peer 中只有 `theme` 是代码真正消费的服务；`ui-slots` / `ui-settings` 不是代码直接依赖。但保留声明无害（三者当前都 `peerDependenciesMeta.optional: true`）。
2. `dsh.client.inject` 是**软提示**：0.2 `dsh-client-modules/lib/client.js:656-658` 对缺失包 `if (dependency !== void 0)` 静默跳过，所以 inject 里列了不存在的包也不炸。当前三个包在 0.2 都存在，无风险。
3. 插件入口 `order:11` 与原生主题「外观」行（`order:10`）、「字号」行（`order:11`）并列在通用设置里，两版一致，属设计使然（插件是在原生外观之上的扩展入口），非回归。

---

## 4. 顺带核实：`dsh.bundle.patch`（cordis.patch.yml）在 0.2 是否有效

插件 patch 内容（`packages/dsh-appearance-gallery/cordis.patch.yml:1-3`）：
```yaml
- insert:
    - id: appearance-gallery
      name: dsh-appearance-gallery
```

已证实有效。0.2 `dsh-app-boot/lib/index.js`（`/tmp/asar_out/dsh__node_modules__@deepseek-ai__dsh-app-boot__lib__index.js`）：

- `:61-110 applyEntryPatches(data, patches, warn)`：对带 `insert` 且**无外层 `id`** 的 patch，走 `:87` `else data.push(...insert)` —— 直接把 `{ id:'appearance-gallery', name:'dsh-appearance-gallery' }` 作为顶层 bundle row 挂载。这正是插件的形态。
- `:468-475` 注释明确 bundle 声明入口仍是 `"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }`，与插件 `package.json:27-30` 一致。

row id / 依赖服务核实：
- **row id `appearance-gallery`**：与核心 bundle id（`client-modules` / `ui-theme` / `ui-renderer` 等）无冲突，未发现保留名占用。
- **name `dsh-appearance-gallery`**：解析到包 `main` = `lib/index.js`（node 半边），其内容 `export const name='dsh-appearance-gallery'; export function apply(){}`（`lib/index.js:1-2`）——**节点侧零服务依赖**（无 `inject`、空 `apply`）。
- **客户端半边服务依赖**：`build.mjs:116` 注入 `exports.inject = ['slots']`，即客户端 cordis entry 硬依赖 `slots` 服务。0.2 该服务由 `dsh-client-ui-renderer` 提供（核心壳包，恒加载），依赖必然满足。

---

## 5. 建议改法（含代码骨架）

### 5.1 peer 范围写什么

三个 peer 改成（已验证 `^0.2.0-rc.1` 满足 `0.2.0-rc.2`；`0.2.0-rc.2` 也满足，见下）：

```jsonc
// packages/dsh-appearance-gallery/package.json
"peerDependencies": {
  "@deepseek-ai/cordis": "^4.0.1",
  "@deepseek-ai/dsh-client-ui-theme": "^0.2.0-rc.1",
  "@deepseek-ai/dsh-client-ui-settings": "^0.2.0-rc.1",
  "@deepseek-ai/dsh-client-ui-slots": "^0.2.0-rc.1",
  "react": "^18.0.0 || ^19.0.0"
}
```

semver 实测（`semver.satisfies`）：
- `^0.2.0-rc.1` 满足 `0.2.0-rc.2` ✅、`0.2.0` ✅、`0.2.5` ✅；不满足 `0.1.5-rc.2` ❌、`0.3.0` ❌、`0.2.0-rc.0` ❌。
- `^0.1.0-rc.6`（现状）不满足 `0.2.0-rc.2` ❌ —— 这正是当初需要「精确版本豁免」强装的原因。

三选一，按目标取舍：

1. **`^0.2.0-rc.1`**（提示词目标）：声明 0.2 兼容，去豁免。够用。
2. **`^0.2.0-rc.2`**：只声明「实测通过的那个 rc」，最保守（避免对未测的 rc.1 作出承诺）。
3. **`^0.1.0-rc.6 || ^0.2.0-rc.1`**：因为 API 未变，插件其实 0.1.x / 0.2.x 都能跑；若还想继续支持 0.1.x 用户，用双区间（等价 `>=0.1.0-rc.6 <0.3.0`）。代价是声明面变宽。

> 若想对齐同 monorepo 里已在 0.2 上跑的 `dsh-composer-tools` / `dsh-turn-scrubber`（它们 peer 只声明 `cordis` + `react`/`react-dom`，不声明 ui-theme/ui-settings/ui-slots），可以进一步把三个 ui-* peer 直接删掉（它们本就是 optional 且代码不 import）。但这不是「改 peer 范围」的必要动作，保留声明也可。

### 5.2 代码动不动

**不动。** 全部运行时 API 兼容（§2、§3）。若追求整洁可顺手做两处无害清理（非必须）：
- 删掉 `src/client.js:186/245/318` `overrideTokens` 多余的第 3 参 `themeId`（当前被宿主忽略）。
- 删掉 `src/client.js:559` 的 `?? globals.__DSH_MODULES__` 死分支（0.1.5/0.2 已无该全局）。

### 5.3 改完怎么验证

1. 改 `package.json` peer 三处后，在 profile 里移除「精确版本豁免」。
2. 重装：`pnpm install`（或 `dsh plugin` 重挂），按 `~/.dsh/AGENTS.md` 红线——装完立即 `ls -la ~/.dsh/profiles/<name>/node_modules/@deepseek-ai/` 确认为 symlink 而非物理副本，出现真目录就 `mv` 掉。
3. 重启 dsh，确认三点：
   - 启动审计**无告警**（peer 冲突消失）。
   - 「通用设置」里「打开外观设置」入口出现（`slots.inject('settings.general.item', …)` 生效）。
   - 功能闭环：切主题（token override 生效）、切/试穿/导入/删除皮肤（`modules.import` + `__ModuleLoader__` 链路）、切轨无残留（`theme/change` 与皮肤卸载互斥正常）。

---

## 6. 已证实 vs 推测

**已证实（源码逐行读到）：**
- `theme.overrideTokens(source, tokens)` 两版签名/语义一致（§2.1）。
- `slots.inject`/`slots.register` 两版 API 一致，提供方始终是 `dsh-client-ui-renderer`（§2.2）。
- `settings.general.item` 槽名两版一致，声明方始终是 `dsh-client-ui-settings-general`，`kind:"list"`（§2.3）。
- `modules` 服务（`reflect.provide("modules", …)`）、`import`/`invalidate`、`window.__ModuleLoader__.load` 两版一致（§2.4）。
- `cordis.patch.yml` 的 `insert` 语义与 row 格式在 0.2 `dsh-app-boot` 有效（§4）。
- peer 版本号：0.2 三个包均为 `0.2.0-rc.2`；`^0.2.0-rc.1` 经 semver 实测满足之（§5.1）。

**推测（需最小实验确认）：**
- 结论「只改 peer 范围即无运行时回归」是**静态源码比对**推出的；插件在 0.2 的完整功能（皮肤激活/卸载/切轨/自定义导入）是否逐条通过，需 §5.3 的 e2e 验证兜底。**最小实验**：headless profile 真实加载 + 打开设置页，逐条触发「切主题 / 切皮肤 / 试穿回滚 / 自定义皮肤导入并应用 / 恢复默认」五条路径，观察无异常、无残留 style/body 属性。

**读不到，原因 X：**
- `dsh-client-ui-slots` / `dsh-client-ui-primitives` 在 0.1.5 参考目录 `node_modules/@deepseek-ai/` 下无实体（0.1.5 树把它们 hoist 掉了，目录不存在）；但对结论无影响——这两个包在 0.2 里 `ui-slots` 是纯核心、`ui-primitives` 是组件库，插件代码均不 import 其导出，缺 0.1.5 源码不改变 §2/§3 结论。
