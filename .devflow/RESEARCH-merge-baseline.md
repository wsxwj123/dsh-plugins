# RESEARCH — 外观插件合并前的现状基线

调研对象：`/Users/wsxwj/Desktop/app/dsh-plugins-runtime`，分支 `feature/theme-skin-custom-system`，HEAD `70c230d`。
调研日期 2026-08-17。只读调研，未改任何代码，未跑 `dsh web`。

## 0. 方法与取证范围

- 仓库内文件全部只读（Read / grep / stat / git log|show|ls-remote）。
- 为回答"懒加载到底有没有生效"，额外**只读**了本机 DSH 宿主运行时（这是唯一能证伪的证据源）：
  - `/Users/wsxwj/.dsh/profiles/web/package.json`（实际启用的插件清单）
  - `/Users/wsxwj/.dsh/profiles/web/node_modules/@deepseek-ai/dsh-client-ui-slots/lib/index.js`（槽位语义）
  - `/Users/wsxwj/.dsh/profiles/web/node_modules/@deepseek-ai/dsh-client-web-react/lib/index.js`（渲染排序）
  - `/Users/wsxwj/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-{modules,web}/lib/*`（模块系统与启动序）
- 唯一写入的文件是本报告。
- 只跑了只读的 `node --test`（单测/验收测试，不写仓库文件），未跑任何 `build`（原因见 §4，`build` 会破坏产物）。

### 数据与指令隔离声明（实际遇到的情况）

调研中确实读到"看起来像指令"的外部文本，一律当数据处理、未执行：

1. `packages/skin-runtime/src/client.js:219-273` 的 `designSummary` 常量，内容是一段写给 AI 的祈使句提示词（"我想创建一个自定义 DSH 皮肤。请按 dsh-skin-gallery 的皮肤包格式交付…请先向我提问确认设计，不要直接生成代码。"）。它是插件 UI 给**用户复制到对话里**用的模板文本，不是给我的命令；我未按它行动。合并时这段文本要整体搬迁（属于功能面，见 §6）。
2. 9 款皮肤 bundle 与外部 `navigation-diary/client.js` 里的注释同样是数据。未执行、未按其描述改动任何东西。

未出现要求外发数据 / 删文件 / 连陌生地址的内容。

---

## 1. 三包结构与体积

### 1.1 逐包文件清单与字节数（`stat -f '%z'`）

**theme-gallery**（无 skins 资源）

| 文件 | 字节 |
|---|---|
| `src/client.js` | 13908 |
| `src/themes.curated.js` | 27410 |
| `src/custom-theme.js` | 9649 |
| `src/acceptance-api.mjs` | 1414 |
| `src/index.js` | 67 |
| `lib/client.js` | **51252** |
| `lib/index.js` / `lib/invariant.js` | 67 / 27 |
| `build.mjs` | 1877 |
| `tests/unit/*.mjs`（3 个） | 4437 + 1392 + 2298 |

**skin-gallery**（懒加载入口包；但仍完整携带 9 套皮肤资源与全部皮肤源码）

| 文件 | 字节 |
|---|---|
| `src/client.js`（入口 UI，仅一个按钮） | 2998 |
| `lib/client.js`（入口产物） | **3204** |
| `src/skin-engine.js` | 15084 |
| `src/custom-skin.js` | 13488 |
| `src/skin-a11y.js` | 2217 |
| `src/acceptance-api.mjs` | 3460 |
| `build.mjs` | 4170 |
| `skins/`（9 套 + NOTICE） | **1264 KB（du -sk）** |
| `tests/unit/*.mjs`（8 个） | 合计 39409 |

**skin-runtime**（完整皮肤界面）

| 文件 | 字节 |
|---|---|
| `src/client.js`（完整界面） | 25236 |
| `lib/client.js` | **1249199（1.19 MiB）** |
| `src/skin-engine.js` / `custom-skin.js` / `skin-a11y.js` / `acceptance-api.mjs` | 与 skin-gallery **逐字节相同**（`diff -q` 全部 same） |
| `skins/` | **与 skin-gallery 逐字节相同**（`diff -rq` 退出码 0，无差异） |
| `tests/` | **与 skin-gallery 逐字节相同**（`diff -rq` 退出码 0） |

**结论：skin-gallery 与 skin-runtime 只有 `src/client.js` 与 `src/index.js` 两个文件不同**（外加 `build.mjs`/`package.json`/`cordis.patch.yml` 里的 id 字符串）。其余全是 1:1 复制，包括 1.26 MB 的 `skins/` 与 8 个单测文件。

- `diff packages/skin-gallery/build.mjs packages/skin-runtime/build.mjs` → 唯一差异是第 5 行 `const id = 'dsh-skin-gallery'` vs `'dsh-skin-runtime'`。
- `diff .../package.json` → 唯一差异是 `"name"`。
- `diff .../cordis.patch.yml` → 唯一差异是 `id` / `name`。

即：**当前仓库里有一份 1.26 MB 的皮肤资源被完整存了两遍，且 skin-gallery 那一份对其 3 KB 的产物毫无用处**（其 `lib/client.js` 里不含任何皮肤资源）。

### 1.2 15 主题的 token 数据在哪、多大

- 位置：`packages/theme-gallery/src/themes.curated.js`（27410 B，全文只有 2 行——一个巨型 JSON 字面量数组 `THEME_FAMILIES`）。
- 规模：`grep -o '"id":"[a-z-]*"' | wc -l` = **15** 个家族（jade / terracotta / ember / starlight / rose-mist / amethyst / amber-retro / ink-river / mossland / eclipse / horizon / azure / monochrome / blush-dawn / lilac-mist）。
- token：去重后 **24 个** `--dsw-*` 变量名，总出现 **360 次**（15 × 24），每个值都是 `{light, dark}` 两个字符串 → 共 720 个颜色字符串。
- 每个家族还有 `preview: {light:{background,accent}, dark:{...}}` 供预览色块用。
- 构建时整段原文内联进 `lib/client.js`（`build.mjs:15,20`），故 51 KB 产物里约 27 KB 是 token 数据。

### 1.3 9 套皮肤资源在哪、多大

`packages/{skin-gallery,skin-runtime}/skins/<id>/{skin.json,client.js,a11y.css,LICENSE}`：

| 皮肤 | client.js | a11y.css | 备注 |
|---|---|---|---|
| blue-fantasy | 326527 | 1264 | 内含一张 **286671 字符**的 base64 图 |
| dragon-heir | 245125 | 1088 | 两张 base64 图（109823 + 105871） |
| whale-song | 244364 | 1191 | base64 图 204727 |
| miku | 139941 | 980 | base64 图 84759 |
| trading | 48628 | 682 | |
| xp | 42757 | 527 | |
| qq98 | 42340 | 1233 | |
| ths | 40624 | 402 | |
| minecraft | 36716 | 374 | |
| **合计** | **1167022** | **7741** | |

**约 815 KB（≈65%）是 4 张内嵌 base64 背景图**（`grep -o 'data:image/[a-z+]*;base64,[A-Za-z0-9+/=]*'` 取最长串统计）。这是 1.19 MB 产物的主要来源。

### 1.4 哪些是启动即载、哪些是按需载（**关键纠正**）

**结论：全部启动即载。当前不存在真正的按需加载。** 证据链见 §2.3。

- `skin-runtime/lib/client.js`（1.19 MB，含全部 9 套 bundle 文本 + 4 张 base64 图）在 dsh 启动时就被 fetch + 解析 + materialize。
- 构建脚本注释里"运行期按需"（`skin-engine.js:16-20`）指的是**皮肤 bundle 文本何时被当脚本执行**（`activateSkin` 时才 Blob-URL 执行），不是"1.19 MB 何时到达浏览器"。前者确实是懒的，后者不是。
- theme-gallery 的 51 KB 同样启动即载（它本来就小，符合预期，且 `build.mjs:30` 有 <100 KB 硬门禁）。

---

## 2. slot 注册全景与懒加载链路真相

### 2.1 全仓 slot 注册（`grep -rn "slots.register\|slots.inject"`）

整个仓库**只有 3 处** `slots.register`，且都只用一个槽位 `settings.general.item`：

| 包 | src 位置 | lib 位置 | 注册参数 |
|---|---|---|---|
| theme-gallery | `src/client.js:216-219` | `lib/client.js:475-477` | `{ name:'settings.general.item', id:'theme-gallery', order:11 }`（无 priority ⇒ 0） |
| skin-gallery | `src/client.js:61-64` | `lib/client.js:64-67` | `{ …, id:'skin-gallery', order:12 }`（无 priority ⇒ 0） |
| skin-runtime | `src/client.js:443-447` | `lib/client.js:1183-1186` | `{ …, id:'skin-gallery', order:12, **priority:-1** }` |

三处都包在 `slots.inject('settings.general.item', () => slots.register(...))` 里（等槽位声明就绪后再注册）。
其余包（turn-scrubber / pet-bridge / dsh-session-manager / dsh-composer-tools）**不注册任何槽位**（`grep -rln slots` 命中的只是它们的 `tsdown.config.mjs` 与一个单测文件名）。

同槽位的宿主自带条目（用于判断 order 冲突）：
- `dsh-client-ui-conversation/lib/client.js:9472-9484`：`id:'composer-enter', order:20`。
- `dsh-client-locale/lib/client.js:1211` 也注册该槽位。
- 本仓用的 `order` 11 / 12 未与宿主 20 冲突。

### 2.2 槽位遮盖语义（铁律 2）已在宿主代码核实

宿主 `~/.dsh/profiles/web/node_modules/@deepseek-ai/dsh-client-ui-slots/lib/index.js`：

- `:63-88` `register()`：对 `kind === 'list'` 的槽位，若已存在**同 id 同 priority** 的条目 → `throw new Error('list slot "…" already has an entry with id "…" at priority N … register at a different priority to shadow it (lowest renders)')`。**同 id 同优先级 = 启动报错**，与铁律一致。
- `:123`：条目入表时排序 `list` 用 `(a.priority??0) - (b.priority??0) || (a.order??0) - (b.order??0)`。
- `:180-193` `entriesOfSlot()`：按上面排好的顺序遍历，**每个 id（cell）只取第一个** ⇒ **priority 数值最低者胜出**。铁律 2 完全成立。
- 补充事实（对合并有用）：`dsh-client-web-react/lib/index.js:695-711` 渲染时会把胜出条目**再按 `order` 重排**（`[...rows].sort((a,b)=>a.order-b.order)`）。所以 `priority:-1` 只决定"谁渲染"，**不改变视觉位置**；skin 项仍排在 theme 项（order 11）之后。

### 2.3 懒加载链路现在到底怎么工作（**核心结论：不工作**）

设计意图（`skin-gallery/src/client.js:20-35`）：入口按钮点击 → `globalThis.__DSH_MODULES__.import('dsh-skin-runtime')` → runtime 到达并注册 `priority:-1` 条目遮盖入口。

实际情况：**runtime 在 dsh 启动时就已经被导入，入口按钮永远不会显示，1.19 MB 一样在启动时到达。** 证据：

1. **两个包都是启用的 cordis 条目。**
   - `packages/skin-gallery/cordis.patch.yml` = `- insert: [{id: skin-gallery, name: dsh-skin-gallery}]`
   - `packages/skin-runtime/cordis.patch.yml` = `- insert: [{id: skin-runtime, name: dsh-skin-runtime}]`
   - `~/.dsh/profiles/web/package.json` 的 `dsh.profile.bundles` 同时列出 `dsh-theme-gallery`、`dsh-skin-gallery`、`dsh-skin-runtime` 三项（三者都以 `link:` 指向本仓 packages）。
   - `~/.dsh/profiles/web/cordis.patch.yml` 与 `~/.dsh/cordis.patch.yml` 都是空数组 `[]` ⇒ **没有任何 disable**。

2. **宿主启动序：每个 graph row 都会被创建成 loader 条目并导入。**
   `@deepseek-ai/dsh-client-web/lib/index.js:262-272`（启动序注释原文，`AppWebEntry.run()`）：
   > parse `window.__DSH_BOOT__` … → prefetch every `immediately` row … → **create one loader entry per plugin-view row** plus the shell-own app-shell assembly entry → `loader.await()` + a full fiber sweep (all ACTIVE, else fail …)
   `@deepseek-ai/dsh-client-modules/README.zh.md`：vendored cordis 侧"唯一的消费点是 `EntryTree.import`"；node 侧"扫描**已启用的** Loader 配置项以发现 web `dsh.client` 包"，把 bundle 哈希写进启动图。
   ⇒ 启用的条目 = graph row = 启动时被 `import` = factory 执行 = `apply(ctx)` 执行。

3. **实测旁证（已发生的线上故障）**：`LEARNINGS.md:16` 记录启动即报 `failed to import loader entry (dsh-skin-gallery)`。这证明条目是在**启动时**被 import 的，不是点击时。skin-runtime 与 skin-gallery 是同一类条目，没有理由被区别对待。

4. **`immediately` 标志不改变这一点**：`dsh-client-modules/lib/types/client/manifest.d.ts:56` 注释为 "Stage-one prefetch mark"，`dsh-client-web/lib/index.js:363` 只用它决定"启动时是否提前 load 脚本以注册 factory"。不带 `immediately` 只是把脚本加载推迟到 create-side import 那一瞬（仍在启动序内），不是推迟到用户点击。

5. **反向也走不通（catch-22）**：若把 runtime 从启用条目里摘掉，它就不再是 graph row；此时 `modules.import('dsh-skin-runtime')` 会命中 `dsh-client-modules/lib/client.js:147-149` 的 `throw new Error('client-modules: cannot resolve "…" — not a seed word, not a shell-own module, and not a row in the boot graph')`。也就是说**跨包懒加载在这套模块系统里没有可用姿势**：要么启动即载，要么根本 import 不到。

**因此："拆包是否真的解决了卡顿" = 没有。** 拆包唯一的实际效果是：多了一个 3 KB 的入口包、多了一份 1.26 MB 的资源副本、启动时多注册一个被遮盖的槽位条目；1.19 MB 的到达时机与解析成本完全没变。合并方案里"延续懒加载路线"必须重新定义为**同一个 bundle 内的懒渲染 / 懒执行**（点开二级面板才 render、才注入 CSS、才 JSON.parse），而不是跨包懒加载。

若要真正削减启动 payload，唯一可行方向是**把 815 KB base64 图从 JS bundle 里搬出去**（改为皮肤激活时才取的外部资源），或不再把 9 套 bundle 文本内联进 client.js——这两条都属于方案设计，不在本报告范围。

---

## 3. 卡顿根因证据（分三类，每条给代码依据）

下面区分"启动/开设置页一次性成本"与"滚动时每帧成本"。**滚动卡顿的强证据集中在 C 类（皮肤已应用时）**；A/B 类是开页面时的一次性开销，不解释滚动掉帧，但会让"打开设置"变慢。凡是我没有代码依据的猜测，都标注为"排除"或"弱"。

### A 类：启动 / 首次打开的一次性解析成本

| 证据 | 位置 | 量级 |
|---|---|---|
| runtime 产物 1249199 B 单文件，启动即到达并解析（§2.3） | `skin-runtime/lib/client.js` | 1.19 MB JS 解析 |
| 其中 9 个巨型字符串字面量 `__SKIN_BUNDLES__`（含 4 张 base64 图共 ~815 KB）在 materialize 时全部分配为常驻字符串 | `skin-runtime/lib/client.js:5`（`const __SKIN_BUNDLES__ = {...}`），来源 `build.mjs:34-46,65` | ~1.17 MB 常驻内存 |
| theme 产物 51 KB，含 720 个颜色字符串 | `theme-gallery/lib/client.js` | 小，可接受 |

引擎构造本身**不重**：`createSkinEngine`（`skin-engine.js:93-107`）只做参数校验和建 Map，没有遍历 bundles。这一条排除。

### B 类：设置页渲染 / 重渲染成本

**B1（真实、可量化）：render body 里做同步 localStorage 读 + JSON.parse，且量随自定义皮肤数线性增长。**

- `skin-runtime/src/client.js:170` `const allSkins = customSkinApi.getSkins()`
  → `custom-skin.js:189-191 getSkins()` → `buildSkinList()` → `getCustomItems()` → `readCustomItems()`（`custom-skin.js:70-77`）= `localStorage.getItem('skin-gallery-custom-v1')` + `JSON.parse(整个 registry)`。
- 同一次 render 里还有 `:171` `currentSkinState()`（`custom-skin.js:198-204` → `findByCustomId` → **又一次**完整 read+parse）与 `:175` `getPreviewState()`（`client.js:66` → 2 次 `readStored`）。
- registry 里存的是**皮肤 client.js 全文**（`custom-skin.js:236` `bundleText: client`），单包上限 base64 后 256 KB（`custom-skin.js:22`），最多 8 个（`:23`）。
  ⇒ 装了自定义皮肤后，**每次 render 至少同步 parse 一次全量 registry（可达 ~1.5 MB 文本）两遍**。搜索框输入一个字符即触发一次 render（`:150` `useState(query)`）。
- theme 侧同病但量小：`theme-gallery/src/client.js:131-132` 在 render body 调 `getCustomThemes()` 与 `getCustomAppliedId()`；后者（`custom-theme.js:157-163`）最多 3 次 `getItem` + 1 次 `JSON.parse`。自定义主题只存 token（KB 级），影响小。

**B2（弱）：卡片一次性全量渲染，无虚拟化。** `theme-gallery/src/client.js:147-165` 无条件渲染全部 15 张卡（每卡 ~7 个元素）；`skin-runtime/src/client.js:396-431` 渲染 9+ 张卡（每卡 ~8 个元素 + 2~3 个按钮）。合计约 200 个 DOM 节点。**这个量级不足以造成滚动卡顿**，如实标注为弱证据，不作为主因。

**B3（弱）：CSS 注入。** 两个包各在 `ctx.effect` 里插一个 `<style>`（`theme-gallery/src/client.js:208-214`；`skin-runtime/src/client.js:435-441`），分别 ~3.3 KB / ~4.2 KB 纯类选择器。不构成阻塞。`.theme-gallery-card:hover` / `.is-active` 用了 `color-mix(in srgb, …)`（`theme-gallery/src/client.js:29,33,49`），只在 hover/选中时参与计算，弱。

**B4（弱）：`designSummary` 每次 render 重建。** `skin-runtime/src/client.js:219-273` 用数组 `join('\n')` 拼一段 ~2 KB 文本，且 `:317` 塞进 `<textarea value>`。只在 `designOpen` 时渲染，但字符串拼接在 render body 无条件执行。

**B5：全量重渲染放大 B1。** 两包都用 `force((v)=>v+1)` 订阅式重渲染（`theme-gallery/src/client.js:109-110`；`skin-runtime/src/client.js:162-163`），任何 notify 都会整块重渲染并重跑 B1 的 localStorage 读。

### C 类：皮肤已应用时的每帧成本（滚动卡顿的强证据）

| 证据 | 位置 | 说明 |
|---|---|---|
| **`background-attachment: fixed` + `background-size: cover` 打在 `<body>` 上，背景是 286 KB base64 大图** | `skins/blue-fantasy/client.js:87`（`body.style.setProperty("background-attachment","fixed")`，同段 `:83-88` 设 background-image/position/size/repeat） | fixed 背景在滚动时强制整视口重绘，是教科书级滚动掉帧原因 |
| 同一手法 | `skins/miku/client.js:122`、`dragon-heir/client.js:90`、`whale-song/client.js:83`、`xp/client.js:8`（CSS 里 `background-attachment:fixed`） | 5/9 皮肤命中 |
| **`backdrop-filter: blur(...)`** | `skins/miku/client.js:8` 起共 **45 处**（如 `blur(5px)`、`blur(10px)`）；blue-fantasy 5 处；whale-song 5 处 | backdrop-filter 每帧需重采样背景，与 fixed 背景叠加代价最高 |
| 大量 `box-shadow` | xp 60 处、miku 58、qq98 50、minecraft 24、ths 20 | 阴影多则合成/重绘成本升高 |
| 常驻 `setInterval` | `skins/ths/client.js`（`setInterval(refreshCodeIndex, CODE_INDEX_REFRESH_MS)`）、`skins/trading/client.js`（3 处，含 `setInterval(() => renderSessions(new Date()), SESSION_REFRESH_MS)`） | 皮肤激活期间持续占主线程 |
| MutationObserver | 5 皮肤各 1 个 | **已核实无害**：`blue-fantasy/client.js` 的 `observer.observe(body, { attributes:true, attributeFilter:["data-ds-dark-theme"] })` 范围极窄，不随 DOM 变动触发。如实排除 |

**theme-gallery 的 15 主题预览有没有同样问题？答：没有。**
- 预览色块是纯色 `background`（`src/client.js:154-159` 用 `item.preview.light/dark.background|accent` 内联 style），无图片、无 blur、无 fixed。
- 主题应用只走 `themeService.overrideTokens('dsh-theme-gallery', tokens)`（`src/client.js:69,82`）注入 24 个 CSS 变量，不注入 body 背景图。
- `.theme-gallery-grid` 明确不含 `overflow` / `max-height`（有专门的静态断言测试守着，见 §8）。
- 唯一与 skin 同源的问题是 B1 的 render body localStorage 读，量级小一个数量级。

### 结论排序（给方案用）

1. 滚动卡顿主因在 C 类：**皮肤被应用后**的 fixed 大图背景 + backdrop-filter，与"设置页有多少张卡"无关，也与合并/拆包无关——**合并本身不会修掉它**。
2. "打开设置→通用慢"主因在 A 类（1.19 MB 启动解析）+ B1（render body 的全量 JSON.parse）。这两条**合并方案能改**：A 靠不把大图内联进 bundle，B1 靠把 registry 读缓存到 render 之外。
3. B2（卡片数量、无虚拟化）在当前 15+9 的规模下不是瓶颈，不必为它引入虚拟化。

---

## 4. 构建链现状

### 4.1 全仓构建脚本矩阵

| 包 | build.mjs | tsdown | `build` | `check` | `test` |
|---|---|---|---|---|---|
| theme-gallery | Y | - | `node build.mjs` | `node build.mjs --check` | `node --test "tests/unit/*.test.mjs"` |
| skin-gallery | Y | - | `node build.mjs` | `node build.mjs --check` | 同上 |
| skin-runtime | Y | - | `node build.mjs` | `node build.mjs --check` | 同上 |
| turn-scrubber | Y | Y | `node build.mjs` | `tsc --noEmit` | 无 |
| dsh-session-manager | Y | Y | `node build.mjs` | `tsc --noEmit` ×2 | unit/acceptance/integration |
| dsh-composer-tools | Y | Y | `node build.mjs` | `tsc --noEmit` ×2 | acceptance |
| pet-bridge | - | - | 无 scripts | - | - |

根 `package.json`：`build = pnpm -r build`，`check = pnpm -r check`。

### 4.2 skin-gallery 的 `lib/client.js` 是手工维护的（**高危landmine**）

- 产物 3204 B = `src/client.js` 2998 B + 壳 ~206 B，**不可能**是 `build.mjs` 的输出。
- `skin-gallery/build.mjs:56-68` 明确会把 manifest + 全部 9 个 bundle + engine + custom-skin + a11y **全部内联**后写入 `./lib/client.js`（`:67-68` `mkdir` + `writeFile`）——跑一次就会把 3 KB 入口产物覆盖成 >1.2 MB 的完整包，**入口设计当场失效**。
- git 履历印证手工产出：`git log -- packages/skin-gallery/lib/client.js` 显示 `9d4743a`（perf: split…）之后是 `70c230d`（手工补壳）；`70c230d` 的 diff 就是在文件头手加 3 行壳（`+window.__ModuleLoader__.load({ id: "dsh-skin-gallery", factory: (require) => {` / `+  var module = …` / `+  const React = require('react');`）。commit message 亦自述"懒加载拆分后**手工产出**的入口包缺壳"。
- **更危险的是它是静默的**：`build.mjs:70-79` 的 `--check` 只校验"有壳 / 有 exports / 9 个皮肤 id 都在 / `__SKIN_BUNDLES__` 与 `__SKIN_A11Y__` 存在"。这些断言在**被覆盖后的 1.2 MB 版本上全部通过**。所以 `pnpm check`（= `pnpm -r check`）不但不能发现问题，它本身就是破坏源。
- 本次调研因此**刻意没跑任何 build/check**（只跑了不写文件的 `node --test`）。

### 4.3 壳校验（`__ModuleLoader__.load`）在哪些包有、哪些缺

| 包 | `--check` 是否校验壳 | 依据 |
|---|---|---|
| theme-gallery | **有** | `build.mjs:27` `if (!generated.includes('window.__ModuleLoader__.load')) throw`；另有 `:28` 校验 `module.exports = { apply }`、`:29-30` 校验 <100 KB |
| skin-runtime | **有** | `build.mjs:72` 同款壳断言；`:73` 校验 `exports.apply`/`exports.inject`；`:74-79` 校验 9 皮肤与资源已嵌 |
| skin-gallery | 形式上有、实质无效 | 同 `build.mjs:72`，但如 §4.2 所述，该 check 只能在"被 build 覆盖后的错版本"上通过；对当前手工产物它甚至跑不到（先写后读） |

三个包的 `lib/client.js` 壳现状（实测 head/tail）：

- theme-gallery：头 3 行 `window.__ModuleLoader__.load({ id: "dsh-theme-gallery", factory: (require) => {` / `var module = { exports: {} }; var exports = module.exports;` / `const React = require('react');`；尾 `module.exports = { apply }; return module.exports; } });` ✅
- skin-runtime：同款头 3 行（id 为 `dsh-skin-runtime`）；尾 `exports.apply = apply; exports.inject = ['slots']; return module.exports; } });` ✅
- skin-gallery：同款头 3 行（id 为 `dsh-skin-gallery`，手工补）；尾同 runtime ✅

**铁律 1 的落地现状：三个包当前都合规**，但 skin-gallery 的合规靠人手维护、且随时会被 `pnpm -r build|check` 抹掉。合并后必须让壳由构建脚本生成，并把壳断言做成**先校验后落盘**（或校验独立于 build 之外），否则同样的事故会再来一次。

### 4.4 node 半边

`{src,lib}/index.js` 三包都只是 `export const name = '...'; export function apply() {}`（占位）；`lib/invariant.js` 是 `export function apply() {}`。合并时这三个文件合成一份即可，没有实际逻辑要迁。

---

## 5. 主题↔皮肤互斥机制（共享键 `dsh-appearance-track-v1`）

读写实现分布（`grep -rn dsh-appearance-track-v1`）：

| 文件 | 位置 | 职责 |
|---|---|---|
| `theme-gallery/src/custom-theme.js` | `:25` 定义 `export const TRACK_KEY`；`:45-50` `readTrack`；`:52-57` `writeTrack` | theme 侧唯一读写点 |
| `theme-gallery/lib/client.js` | `:32`（内联后的同一份） | 构建产物 |
| `skin-gallery/src/custom-skin.js` | `:21` 定义；`:56-61` `readTrack`；`:63-68` `writeTrack` | 与 theme 侧**同键同语义的独立副本** |
| `skin-runtime/src/custom-skin.js` | `:21`/`:58`/`:65`（与 skin-gallery 逐字节相同） | 同上 |
| `skin-runtime/lib/client.js` | `:362` | 构建产物 |

- 值域：`'theme' | 'skin' | ''`（非法值读作 `''`；写入 `''` 走 `removeItem`）。
- theme 侧写 `'theme'` 的时机：`custom-theme.js:189 applyCustomTheme`、`:203 deleteCustomTheme`（删掉正应用项后回 jade）、`:214 restoreDefaultTheme`、`:225 activateFamily`。
- skin 侧写 `'skin'` 的时机：`custom-skin.js:270 applyCustomSkin`、`:282 deleteCustomSkin`、`:291 restoreDefaultSkin`、`:305 activateSkin`。
- **软互斥**：两侧都只在"用户明确应用本轨"时才写键，不会主动抢占对侧；也没有任何一侧读到对侧值后强制卸载对侧。`preview`（试穿）刻意不写键（`custom-theme.js:179`、`custom-skin.js:256` 注释 A3）。
- 设计约束原文：`.devflow/PLAN-theme-skin-custom.md:18`"两包不互相依赖、不互相 import。互斥靠共享 localStorage 轨道键协商"；`.devflow/INTERFACE-theme-skin-custom.md:33` 定义值域。
- 有专门测试守着：`theme-gallery/tests/unit/track-mutex.test.mjs`、`tests/acceptance/theme-custom.test.mjs`（B3 用例"对侧 skin 已激活时，主题包不主动覆盖 track"）。

**合并影响**：一旦合成单包，"两个独立包经 localStorage 协商"的理由消失，键的读写会落在同一模块作用域内（甚至可以退化为内存变量）。但**这个键是持久化状态**，老用户的 localStorage 里已有值；合并后若改键名或改语义，会导致老用户的"当前外观"判定错乱。同时 `skin-*` / `theme-gallery-*` 系列键（见 §6）也全部要保持兼容。

---

## 6. 自定义导入功能（合并时要整体搬迁的功能面）

### 6.1 主题 JSON 导入 — 全部在 theme-gallery

| 功能 | 位置 |
|---|---|
| 校验器 `validateTheme(jsonText, builtinIds)` | `theme-gallery/src/custom-theme.js:102-128` |
| API 工厂 `createCustomThemeApi({storage, builtinThemes, applyTokens})` | `:131-250`，导出 `importCustomTheme / previewCustomTheme / applyCustomTheme / deleteCustomTheme / restoreDefaultTheme / getCustomThemes / getCustomAppliedId / getThemes / activateFamily / get,setAppearanceTrack` |
| 错误码常量 `ERR` | `:29-35`（`ERR_IMPORT_INVALID_JSON` / `ERR_THEME_MISSING_FIELD` / `ERR_THEME_BAD_TOKEN` / `ERR_THEME_ID_CONFLICT` / `ERR_UNKNOWN_ID`） |
| storage 键 | `:18-24`：`theme-gallery-custom-v1`、`theme-gallery-custom-applied-v1`、`theme-gallery-family-v5`、`theme-gallery-custom-touched-v1` |
| UI（textarea 粘贴 JSON + 导入/试穿/应用/删除/恢复按钮） | `theme-gallery/src/client.js:116-129`（handler）、`:175-204`（渲染） |
| 接线（真实 token 注入） | `src/client.js:64-71`，`applyTokens` → `themeService.overrideTokens('dsh-theme-gallery', tokens)` |
| 校验规则要点 | 必须 `id`（`/^[a-z0-9][a-z0-9-_]{0,63}$/`）、`label`（≤80 字）、非空 `tokens`；token 名须 `--dsw-` 前缀，值须 `{light,dark}` 非空字符串（`:85-90`）；值不得含 `}` 或中间的 `;`（`:92-99` `sanitizeValue`）；与内置 15 id 冲突则 `ERR_THEME_ID_CONFLICT`；**CSS-only，全程不执行 JS** |

### 6.2 皮肤三件套导入 — 实现在 skin-gallery/src 与 skin-runtime/src（两份逐字节相同），但**只有 skin-runtime 的那份被构建进产物、才是活的**

| 功能 | 位置（以 skin-runtime 为准） |
|---|---|
| 元数据校验 `validateSkinMeta` | `src/custom-skin.js:138-159` |
| bundle 静态校验 `validateBundle` | `src/custom-skin.js:113-135`（包内默认实现） |
| 同源校验器 `validateCustomBundle` | `src/skin-engine.js:45-90`（浏览器实际用的是这份，`src/client.js:139` 传入） |
| API 工厂 `createCustomSkinApi({storage, builtinSkins, validate, engine})` | `src/custom-skin.js:164-348`，导出 `importCustomSkin / previewCustomSkin / applyCustomSkin / deleteCustomSkin / restoreDefaultSkin / getSkins / currentSkinState / registerCustomBundle / teardownSkins / activateSkin / previewSkin / applySkin / clearSkin / getAppearanceTrack` |
| 动态注册进引擎 | `src/skin-engine.js:167-191 registerCustomBundle`（写 `bundles[id]`、插/替 manifest 条目、`source:'custom'`） |
| 实际执行 | `src/skin-engine.js:141-155 loadSkin` → `modules.invalidate(pkg)` → `runScript(bundleText)` → `modules.import(pkg)` 取 `apply`；默认 `runScript` 是 Blob-URL 经典脚本（`:294-310`） |
| a11y 注入 | `src/skin-a11y.js`（`createA11yInjector({a11y})`），`src/client.js:24,46` 接线 |
| 错误码 | `src/custom-skin.js:26-36`（+`ERR_SKIN_MISSING_FILE / BAD_META / CONTRACT / DANGEROUS / SIZE / COUNT`） |
| 容量/数量上限 | `:22` `MAX_BUNDLE_B64 = 256*1024`；`:23` `MAX_CUSTOM_COUNT = 8`；校验在 `:225-230` |
| storage 键 | `:18-20`：`skin-gallery-custom-v1`、`skin-gallery-custom-applied-v1`、`skin-gallery-skin-v1` |
| UI（3 个 textarea 粘贴 skin.json/client.js/a11y.css + 导入/试穿/应用/勾选删除/恢复） | `src/client.js:322-348`（导入区）、`:349-388`（删除区+二次确认）、`:396-431`（卡片与试穿/应用按钮） |
| "创建自定义皮肤"设计助手（生成给 AI 的提示词文本） | `src/client.js:219-273` + `:306-321` 渲染 |

**注意**：`skin-gallery/src/` 里那份 `custom-skin.js` / `skin-engine.js` / `skin-a11y.js` / `skins/` 全是**死代码**——`skin-gallery/build.mjs` 虽然会读它们，但当前 3 KB 的手工产物里没有它们。合并时按 skin-runtime 的那份搬，skin-gallery 的整份可直接丢弃。

### 6.3 外部已交付皮肤包依赖的导入契约点

对象：`/Users/wsxwj/Desktop/claude/dsh plugin:prest/navigation-diary/skins/navigation-diary`（`skin.json` 717 B、`client.js` 92863 B、`a11y.css` 2363 B）。按要求**只列它依赖的契约点，不审它**：

1. `skin.json` 必填四字段 `id / name / author / license`（`custom-skin.js:146-150`）；`id` 须匹配 `/^[a-z0-9][a-z0-9-_]{0,63}$/`（`:151`）；不得与 9 个内置 id 冲突（`:152`）。可选被读取的字段：`accent`、`bodyAttr`（缺省 `data-dsh-<id>`）、`order`（`:155-157`）。它 json 里的 `nameEn / tagline / description / tags` 中，`description` 与 `tags` **不被校验器读取**。
2. `client.js` 必须包含字面量 `window.__ModuleLoader__.load({` 且包含 `factory`，且全文括号配平（`skin-engine.js:66-69`）。
3. `client.js` 必须能被 `/\bapply\s*(\{|:)/` 或 `/function\s+apply/` 匹配到（`skin-engine.js:77-79`）。
4. `apply` 只能用 `ctx.effect` / `ctx.get`——全文任何 `ctx.<其它名>` 都会被拒（`skin-engine.js:80-88`，正则扫全文，**注释里出现也算**）。
5. 高危黑名单为**纯子串匹配**，命中任一即拒：`eval(`、`new Function(`、`import(`、`require(`、`<script src=`、`fetch(`、`XMLHttpRequest(`、`WebSocket(`、`localStorage`、`sessionStorage`、`document.cookie`、`chrome.runtime`（`skin-engine.js:47-51`）。注释/字符串里出现同样会被拒。
6. 体积：`base64(skin.json 文本 + client.js 文本)` ≤ 262144（`custom-skin.js:225-226`）。实测该包 raw 93580 B → base64 **124776 B**，**通过**（余量约 1.1 倍）。`a11y.css` 不计入这个上限。
7. 数量：已存自定义皮肤 ≥8 时新增被拒（`custom-skin.js:230`）。
8. 导入入口形态：**不是文件选择器**，是 skin-runtime 设置页里 3 个 textarea 手工粘贴（`src/client.js:325-339`）。
9. 落盘形态：整段 `client.js` 文本作为 `bundleText` 写进 localStorage（`custom-skin.js:236`），激活时 Blob-URL 执行。

---

## 7. 发布现状

### 7.1 git：GitHub main 与本分支**没有差异**（任务前提需修正）

```
$ git rev-parse --abbrev-ref HEAD          → feature/theme-skin-custom-system
$ git log --oneline -3
70c230d fix(skin): 补懒加载入口的 ModuleLoader 注册壳；运行时槽位 priority -1 遮盖入口
ce1151f chore: align lazy skin entry source with built bundle
49f004c Merge remote-tracking branch 'github/main' into feature/theme-skin-custom-system

$ git branch -a -v
* feature/theme-skin-custom-system  70c230d
  main                              a5e54c5 [落后 22]        ← 本地陈旧分支，不是已发布的 main
  remotes/github/main               70c230d
  remotes/origin/main               9921fb2                  ← origin 是本地路径仓库，非 GitHub

$ git ls-remote github refs/heads/main    （第 1 次被代理拦，第 2 次成功）
70c230d7efecf7fe7e1cb3935a67d9a3e1f98908  refs/heads/main
```

**结论：`github/main` 已经是 `70c230d`，与 HEAD 完全一致，差异为空**（`git log github/main..HEAD` 与 `git log HEAD..github/main` 均无输出）。任务描述里"GitHub main（ce1151f）"是过期信息——`ce1151f` 之后 `70c230d` 也已推送。这与 `PROJECT.md` 里"止血：70c230d 已推 GitHub main（ce1151f..70c230d，ls-remote 核实）"的记录一致。

顺带：`LEARNINGS.md:19` 写"已修：2026-08-17 给 lib/client.js 补壳（**未提交**，见 git diff）"——这句现在是**过期的**，该修复已是 `70c230d` 并已推送。合并时顺手更正。

remote 配置：`github` = `git@github.com-wsxwj123:wsxwj123/dsh-plugins.git`（SSH 账户别名，符合本机代理规则）；`origin` = 本地目录 `/Users/wsxwj/Desktop/app/dsh-plugins`。

工作区状态：干净，仅一个未跟踪文件 `PROJECT.md`（本次合并任务的 dev-flow 立项文件）。

### 7.2 README 需要改的地方（清单）

`README.md`（9140 B，中文主文档）：

| 行 | 现状 | 合并后问题 |
|---|---|---|
| 9 | 插件表列 `dsh-theme-gallery`（15 主题） | 要换成合并后的新包 |
| 10 | 插件表列 `dsh-skin-gallery`"独立承载 9 个完整皮肤复刻，避免主题设置页加载大体积皮肤资源" | 描述本身已不准确（皮肤资源实际在 skin-runtime），且 **`dsh-skin-runtime` 从未出现在表里** |
| 32-39 | 仓库结构代码块只列 theme-gallery / turn-scrubber / pet-bridge / dsh-session-manager / dsh-composer-tools | **完全没有 skin-gallery / skin-runtime**，已陈旧 |
| 63-67 | 只有"安装主题画廊"一条 `dsh plugin --profile web add "link:$PWD/packages/theme-gallery"` | **全文没有任何皮肤包的安装命令**——用户按 README 装不上皮肤 |
| 117-122 | 本地构建写 `pnpm build` / `pnpm check` | 见 §4.2，这两条对 skin-gallery 是破坏性的；合并后需重新表述 |
| 126-146 | "主题画廊简介" + 15 家族列表 | 迁到新包名下 |
| 148-163 | 自定义主题 JSON 格式与规则 | 内容仍有效，需换包名 |
| 165-181 | "完整皮肤自定义（skin-gallery）"整节 | 包名与"内置 9 款"归属都要改 |
| 183-195 | 状态机 + 第 195 行"**两包**经共享键 `dsh-appearance-track-v1` 软互斥" | "两包"表述失效，要改成单包内两轨 |
| 197-214 | 错误码表（12 条） | 内容有效，保留 |
| 22 | 截图 `assets/screenshots/theme-gallery-real.png` | 合并后界面变成"入口+二级面板"，截图要重拍 |

`README.en.md`（2309 B，英文版）：

| 行 | 现状 | 合并后问题 |
|---|---|---|
| 9-10 | Packages 表只列 `dsh-theme-gallery` 与 `dsh-turn-scrubber` | **skin 三包一个都没有**，已严重陈旧 |
| 14-18 | layout 代码块只写 `theme-gallery/` + `future-plugin/` | 陈旧 |
| 24-27 | `pnpm build` / `pnpm check` | 同上破坏性问题 |
| 33 | 自定义主题格式 | 换包名 |
| 34 | `dsh-skin-gallery` custom skin pack 三件套 | 换包名 |
| 35 | "govern **the two galleries**" | 单包后表述失效 |
| — | 无安装命令、无截图、无错误码表（指向 README.md） | 合并后可保持这种"英文简版"策略 |

另有各包自己的 `README.md` / `README.zh-CN.md` / `CHANGELOG.md`：theme-gallery（4100 / 3609 / 1636 B）、skin-gallery（3290 / 2030 / 764 B）、skin-runtime（3290 / 2030 / 764 B，与 skin-gallery 逐字节相同）。合并后三套要并成一套。

---

## 8. 测试现状

### 8.1 清单与覆盖

**仓库根 `tests/acceptance/`（3 个文件，30 个用例，当前全绿）**

| 文件 | 覆盖 | 指向的包 |
|---|---|---|
| `theme-custom.test.mjs` | 主题状态机（none→import→preview→applied→delete→restore）、导入错误契约 C1-C6、未知 id、内置不可删、轨道互斥 B3 | `packages/theme-gallery/src/acceptance-api.mjs` |
| `skin-custom.test.mjs` | 皮肤受控导入：缺文件、坏元数据、契约、12 条高危黑名单、256KB 上限、8 个数量上限、id 冲突、生命周期 | **`packages/skin-gallery/src/acceptance-api.mjs`**（第 17 行）——指向的是 §6.2 所说的死代码副本 |
| `theme-skin-build-static.test.mjs` | 滚动契约（`.-grid` 无 overflow/max-height）、theme 产物 <100KB、README 必须提到 id/label/tokens/light/dark、三件套文件名、状态机与 `ERR_` | 读 `packages/theme-gallery/lib` 与 **`packages/skin-gallery/lib`**（第 12-13 行） |

**各包 `tests/unit/`**

| 包 | 文件数 | 覆盖 | 实测 |
|---|---|---|---|
| theme-gallery | 3（`custom-theme` / `scroll` / `track-mutex`） | 导入校验、自定义主题状态机、滚动契约静态断言、轨道键 | **16 用例，15 过 1 败** |
| skin-gallery | 8（`skin-engine` / `custom-skin` / `custom-skin-engine` / `contrast` / `a11y-degrade` / `attribution` + 2 个 harness） | 引擎全链路（真实 qq98/ths bundle）、可逆卸载、切换互斥、9 皮肤×亮暗对比度、a11y 缺失降级、NOTICE/LICENSE/作者一致性 | 39 用例全过 |
| skin-runtime | 8（**与 skin-gallery 逐字节相同**，`diff -rq` 无差异） | 同上 | 39 用例全过 |
| turn-scrubber / pet-bridge | 0 | — | — |

（skin-gallery / skin-runtime 的单测**只测 `src/`**，所以两边都过；它们测不到"skin-gallery 的 lib 产物已经不含皮肤"这件事。）

### 8.2 已存在的失败：theme-gallery 的 scroll 测试在 HEAD 上是红的

```
$ cd packages/theme-gallery && node --test --test-force-exit "tests/unit/*.test.mjs"
ℹ tests 16   ℹ pass 15   ℹ fail 1
✖ .skin-gallery-grid 不含 overflow 或 max-height
  AssertionError: 应能匹配 .skin-gallery-grid 的 CSS 块
  at tests/unit/scroll.test.mjs:28
```

根因：`theme-gallery/tests/unit/scroll.test.mjs:13` 硬编码了跨包路径 `../../../skin-gallery/lib/client.js`，并在 `:28` 断言 `matches.length > 0`。懒加载拆分后 skin-gallery 的产物里只有 `.skin-entry-*` 类，没有 `.skin-gallery-grid`，于是断言失败。

对比：根 `tests/acceptance/theme-skin-build-static.test.mjs:20-41` 的同名检查写得宽松（只在匹配到时才断言 overflow/max-height，匹配不到不报错），所以它仍然全绿——**这条绿是假绿**，它现在实际上没在校验 skin 侧的滚动契约。

### 8.3 合并对测试面的影响（事实清单）

1. 三处硬编码路径必须改：`theme-gallery/tests/unit/scroll.test.mjs:12-13`、`tests/acceptance/skin-custom.test.mjs:17`、`tests/acceptance/theme-skin-build-static.test.mjs:12-13`。
2. `acceptance-api.mjs` 是黑盒测试的唯一接线点（theme 1414 B / skin 3460 B），合并后要并成一份，且保持导出名不变（`createThemeAcceptanceApi` / `createSkinAcceptanceApi` / `memoryStorage` / `BUILTIN_THEME_IDS` / `BUILTIN_SKINS`），否则 30 个验收用例全断。
3. skin 的 8 个单测有两份完全相同的副本，合并后应只留一份（删除即可，无内容损失）。
4. 现有测试**没有任何一条**覆盖"启动时 loader 条目能否 import 成功""壳是否存在"——`70c230d` 那次线上事故正是这个盲区。合并时若要防复发，需要新增一条针对 `lib/client.js` 的壳静态断言（且不能依赖 build 先写盘）。
5. 现有测试也**没有**覆盖 §2 的槽位注册（id/order/priority）。同 id 同 priority 撞车属于启动期 throw，静态断言可覆盖。

---

## 9. 对合并方案的关键约束清单

### 9.1 两条既有铁律（已在本次调研中核实为真，且必须保留）

**C1 — `lib/client.js` ≠ `src/client.js`：产物必须多一层自注册壳。**
壳形态（三包一致，实测）：首行 `window.__ModuleLoader__.load({ id: "<包名>", factory: (require) => {`，次行 `var module = { exports: {} }; var exports = module.exports;`，第三行 `const React = require('react');`；末尾 `return module.exports; } });`。
宿主依据：`dsh-client-modules/README.zh.md` + `lib/client.js` 的惰性 CJS 模型——执行 bundle 只允许"注册 factory"，模块体副作用必须在 factory 闭包内。缺壳 → 启动报 `bundle loaded without registering "<id>" via __ModuleLoader__.load`（`LEARNINGS.md:16`）。
**且**：壳内 `const React = require('react')` 不可省——三个包的裸代码都直接用全局 `React`。

**C2 — `settings.general.item` 槽位遮盖语义。**
同 id + 同 priority = 启动 throw（`dsh-client-ui-slots/lib/index.js:63-88`）；同 id + 不同 priority = 合法遮盖，**priority 数值最低者渲染**（`:123` 排序 + `:180-193` 每 cell 取首个）。skin-runtime 以 `priority:-1` 遮盖入口的 `0`（`skin-runtime/src/client.js:444-445`），**这个机制不能删**（若合并后仍保留"入口条目 + 完整面板条目"两条注册的话）。
补充事实：视觉顺序由 `order` 决定、与 priority 无关（`dsh-client-web-react/lib/index.js:710`）。

### 9.2 本次调研新发现的硬约束

**C3 — 跨包懒加载在这套模块系统里不存在可用姿势（推翻"拆包省启动成本"的前提）。**
启用的 cordis 条目 = boot graph row = 启动时被创建成 loader 条目并 import（`dsh-client-web/lib/index.js:262-272`）；不启用则不是 row，`modules.import()` 直接 throw（`dsh-client-modules/lib/client.js:147-149`）。
⇒ 合并后的"入口 + 二级面板"只能是**同一 bundle 内的懒渲染/懒执行**，不能指望把 payload 推迟到点击。方案里"延续懒加载路线"必须这样定义，否则等于什么都没做。

**C4 — 1.19 MB payload 的真实构成决定了优化着力点。**
815 KB（65%）是 4 张内嵌 base64 背景图（blue-fantasy 286 KB / whale-song 205 KB / dragon-heir 110+106 KB / miku 85 KB）。不动这部分，合并后单包 bundle 仍 ≥1.2 MB，启动解析成本原样保留。

**C5 — `pnpm -r build` / `pnpm -r check` 当前是破坏性操作，且静默。**
`skin-gallery/build.mjs:56-68` 会把 3 KB 手工入口产物覆盖成 >1.2 MB 完整包，而 `:70-79` 的 `--check` 在被覆盖后的错版本上照样通过。合并方案必须消灭这个状态：产物由脚本唯一生成，壳断言先于/独立于落盘。

**C6 — 安装态清理是启动能否成功的前提（同 id 撞车风险）。**
`~/.dsh/profiles/web/package.json` 的 `dsh.profile.bundles` 现同时启用 `dsh-theme-gallery` / `dsh-skin-gallery` / `dsh-skin-runtime` 三项（均 `link:` 到本仓）。若新包也注册 `id:'skin-gallery'`（priority 0）而旧 skin-gallery 仍启用，两者同 id 同 priority → 启动 throw。**合并发布必须包含"先卸旧三包、再装新包"的迁移命令**，并在 README 写清。同理 `id:'theme-gallery'` 也要避让。

**C7 — 持久化键必须保持兼容（否则老用户外观错乱）。**
需原样沿用的 7 个 localStorage 键：`dsh-appearance-track-v1`（共享轨道键）、`theme-gallery-family-v5`、`theme-gallery-custom-v1`、`theme-gallery-custom-applied-v1`、`theme-gallery-custom-touched-v1`、`skin-gallery-custom-v1`、`skin-gallery-custom-applied-v1`、`skin-gallery-skin-v1`。用户已导入的自定义皮肤 `bundleText` 全在 `skin-gallery-custom-v1` 里，改键即丢数据。

**C8 — 导入契约是对外承诺，不能顺手改。**
已有外部交付物（`navigation-diary`，93.6 KB → base64 124776 B）依赖 §6.3 那 9 条。特别是：三件套字段集、`__ModuleLoader__.load({` 字面量、`ctx` 白名单只有 `effect`/`get`、12 条纯子串高危黑名单、256 KB base64 上限、≤8 个。README.md:176-179 与 README.en.md:34 已把这些写成公开文档。

**C9 — 滚动卡顿的主因不在合并范围内。**
5/9 皮肤用 `background-attachment: fixed` + 大 base64 图（`blue-fantasy/client.js:87` 等），miku 有 45 处 `backdrop-filter: blur()`。这些是皮肤资源自身的属性，**合并不会改善它**。验收标准若写成"应用任意皮肤后滚动不卡"，当前资源做不到；写成"未应用皮肤时打开设置→通用滚动不卡"才是可达的。

**C10 — 有一条测试在 HEAD 上已经是红的，且有一条是假绿。**
`theme-gallery/tests/unit/scroll.test.mjs:13,28` 现在必然失败（跨包硬编码路径）；`tests/acceptance/theme-skin-build-static.test.mjs:20-41` 因为写得过于宽松而假绿。合并时这两处都要修，不能把"测试全绿"当作合并成功的判据而不先处理它们。

### 9.3 可以安全删除的东西（合并时的净收益）

- `packages/skin-gallery/` 整个目录：其 `src/{skin-engine,custom-skin,skin-a11y,acceptance-api}.js` 与 `skins/`（1.26 MB）对其 3 KB 产物是死代码；`tests/unit/` 8 个文件与 skin-runtime 逐字节重复。
- 1.26 MB 皮肤资源的第二份副本（两包完全相同）。
- 三份重复的 `README.md` / `README.zh-CN.md` / `CHANGELOG.md`（skin-gallery 与 skin-runtime 的这三对文件逐字节相同）。
- 三份占位 `index.js` / `invariant.js`（无逻辑）。
