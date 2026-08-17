# PLAN — 外观插件合并（theme-gallery + skin-gallery + skin-runtime → dsh-appearance-gallery）

方案日期 2026-08-17。基线 `feature/theme-skin-custom-system` @ `70c230d`。
事实源：`.devflow/RESEARCH-merge-baseline.md`（下文引用为「§n」）与本方案代理复核过的代码位置（给行号的都已亲自读过）。
本文件只写方案，未改任何代码。第 3 节全文另存为 `.devflow/INTERFACE.md`（测试设计唯一输入）。

> 说明：`.devflow/PLAN.md` / `INTERFACE.md` 原为 2026-08-14「九款皮肤」那一轮的产物，已被本轮覆盖。
> 需要旧文时用 `git show HEAD:.devflow/PLAN.md`。

---

## 1. 架构与技术选型

### 1.0 一句话架构

**一个包、一个构建产物、一个槽位条目、一份皮肤资源**；「入口 + 二级面板」由同一个 bundle 内的 React 条件渲染实现；卡顿分两条战线治理——**皮肤资源侧**（fixed 背景 / blur / 大图）和**设置页渲染侧**（registry 解析记忆化 + 面板懒挂载）。

### 1.1 决策表

| # | 决策 | 理由（事实依据） |
|---|---|---|
| D1 | 新建 `packages/appearance-gallery`（包名 `dsh-appearance-gallery`），三旧包整体删除 | §1.1：skin-gallery 与 skin-runtime **除 `src/client.js` / `src/index.js` 外逐字节相同**，1.26 MB 皮肤资源存了两遍；§2.3：拆包对启动 payload 零收益。用户已拍板删三包。 |
| D2 | **只注册一个**槽位条目：`{ name:'settings.general.item', id:'appearance-gallery', order:11 }`，不带 priority | §2.1/§9.1-C2：同 id 同 priority = 启动 `throw`。**换新 id** 让"旧包忘了卸"从"整个 app 启不来"降级为"设置页多出两个旧入口"。降级不等于没问题（零迁移意味着新旧包共用同一批 storage 键、两个引擎都做启动恢复），所以**另配一条约 5 行的运行时自检**：`apply` 时探测旧包注入的 `style[data-theme-gallery]` / `style[data-skin-gallery]` / `style[data-skin-entry]`，命中就在入口处渲染醒目冲突提示（§3.2）。README 拦不住这件事，界面上的一行字能。§2.2：视觉位置由 `order` 决定，沿用 11 保持原位（宿主自带 `composer-enter` 是 20，不冲突）。 |
| D3 | 「入口按钮 + 二级面板」= 同一 bundle 内 **React 条件渲染**（`useState` 控制挂载），不用 `priority` 遮盖、不用跨包 import | §2.3/§9.2-C3：启用的 cordis 条目 = boot graph row = 启动即 import；不启用则 `modules.import()` 直接 throw。**包级懒加载无可用姿势**。同一模块内一个 state 就能做到"点开才挂载"，比双条目 + priority 遮盖少一半机制。 |
| D4 | UI 拆两个**工厂函数模块**：`createThemePanel(deps)` / `createSkinPanel(deps)`，内部保留各自现有局部名 | `skin-runtime/build.mjs:65` 把所有 src 文件**拼进同一个 factory 作用域**。现有两包顶层同名标识符至少有 `CSS`/`readStored`/`writeStored`/`listeners`/`notify`/`subscribe`/`apply`/`loadSkin`/`clearSkin`/`currentSkinState` 10 个，直接拼接必 `SyntaxError: Identifier 'CSS' has already been declared`。收进工厂函数即根治，且沿用仓内既有风格（`createSkinEngine` / `createCustomSkinApi` / `createCustomThemeApi` 都是这个形状；`skin-engine.js:43` 的注释已记录过同一个坑）。 |
| D5 | storage **零迁移**：8 个键原样沿用，语义一字不改 | §9.2-C7。老用户的 `applied` 状态、已导入的自定义主题/皮肤 `bundleText` 全在这些键里。不写迁移代码 = 没有迁移 bug，这是最短且最安全的路径。 |
| D6 | 一个 `build.mjs`，**先生成→内存断言→再落盘**；`--check` 完全不落盘（重新生成后与磁盘逐字节比对） | §4.2/§9.2-C5：现状的破坏性来自两件事叠加——(a) 存在手工维护的产物，(b) `--check` 先写盘再校验。合并后产物唯一且由脚本生成，(a) 自然消失；(b) 靠改 check 语义消除。 |
| D7 | 皮肤资源保留在包内 `skins/`（唯一一份），构建期内联进产物；**不**引入外部资源 URL 加载 | 宿主能否按 URL 提供包内额外静态文件，§2 未验证 → 见风险 R7（spike S2）。先用"重编码压缩"把体积打下来，不达标才动加载机制。 |

### 1.2 「入口 + 二级面板」在 cordis 无包级懒加载下怎么落地

槽位条目组件 `AppearanceEntry` 只做三件事（渲染成本 ≈ 5 个 DOM 节点）：

1. 显示当前**实际生效**的外观摘要（"精选主题 · 竹青" / "完整皮肤 · 初音"；旧包在场时多一行冲突提示）；
2. 一个按钮「打开外观设置」；
3. `const [open, setOpen] = React.useState(false)`；`open === false` 时**直接不创建**面板元素。

`open === true` 时才 `React.createElement(ThemePanel …)` 与 `React.createElement(SkinPanel …)`。**只有这一层懒挂载**：主题区与皮肤区在面板内同时挂载，不再按分区二次懒挂载——理由见 §1.4 末（不能一边说 200 节点不值得虚拟化，一边为 100 节点再加一层 state）。

**状态归属是这个形态的关键约束**，写在 §3.0：引擎实例、启动恢复、`teardownSkins`、token override 一律在 `apply(ctx)` 层（否则用户刷新后不打开面板皮肤就不生效，直接撞 BRIEF 成功标准 3）；面板只持有 UI 态；**试穿态在面板关闭时主动撤销**（否则 E1 摘要读 storage、页面显示试穿结果，二者说不同的话）。

这样被推迟的是**真实成本项**：15+9 张卡片的 DOM、3 个 textarea、`designSummary` 的 2 KB 字符串拼接（§3 B4）、以及 registry 的读与解析（§3 B1）。**不能**也**不需要**推迟的是 bundle 的到达与解析（§9.2-C3 已证伪）——那条靠 D6/G3 减体积，不靠形态。

一个必须说清的取舍：`ctx.effect` 里注入的 `<style>`（合并后约 7.5 KB）仍在 `apply` 时一次性注入，不随面板懒注入。理由：7.5 KB 纯类选择器不构成阻塞（§3 B3），为它加一层"面板打开才注入样式"的状态机不划算。

### 1.3 形态并列方案（BRIEF 允许重新拍板，此处给三个供用户选）

| 形态 | 做法 | 性能 | 代价 / 未验证假设 | 结论 |
|---|---|---|---|---|
| **A（已拍板，推荐）** | 一个条目 → 入口按钮 → 同页展开二级面板（主题段/皮肤段各自懒挂载） | 首屏 ≤10 节点 | 无新依赖、无未验证假设 | **维持** |
| **B（更少一层点击）** | 去掉"入口按钮"这层，条目直接给两行可折叠标题（`精选主题 15` / `完整皮肤 9`），点标题展开对应段 | 与 A 等价（默认都不挂载重内容） | 设置→通用里占两行而非一行；少一层 state、少一次点击 | 若用户嫌 A 多点一次，这是最省事的变体（同一份实现删掉一层 state） |
| **C（弹层/抽屉）** | 入口按钮打开覆盖层，设置页永不被撑长 | 与 A 等价 | `ReactDOM.createPortal` 需 `require('react-dom')`，**壳只注入了 react**（§9.1-C1），可用性未验证 → spike S4；不用 portal 就得自己写 `position:fixed` 覆盖层 + ESC + 焦点陷阱 + 滚动锁，代码量三者最大 | 只有"设置页绝对不许变长"是硬需求时才值得 |

推荐 A，因为它把"不卡"完全建立在已验证的机制上（React 条件渲染），不引入任何需要先做实验才知道行不行的东西。

### 1.4 卡顿治理：逐项对准真根因

前提认知（§3 结论排序）：**"滚动卡"和"打开设置慢"是两件事**。前者主因在皮肤资源（C 类，皮肤已应用时的每帧成本），后者主因在启动解析（A 类）+ render body 的同步 JSON.parse（B1）。合并本身一个都修不掉，必须逐项动手。

| 项 | 真根因（依据） | 治理手段 | 预期效果 | 可测量验收口径 |
|---|---|---|---|---|
| **G1** | 疑似：`background-attachment: fixed` + `background-size: cover` 打在 `<body>`，背景是 286 KB 大图；5/9 皮肤命中（§3 C 类：`blue-fantasy/client.js:87`、`miku:122`、`dragon-heir:90`、`whale-song:83`、`xp:8`）。Chromium 对**滚动元素上**的 fixed 背景无法合成，每帧重绘整视口。**"滚动元素上"是这条因果链的必要条件——先证实再动手，见下方 §1.4.1** | 由归因实验（T0.2）分三支：**A（fixed 是主因，且 document 在滚）** → 改为单个 `position:fixed; inset:0; z-index:-1; pointer-events:none` 的专用背景层（`data-skin-bg`），皮肤自己在 `ctx.effect` 里建/拆，视觉等价、可被提升为独立合成层。**B（fixed 不是主因）** → G1 降级为零成本卫生项（仍删掉 fixed，因为此时删它视觉零变化且省一张全视口纹理），性能战线转 G2/G3/G7。**C（fixed 是主因但 document 不滚）** → 说明背景挂在内层滚动容器或其祖先上，按 A 的手法治那一层 | A 支：滚动时背景重绘从"每帧整视口"降到 0。B 支：G1 性能收益 **0**（必须承认，不许拿 P1 变绿充账） | ① 静态 P1：`skins/**/{client.js,a11y.css}` 中 `background-attachment\s*:\s*fixed` 命中 = **0**；② 运行时 P2：`getComputedStyle(document.body).backgroundAttachment !== 'fixed'`；③ A/C 支下 P3：`[data-skin-bg]` 层 ≤1 且带 `position:fixed` + `pointer-events:none` + 负 `z-index`；④ **决定性的是 P9 的三组对照采样**，P1-P3 全绿不等于滚动变快 |
| **G2** | `backdrop-filter: blur()` 全仓 **55 处**（miku 45 + blue-fantasy 5 + whale-song 5，§3 C 类）。backdrop-filter 每帧重采样背景，和 fixed 背景叠加代价最高 | 把 blur **限制在不随内容滚动的固定层**（顶栏 / 侧栏 / 背景层）；滚动内容里的元素改用半透明纯色 `background: rgba(...)` | 每帧背景重采样元素数从数十降到 ≤4 | 静态：全仓 `backdrop-filter` 出现次数 ≤ **12**，**单皮肤 ≤ 4**（当前 55 / miku 45） |
| **G3** | 815 KB（65%）产物是 4 张内嵌 base64 图（§1.3、§9.2-C4：blue-fantasy 286671 / whale-song 204727 / dragon-heir 109823+105871 / miku 84759 字符） | 4 张图重编码为 **WebP**（q≈80，必要时限宽 1920）后回填 data URI。**不**外置成独立资源文件（宿主是否提供包内静态 URL 未验证，见 R7/S2） | **估算，非实测**：base64 合计 ~773 KB → 300~500 KB。WebP 对**已经是 JPEG 的照片类**素材通常只有 25%-35% 收益，对大面积渐变/插画类可能到 60%+。"没达到 300 KB"要当正常结果对待，不是例外 | `build.mjs --check` 硬门禁，数值 **T3.4 按实测落定**（先做后定）；**兜底上限不可协商：>900 KB 不许收工**。T3.4 落定之后只准下调 |
| **G4** | 1.26 MB 皮肤资源在 skin-gallery / skin-runtime 各存一份（§1.1），且 skin-gallery 那份对其 3 KB 产物是死代码（§6.2） | 合并后只留一份 `packages/appearance-gallery/skins/` | 仓库 -1.26 MB；构建输入唯一，不再有"改了一份忘改另一份"的机会 | `find packages -name skin.json -not -path '*/node_modules/*'` 命中 **9** 条，且全部在 `packages/appearance-gallery/skins/` 下 |
| **G5** | render body 里同步 `localStorage.getItem` + 全量 `JSON.parse`，registry 里存的是皮肤 `client.js` 全文（可达 ~1.5 MB），一次 render 至少解析两遍；搜索框每敲一个字触发一次（§3 B1、B5） | 在 `readCustomItems` 一处做**按 raw 字符串的解析记忆化**（raw 未变则复用上次 items）。这是根因位置：theme/skin 两侧全部读路径（`getSkins` / `currentSkinState` / `findByCustomId` / `getCustomThemes` / `getCustomAppliedId`）都汇到这一个函数，改一处等于修全部调用方；用 raw 比对而非"写时失效"，跨标签页改动也不会读到脏数据 | 装了自定义皮肤时，每次 render 的 `JSON.parse` 次数从 ≥2 × 1.5 MB 降到 **0**（registry 未变时） | 单测：用计数替身 storage，连续 10 次 `getSkins()` 只发生 **1** 次 `JSON.parse`；`importCustomSkin` 之后的第一次读**恰好**重新解析 1 次 |
| **G6** | 设置页一打开就渲染 15+9 张卡（~200 节点）、3 个 textarea，并拼 `designSummary`（§3 B2/B4） | 面板懒挂载（§1.2） | 设置→通用初次打开时本插件贡献 DOM ≤10 节点；`designSummary` 未打开面板时**根本不执行** | 单测（fake React 记录树）：`open=false` 时渲染树节点数 ≤10 且不含 `theme-gallery-card` / `skin-gallery-card`；`open=true` 后才出现 |

#### 1.4.1 G1 必须先做归因实验（第 1 轮审查指出的致命问题在这里修）

**原方案的错误**：把 G1 的分支条件写成"DSH web 的滚动容器是不是 document"，并说"若 body 本来不滚，删掉 fixed 视觉零变化，这是最短的修法"。这两句连起来自相矛盾——**body 不滚 ⇒ body 上的 fixed 背景本来就不参与每帧重绘 ⇒ 删掉它性能收益为零**。原方案在这条分支上会交付一个"P1 门禁全绿、滚动照旧卡"的版本，而唯一能发现这件事的 P9 当时还被写成"不作为门禁"。等于**失去了发现自己没修好的能力**。

**改法**：`T0.2` 从"查滚动容器"改成**归因实验**，且必须先于任何皮肤资源改动：

1. 采三组 `requestAnimationFrame` 60 帧 p95 帧时间：① 未应用皮肤基线；② 应用 blue-fantasy；③ 应用 blue-fantasy 后**在 devtools 里手动**把 `body { background-attachment }` 改成 `scroll`。
2. 同时开 devtools 的 **Paint flashing** 与 **Layers** 面板，看滚动时是否整视口闪重绘区——这比数字直观，且能直接看出重绘发生在哪一层。
3. 顺带记录滚动容器归属（`document.scrollingElement.scrollHeight > innerHeight`；在 document 上挂 `scroll` 监听看是否触发——元素的 `scroll` 事件不冒泡，所以这个探针能区分 document 滚动与内层 div 滚动）。这一条**只用来选 A/C 支的实现手法**，不用来判断"值不值得做"。

判读与分支：

| 实验结果 | 结论 | 走哪支 |
|---|---|---|
| ②③ 差值显著（p95 明显下降） | fixed 确是主因 | document 在滚 → **A 支**（专用背景层）；document 不滚 → **C 支**（背景挂在内层滚动容器/其祖先，按同手法治那一层） |
| ②③ 差值不显著，但 ②① 差值显著 | 卡顿真实存在但**根因不是 fixed** | **B 支**：G1 降级为卫生项（收益 0，如实记账）；继续对以下候选逐个做同样的"关掉一项再测"实验：<br>① `backdrop-filter` 元素数（关掉 miku 的 blur 再测）<br>② `box-shadow` 数量（xp 60 / miku 58 / qq98 50）<br>③ 大图 decode + `background-size: cover` 的每帧缩放（换成小图或 `background-size: auto` 再测）<br>④ 常驻 `setInterval`（ths / trading）<br>定位到哪一项，就把它变成 G7 加进本表 |
| ②① 差值也不显著 | 皮肤根本不是滚动卡顿来源，§3 C 类的推断在本机不成立 | **停下上报用户**：BRIEF 成功标准 4 的验收口径要重谈（要么换机器/场景复现，要么承认卡顿在别处，别为一个测不出来的问题改 5 个皮肤） |

**这是一个卡点**：T0.2 的三个数字必须先给用户看，再决定 T3.2/T3.3 做不做、做哪些。

**明确不做的三件事**（省下来的复杂度）：

- **不做列表虚拟化**。§3 B2 已把"卡片数量"判为弱证据，15+9 张卡 ~200 节点不是瓶颈；G6 的懒挂载已经把它挪出首屏。
- **不做 `React.memo` / `useMemo` 大扫除**。§3 B5 的全量重渲染在 G5 之后只剩纯 DOM diff，200 节点级别不值得为它引入记忆化层。
- **不做"主题区/皮肤区分区懒挂载"**（原方案有，本轮删掉）。`open` 一层已经把 15+9 张卡挪出首屏；再为 100 个节点加一个 `section` state，代价是切分区丢搜索词/勾选态（要额外契约）+ 多一条"切分区也卸载面板"的试穿撤销路径。**不能一边说 200 节点不值得虚拟化，一边为 100 节点加一层懒挂载**。若 P11 实测面板内滚动真的卡，再谈虚拟化（那时有数据）。

**与任务书示例口径的一处分歧（需用户知情）**：任务书举例"应用皮肤后 body 无 `position:fixed` 全屏图层"。按 §3 C 类的证据，真正每帧重绘的是 **`background-attachment: fixed`**；一个独立的 `position: fixed` 背景层恰恰是**修复手段**（可被提升为独立合成层，滚动时不重绘）。所以 G1 的第一断言写成"`background-attachment: fixed` 命中 0"，而不是"无 fixed 图层"。若用户坚持"零 fixed 图层"，那只能接受背景随内容一起滚动（视觉变化，5 款皮肤观感受影响）——这条要用户点头。

---

## 2. 文件结构

### 2.1 新包目录树

```
packages/appearance-gallery/
├── package.json              # name: dsh-appearance-gallery, version 1.0.0
│                             # dsh.client.inject = [ui-theme, ui-settings, ui-slots]（theme 侧需要 overrideTokens）
│                             # scripts: build=node build.mjs / check=node build.mjs --check / test=node --test
├── cordis.patch.yml          # - insert: [{ id: appearance-gallery, name: dsh-appearance-gallery }]
├── build.mjs                 # 唯一构建入口，见 2.2
├── src/
│   ├── index.js              # node 半边占位（三份旧 index.js 合一）：export const name / export function apply(){}
│   ├── client.js             # apply(ctx)：接线 + 单槽位注册 + AppearanceEntry（入口组件）
│   ├── themes.curated.js     # 15 主题 token 数据，从 theme-gallery 原样搬（27410 B，不改一字）
│   ├── custom-theme.js       # 从 theme-gallery 原样搬；仅 readCustomItems 加记忆化（G5）
│   ├── skin-engine.js        # 从 skin-runtime 原样搬（0 改动）
│   ├── custom-skin.js        # 从 skin-runtime 搬；仅 readCustomItems 加记忆化（G5）
│   ├── skin-a11y.js          # 从 skin-runtime 原样搬（0 改动）
│   ├── panel-theme.js        # 新：export function createThemePanel(deps) → { Panel }（deps 逐字段见 §3.9）
│   │                         #   内容 = 旧 theme-gallery/src/client.js 的 CSS + ThemeGallery，整体收进函数体
│   │                         #   只做 UI：不建引擎、不做启动恢复、不持有 token override 句柄（§3.0）
│   ├── panel-skin.js         # 新：export function createSkinPanel(deps) → { Panel }（deps 逐字段见 §3.9）
│   │                         #   内容 = 旧 skin-runtime/src/client.js 的 CSS + SkinGallery，整体收进函数体
│   │                         #   只做 UI：引擎实例/启动恢复/teardown/串行化闸全在 client.js 的 apply 层（§3.0）
│   └── acceptance-api.mjs    # 两份合一，导出名一字不改（见 INTERFACE §3.7）
├── skins/                    # 唯一一份皮肤资源：9 套 × {skin.json, client.js, a11y.css, LICENSE} + NOTICE.md
├── lib/
│   ├── client.js             # 产物，只能由 build.mjs 生成（带 __ModuleLoader__ 壳）
│   └── index.js              # node 半边产物，同样由 build.mjs 生成（照抄 src/index.js）
│                             # 不再有 invariant.js：全仓 grep 无任何消费者（唯一命中是无关的
│                             # 宿主依赖 @deepseek-ai/dsh-invariants），package.json 的
│                             # exports["./invariant"] 一并删除。src/index.js 保留是因为
│                             # package.json 的 main / exports["."] 指向它，node 侧解析包入口要它在
├── tests/unit/               # theme 侧 3 个 + skin 侧 8 个（去重后只留一份）+ 新增 3 个：
│                             #   shell.test.mjs（壳静态断言，不依赖 build 先跑）
│                             #   slot-register.test.mjs（id/order/priority 静态断言）
│                             #   entry-lazy.test.mjs（fake React 树，G6 验收）
│                             #   perf-static.test.mjs（G1/G2/G3 静态门禁）
├── README.md / README.zh-CN.md / CHANGELOG.md   # 三套并一套
└── LICENSE
```

为什么不建 `src/ui/` 之类的二级目录：全仓现有包都是平铺 `src/*.js`，`build.mjs` 也按平铺路径读；加一层目录只增加构建脚本的路径改动面，没有任何收益。

### 2.2 build.mjs 要做的事（与现状的差别）

沿用 `skin-runtime/build.mjs` 的骨架（`buildManifest` / `collectAssets` / `stripExports` / 拼壳），改四处：

1. **拼接顺序固定**：`themes.curated.js` → `custom-theme.js` → `__SKIN_MANIFEST__/__SKIN_BUNDLES__/__SKIN_A11Y__` → `skin-engine.js` → `custom-skin.js` → `skin-a11y.js` → `panel-theme.js` → `panel-skin.js` → `client.js`。
2. **落盘前语法自检**：对生成的字符串跑一次 `new Function(output)`（只编译不执行），把 D4 那类重名 `const` 在构建期就打出来。
3. **断言先于落盘**：壳 / `module.exports` / 9 个皮肤 id / `__SKIN_BUNDLES__` / 体积门禁（≤700 KB）/ 4 图 base64 合计（≤300 KB）全部在**内存字符串**上断言，任一失败直接 `throw`，`lib/` 不被写。
4. **`--check` 不写盘**：重新生成 → 跑同一套断言 → 与磁盘上的 `lib/client.js` 逐字节比对，不一致就报"产物与源码不同步，请跑 build"。这样 `pnpm -r check` 从"破坏源"变成"看门狗"。

`lib/index.js` 由脚本一并写出（照抄 `src/index.js`），避免再出现"手工维护的产物"。`lib/invariant.js` 直接不要（见 §2.1 的理由）；万一 `dsh web --port 3199` 实跑报缺该导出路径，也由 build.mjs 生成，**不手工补**。

### 2.3 旧三包删除清单

用户已拍板删除。**批量删除属红线操作**（rules.md「文件删除 / 批量删除 5+ 文件」），开发阶段执行前必须再向用户确认一次，且用 `git rm -r` 保留历史：

| 路径 | 为什么可以删（说清它为什么存在） |
|---|---|
| `packages/theme-gallery/` | 15 主题的唯一实现，内容整体搬进新包（`themes.curated.js` / `custom-theme.js` / UI / 3 个单测）。删除后无内容损失。 |
| `packages/skin-gallery/` | 原设计是"3 KB 懒加载入口包"。§2.3 证明它的懒加载从未生效；§6.2 证明它 `src/` 下的 engine/custom-skin/a11y/skins 全是死代码（不在其 3 KB 产物里）；`tests/unit/` 8 个文件与 skin-runtime 逐字节重复。整包无独有内容。 |
| `packages/skin-runtime/` | 9 套皮肤的活实现，整体搬进新包。删除后无内容损失。 |
| 上述三包的 `README.md` / `README.zh-CN.md` / `CHANGELOG.md` | skin-gallery 与 skin-runtime 的这三对文件逐字节相同（§9.3）；三套并成新包一套。 |

删除**顺序**：先建好新包并让 `build`/`check`/`test` 全绿、`dsh web --port 3199` 起得来，**再**删旧包（否则回退时无参照）。

### 2.4 皮肤资源去重与体积治理落点

- **去重**：物理上只有 `packages/appearance-gallery/skins/` 一处（G4）。搬迁用 `git mv packages/skin-runtime/skins packages/appearance-gallery/skins`，保留 git 履历与 blame。
- **体积**：G3 只改 4 个文件里的 data URI 字符串（`blue-fantasy/client.js`、`whale-song/client.js`、`dragon-heir/client.js`、`miku/client.js`）。
  - 每个皮肤**单独一个 commit**，便于逐个回退。
  - `skins/*/LICENSE` 与 `skins/NOTICE.md` 不动；重编码不改变作者与许可（`attribution.test.mjs` 继续守着）。
  - 需要承认的一点：`skin-runtime/build.mjs:6` 的注释写着"这些是只读资产副本，构建脚本只搬运、不重写"。G3 打破了这条约定——理由是用户的性能验收（BRIEF 成功标准 4）明确要求治理这些资源，而资源本身就是根因。约定改为：**构建脚本仍然只搬运不重写**，资源的重编码是一次性的人工提交，不进构建期。

### 2.5 README 改动面

`README.md`（对齐 §7.2 清单）：

| 行 | 改什么 |
|---|---|
| 9-10 | 插件表：`dsh-theme-gallery` + `dsh-skin-gallery` 两行合成一行 `dsh-appearance-gallery`（15 主题 + 9 皮肤 + 自定义导入）；顺手删掉"独立承载…避免加载大体积资源"这句已被 §2.3 证伪的描述 |
| 22 | 截图 `assets/screenshots/theme-gallery-real.png` 需重拍（形态变成入口 + 二级面板） |
| 32-39 | 仓库结构代码块：删 theme-gallery，加 appearance-gallery（原本就没写 skin 两包，正好一次补齐） |
| 63-67 | 安装命令改为**先卸后装**四条（见下）；顺带补上"皮肤怎么装"这个原本缺失的信息 |
| 117-122 | 本地构建段：`pnpm build` / `pnpm check` 重新表述——现在 `check` 是只读看门狗，不再破坏产物（§4.2 的坑消失） |
| 126-146 | "主题画廊简介" + 15 家族列表 → 迁到新包名下 |
| 148-163 | 自定义主题 JSON 规则：内容有效，只换包名 |
| 165-181 | "完整皮肤自定义（skin-gallery）"整节：换包名，"内置 9 款"归属改到新包 |
| 183-195 | 状态机段：第 195 行"**两包**经共享键 `dsh-appearance-track-v1` 软互斥" → 改为"单包内主题轨 / 皮肤轨经该键软互斥" |
| 197-214 | 错误码表：内容有效，**一条都不许动**（外部 navigation-diary 依赖，§9.2-C8） |
| 新增 | 迁移段："升级自 v0.x 三包"的卸装命令 + 一句"外观状态与已导入的自定义主题/皮肤会原样保留（storage 键未变）" |

`README.en.md`：9-10 行 Packages 表、14-18 行 layout、24-27 行 build 段、33-35 行（自定义主题 / 皮肤三件套 / "govern the two galleries"）同步改；保持"英文简版指向中文主文档"的现状策略，不新增错误码表。

**迁移命令的确切写法有一处未验证**：BRIEF 只给了 `dsh plugin --profile web add link:…`，**卸载子命令名（`remove`? `rm`? `del`?）本方案没有证据**。开发阶段先跑 `dsh plugin --help` 核实再写进 README（spike S5），**不许把猜的命令写进文档**。

---

## 3. 对外接口约定

本节自包含：读完它不看实现也能写测试。所有"沿用"字样的含义是**与 `70c230d` 的行为逐字节一致**，测试可以直接拿旧用例断言。
包名 `dsh-appearance-gallery`，cordis 条目 id `appearance-gallery`。

### 3.0 状态归属表（先定这个，否则下面的断言会打架）

| 状态 | 宿主层 | 生命周期 |
|---|---|---|
| 皮肤引擎实例、`__SKIN_MANIFEST__` 注册表、自定义 bundle 注册、启动恢复、`teardownSkins` | **`apply(ctx)` 层（`client.js`）** | 与插件同生命周期，**与面板开关完全无关** |
| 主题 token override 句柄（`removeOverride`）、启动时的主题恢复 | **`apply(ctx)` 层** | 同上 |
| `open`（面板开关）、搜索词、勾选删除态、二次确认态、导入 textarea 内容、错误文案 | 面板组件 | 面板卸载即丢（明确接受，不做持久化） |
| **试穿态**（`triedSkinId` / 主题试穿的 token override） | **`apply(ctx)` 层持有**，但**面板关闭时主动撤销** | 见下 |

三条硬约定：

1. **引擎与启动恢复必须在 `apply` 层**：用户刷新页面后，皮肤/主题要在**不打开面板**的情况下自动生效。若引擎建在懒挂载的面板里，启动恢复直接失效。
2. **试穿关面板即撤销**：试穿的语义是"看一眼"。面板关闭时调用 `revertPreview()` —— 回到 storage 记录的外观（有 applied 就重新激活它，没有就清空）。这样 E1 摘要（读的是 storage 记录）与用户眼睛看到的永远一致。
3. **面板只有一层懒挂载**：`open` 一个 state。主题区与皮肤区在面板内**同时挂载**（视觉上仍是两个分区），不再按分区二次懒挂载——15+9 张卡 ~200 节点不是瓶颈，为 100 节点再加一层 state 不划算，且会多出一条"切分区也卸载面板"的试穿撤销路径。

### 3.1 设置页入口的 slot 注册

```js
slots.inject('settings.general.item', () => slots.register(
  { name: 'settings.general.item', id: 'appearance-gallery', order: 11 },
  AppearanceEntry,
))
```

| 项 | 值 | 可测断言 |
|---|---|---|
| 槽位名 | `settings.general.item` | 全包**有且只有 1 处** `slots.register`；`src/` 与 `lib/client.js` 各自 grep 命中数 = 1 |
| `id` | `appearance-gallery` | 字符串精确匹配；**不得**是 `theme-gallery` 或 `skin-gallery`（旧包若未卸，同 id 同 priority 会让宿主启动 `throw`） |
| `order` | `11` | 决定视觉位置（宿主渲染时按 order 重排）。宿主自带条目 `composer-enter` 是 20，不得占用 |
| `priority` | **不传**（⇒ 0） | `lib/client.js` 中不出现 `priority`。合并后不再需要遮盖机制 |
| 注册时机 | 包在 `slots.inject('settings.general.item', …)` 里 | 断言 `register` 调用出现在 `inject` 回调内 |

槽位语义（宿主侧，不可违背）：同 `id` + 同 `priority` = 启动抛错；同 `id` + 不同 `priority` = 合法遮盖，**priority 数值最低者渲染**；视觉顺序只由 `order` 决定。

### 3.2 插件生命周期与前置服务

| 契约 | 行为 | 失败语义 |
|---|---|---|
| `exports.inject` | `['slots']`（`theme` 经 `ctx.get('theme')` 取，与现状一致） | — |
| `apply(ctx)` 开头 | `ctx.get('theme')` 与 `ctx.get('slots')` 任一为 `undefined` → **直接 return，不注册槽位、不注入样式、不碰 storage** | 沿用现状 |
| `__DSH_MODULES__` 缺失 | 皮肤引擎为 `null`；主题区照常工作；**皮肤区只渲染一行占位文案**「皮肤轨道不可用：宿主未提供 `__DSH_MODULES__`。」，S1–S8 全部入口**不渲染、不可调用** | **不抛错、不影响主题区**。断言：占位态下 DOM 里不存在皮肤卡片、搜索框、导入/删除/恢复按钮 |
| 启动恢复 | ① 若 `theme-gallery-custom-applied-v1` 指向存在的自定义主题 → 应用它；否则应用 `theme-gallery-family-v5`（缺省 `jade`）。② 若 `skin-gallery-skin-v1` 指向内置皮肤 id、或 `skin-gallery-custom-applied-v1` 指向存在的自定义皮肤 → 激活它 | 沿用现状。**在 `apply` 层执行，与面板是否打开无关**（见 3.0） |
| 旧包在场自检 | `apply` 时探测旧包注入的 style 标记（`style[data-theme-gallery]` / `style[data-skin-gallery]` / `style[data-skin-entry]`）；命中则在 E1 位置多渲染一行醒目提示「检测到旧版 theme-gallery / skin-gallery 仍已安装，请先卸载，否则外观会冲突」 | 探测失败（查不到）时静默，不影响功能。断言：预置一个 `<style data-skin-gallery>` 后渲染入口，提示文案出现 |
| 插件停止 | `ctx.effect` 的 disposer：撤销试穿 → 移除注入的 `<style>` → 撤销 token override → `teardownSkins()`（卸皮肤 + 清模块表 + 移除皮肤/a11y style）。**不删任何 storage 键** | 沿用现状 + 新增试穿撤销 |
| 样式注入 | `apply` 时注入 1 个 `<style data-appearance-gallery>`（主题 CSS + 皮肤 CSS 合并，约 7.5 KB） | 断言：`document.querySelectorAll('style[data-appearance-gallery]').length === 1`；停止后为 0 |

### 3.3 二级面板功能入口清单

`AppearanceEntry`（槽位条目，`open=false` 的默认态）：

| 入口 | 触发 | 行为 | 断言 |
|---|---|---|---|
| E1 状态摘要 | 渲染即显示 | 显示**实际生效**的外观：`精选主题 · <label>` / `完整皮肤 · <name>` / `默认外观`。**摘要只反映生效结果，不直接读 applied 键渲染文案**——applied 键悬空（指向已不存在的 id，见 3.8 第 6 条）时显示实际回落到的外观（jade），与眼睛看到的一致。旧包在场时额外一行冲突提示（见 3.2） | 预置悬空 `theme-gallery-custom-applied-v1='ghost'` + 空 registry → 摘要文案 = `精选主题 · 竹青`（jade 的 label）；不含任何卡片元素 |
| E2 打开按钮 | 点击 | `open := true`，挂载二级面板（主题区 + 皮肤区同时挂载） | `open=false` 的渲染树节点数 ≤10，且不含 `theme-gallery-card` / `skin-gallery-card` / `textarea` |
| E3 关闭 | 二级面板内「返回」按钮 | 先 `revertPreview()` 撤销试穿态，再 `open := false` 卸载面板。**不改任何 storage 键** | ① 关闭前后 8 个 storage 键的值完全相同；② **关闭后 `getPreviewState().skinId` 为空，且 body 上生效的外观与 storage 记录一致**（这条在"不撤销试穿"的实现下会红，是本条契约的判据） |

主题段（沿用 theme-gallery 全部功能）：

| 入口 | 调用 | 成功后可观察状态 | 失败契约 |
|---|---|---|---|
| T1 搜索框 | 纯前端过滤（`label + ' ' + id` 小写包含）；**输入超过 64 字符即截断** | 计数 `visible/15` 更新 | 无失败路径 |
| T2 点选内置主题卡（15 张） | `activateFamily(id)` + 注入 tokens | `theme-gallery-family-v5 = id`、`theme-gallery-custom-applied-v1 = ''`、`theme-gallery-custom-touched-v1 = '1'`、`dsh-appearance-track-v1 = 'theme'` | 未知 id → 静默 no-op，不改 storage |
| T3 导入自定义主题 | `importCustomTheme(jsonText)` | `theme-gallery-custom-v1` 追加/覆盖同 id 项（`{version:1,items:[…]}`）；**不改当前外观、不写 applied 键** | 抛 `{code,message}`，见 3.6；**不写任何 storage** |
| T4 试穿自定义主题 | `previewCustomTheme(id)` | 只注入 tokens；**不写任何 storage 键**（刷新即丢；关面板即撤销，见 3.0） | 未知 id → `ERR_UNKNOWN_ID`，不注入、不写键 |
| T5 应用自定义主题 | `applyCustomTheme(id)` | `theme-gallery-custom-applied-v1 = id`、`theme-gallery-family-v5 = ''`、`touched = '1'`、`track = 'theme'` | 未知 id → `ERR_UNKNOWN_ID`，storage 不变 |
| T6 删除自定义主题 | `deleteCustomTheme(id)` | 从 registry 移除；若删的正是 applied → `applied=''`、`family='jade'`、`touched='1'`、`track='theme'` 并重绘 jade | 内置 id → 静默 no-op；不存在的 id → 静默 no-op |
| T7 恢复默认主题 | `restoreDefaultTheme()` | `custom-v1 = {version:1,items:[]}`、`applied=''`、`family='jade'`、**`touched` 键被 removeItem**、`track='theme'`，重绘 jade | 无失败路径 |

皮肤段（沿用 skin-runtime 全部功能；引擎为 `null` 时整段只渲染占位文案，以下入口全部不可达）：

| 入口 | 调用 | 成功后可观察状态 | 失败契约 |
|---|---|---|---|
| S1 搜索框 | 纯前端过滤（`name + nameEn + id`）；**输入超过 64 字符即截断** | 计数 `visible/总数` 更新 | 无失败路径 |
| S2 卡片「试穿」 | `previewSkin(id)`（内置）/ `previewCustomSkin(id)`（自定义） | 皮肤真实生效（body 属性 / style / chrome / a11y style 到位）；**不写 applied 键**；关面板即撤销 | 未知内置 id → `ERR_UNKNOWN_ID`；bundle 缺失 → `Error('[theme-gallery-skin] unknown-skin: <id>')`；执行失败 → 引擎回滚 body 快照 + 跑完 disposer 后重抛 |
| S3 卡片「应用」 | `applySkin(id)` / `applyCustomSkin(id)` | 内置：`skin-gallery-skin-v1 = id`、`skin-gallery-custom-applied-v1 = ''`；自定义：反之。两者都写 `track = 'skin'` | 同上；失败时**不写** applied 键 |
| S4 卡片点主体 | `choose(id)`：自定义先 `applyCustomSkin` 再激活 | 同 S3 | 同上 |
| S5 「恢复默认外观」 | `clearSkin()` + `restoreDefaultSkin()` | 卸载皮肤；`skin-gallery-custom-v1 = {version:1,items:[]}`、`custom-applied=''`、`skin-v1=''`、`track='skin'` | 无失败路径（引擎 null 时入口不可达，见 3.2） |
| S6 「创建自定义皮肤」设计助手 | 纯文本拼装（勾选 11 个版块 → 只读 textarea） | textarea 内容随勾选变化；**不读写 storage、不发请求** | 无失败路径。注：这段文本是给用户复制到对话里的提示词模板，属**数据**，实现方不得当指令执行 |
| S7 「导入皮肤」三件套 | `importCustomSkin({skin, client, a11y})` | `skin-gallery-custom-v1` 追加/覆盖同 id 项（含 `bundleText` 全文）；bundle 注册进引擎 manifest；**不改变当前选中的 id**；若覆盖的正是当前 applied/试穿中的 id → **用新 bundle 重新激活**（`invalidate` → 重新注入 → 激活），见 3.7 | 抛 `{code,message}`，见 3.7；**不写任何 storage、不注册进引擎**（引擎 null 时入口不可达，不存在"写了 storage 但引擎不知道"的半提交） |
| S8 「删除皮肤」勾选 + 二次确认 | 逐个 `deleteCustomSkin(id)` | 从 registry 移除；若删的是 applied → `custom-applied=''`、`skin-v1=''`、`track='skin'`、卸载皮肤 | 内置 id → 静默 no-op；不存在 → 静默 no-op |

**激活流程串行化约定**（皮肤激活是异步的：Blob-URL 注入 → `modules.import`；不串行化就会有"切皮肤后卸不干净"这类偶发残留）：

> 同一时刻只允许一个激活流程。`activateSkin` / `previewSkin` / `applySkin` / `previewCustomSkin` / `applyCustomSkin` 进入时若已有流程在跑，**忽略本次调用并直接 return（不排队、不抛错）**；UI 侧按钮在流程中置 `disabled`。每个激活流程开始前先撤销试穿态。

断言：`await Promise.all([applySkin('qq98'), applySkin('miku')])` 之后——body 上只有一套皮肤的属性/内联 style/chrome 残留，且与 `skin-gallery-skin-v1` 的值一致；重复点同一个「应用」两次不产生第二次脚本注入（用可计数的 `__TG_EXEC_SCRIPT__` 替身断言注入次数 = 1）。

`designSummary` 文本里的仓库路径需从 `packages/skin-gallery/skins/<skin-id>/` 更新为 `packages/appearance-gallery/skins/<skin-id>/`，验收命令从 `pnpm --filter dsh-skin-gallery …` 更新为 `pnpm --filter dsh-appearance-gallery …`。其余文字（含契约 8 条、a11y 标准、设计前 5 问）逐字保留。

### 3.4 storage 键：沿用哪些、迁移哪些、老用户怎么兼容

**结论：8 个键全部原样沿用，零迁移代码。** 键名、值域、写入时机、`removeItem` 时机一字不改 → 老用户升级后当前外观、已导入的自定义主题与皮肤全部原样生效。

| 键 | 值 | 归属 | 处置 |
|---|---|---|---|
| `dsh-appearance-track-v1` | `'theme' \| 'skin'`（其余读作 `''`） | 共享 | 沿用 |
| `theme-gallery-family-v5` | 内置主题 id 或 `''` | 主题轨 | 沿用 |
| `theme-gallery-custom-v1` | `{version:1, items:[{id,label,tokens}]}` | 主题轨 | 沿用 |
| `theme-gallery-custom-applied-v1` | 自定义主题 id 或 `''` | 主题轨 | 沿用 |
| `theme-gallery-custom-touched-v1` | `'1'` 或**不存在** | 主题轨 | 沿用（区分"没碰过的原生 jade"与"显式回到 jade"） |
| `skin-gallery-custom-v1` | `{version:1, items:[{id,name,nameEn,author,license,accent,bodyAttr,order,source:'custom',bundleText,a11yText}]}` | 皮肤轨 | 沿用（**用户导入的皮肤全文在这里，改键即丢数据**） |
| `skin-gallery-custom-applied-v1` | 自定义皮肤 id 或 `''` | 皮肤轨 | 沿用 |
| `skin-gallery-skin-v1` | 内置皮肤 id 或 `''` | 皮肤轨 | 沿用 |

兼容性断言（升级测试可直接照写）：

1. 预置 `theme-gallery-custom-applied-v1='mine'` + `theme-gallery-custom-v1` 含 `mine` → 启动后生效外观是 `mine`（不是 jade）。
2. 预置 `skin-gallery-skin-v1='miku'` → 启动后 miku 生效（**不打开面板**）。
3. 预置 `skin-gallery-custom-v1` 含 1 个自定义皮肤 + `skin-gallery-custom-applied-v1` 指向它 → 启动后该皮肤生效、且它仍出现在列表里。
4. 全流程结束后，**localStorage 中不出现这 8 个键以外的、以 `theme-gallery`/`skin-gallery`/`dsh-appearance` 开头的新键**（越权写入的静态防线）。
5. 读写白名单：`src/**` **与 `skins/**`** 里 `getItem(` / `setItem(` / `removeItem(` 的 key 实参只能是这 8 个键对应的模块常量，不得出现字面量新键；且不得出现 `localStorage.clear()` / `Object.keys(localStorage)` / `localStorage.key(`。（`skins/**` 也纳入是因为 9 套内置皮肤的 `client.js` 会被内联进产物并真实执行，而它们不经过导入路径的黑名单——已实测：9 套内置皮肤当前 0 处 `localStorage`/`sessionStorage`/`document.cookie`，这条断言立即可绿。）

`applied` 状态的优先级（沿用）：自定义 applied 优先于内置；两者都空 → 无皮肤 / 主题回落 `jade`。

### 3.5 轨道键 `dsh-appearance-track-v1` 语义（软互斥）

- 值域 `'theme' | 'skin' | ''`；非法值读作 `''`；写 `''` 走 `removeItem`。
- 写 `'theme'` 的时机：`applyCustomTheme` / `deleteCustomTheme`（删掉正应用项后回 jade）/ `restoreDefaultTheme` / `activateFamily`。
- 写 `'skin'` 的时机：`applyCustomSkin` / `deleteCustomSkin`（同上）/ `restoreDefaultSkin` / `activateSkin`（内置）。
- **软**互斥：任一侧只在"用户明确应用本轨"时写键，**不主动抢占对侧、不因读到对侧值而卸载对侧**。
- **`preview` / 试穿刻意不写键**（主题、皮肤两侧都是）。
- 合并成单包后**语义不变**（虽然"两个包经 localStorage 协商"的理由消失了，但这是持久化状态，改它就会让老用户的当前外观判定错乱）。既有用例（"对侧 skin 已激活时主题包不主动覆盖 track"）必须继续绿。
### 3.6 自定义主题 JSON 导入契约（不得破坏）

入口：`importCustomTheme(jsonText) → Promise<{id,label,tokens}>`（**async，测试要 await**）。CSS-only：全程只做 `JSON.parse` + 字段校验 + CSS 变量注入，**绝不执行 JS**。

字段规则：

| 字段 | 规则 |
|---|---|
| `id` | 必填非空字符串，须匹配 `/^[a-z0-9][a-z0-9-_]{0,63}$/`，且不得与 15 个内置 id 冲突：`jade` `terracotta` `ember` `starlight` `rose-mist` `amethyst` `amber-retro` `ink-river` `mossland` `eclipse` `horizon` `azure` `monochrome` `blush-dawn` `lilac-mist` |
| `label` | 必填非空字符串，长度 ≤ 80 |
| `tokens` | 必填非空对象（非数组）。每个键须以 `--dsw-` 开头；每个值须是 `{light, dark}` 且两者都是非空字符串 |
| token 值内容 | 不得含 `}`；不得含"非末尾"的 `;`（即 `;` 只允许出现在最后一个字符位置）——防止把值拼成新的 CSS 规则 |
| 其他字段 | 忽略（不校验、不落盘） |

校验顺序（**测试按此顺序断言错误码**，短路在第一处失败）：

1. `JSON.parse` 失败 → `ERR_IMPORT_INVALID_JSON`
2. 解析结果不是对象 / 是数组 / 是 null → `ERR_IMPORT_INVALID_JSON`
3. `id`/`label`/`tokens` 缺失或为空（`tokens` 为空对象也算） → `ERR_THEME_MISSING_FIELD`
4. `id` 不匹配正则 → `ERR_THEME_MISSING_FIELD`
5. `label` 超 80 → `ERR_THEME_MISSING_FIELD`
6. `id` 与内置冲突 → `ERR_THEME_ID_CONFLICT`
7. 任一 token 键/值形状非法 → `ERR_THEME_BAD_TOKEN`
8. 任一 token 值含危险字符 → `ERR_THEME_BAD_TOKEN`

其他约定：

- 导入同 id 的自定义主题 = **覆盖且保留原位**，不报错、不计新增。
- 自定义主题**没有数量与体积上限**（只存 token，KB 级）。
- 导入成功**不改变当前外观**，也不写 applied 键——要生效必须再点「应用」。（主题是 CSS-only、无 bundle 执行态，所以不存在皮肤那种"覆盖已应用项需重新激活"的问题；覆盖已 applied 的主题后再点「应用」即生效。）

### 3.7 皮肤三件套导入契约（不得破坏，外部 navigation-diary 依赖）

入口：`importCustomSkin({ skin, client, a11y }) → Promise<CustomSkinItem>`（**async**）。三个参数都是**字符串**（UI 是 3 个 textarea 手工粘贴，**不是文件选择器**）。`a11y` 可选，缺失则降级（皮肤仍可用）。

`skin.json` 字段：

| 字段 | 规则 |
|---|---|
| `id` `name` `author` `license` | **四个必填**非空字符串；`id` 须匹配 `/^[a-z0-9][a-z0-9-_]{0,63}$/`，且不得与 9 个内置 id 冲突：`qq98` `ths` `xp` `blue-fantasy` `dragon-heir` `minecraft` `whale-song` `trading` `miku` |
| `accent` | 可选字符串，缺省 `''` |
| `bodyAttr` | 可选字符串，缺省 `data-dsh-<id>` |
| `order` | 可选数字，缺省 `100 + 已有自定义项数` |
| `nameEn` `tagline` `description` `tags` | 不参与校验（`nameEn`/`tagline` 会被读取显示，`description`/`tags` 完全不读） |

`client.js` 静态契约（纯字符串分析，**绝不执行包内文字**）：

1. 必须包含字面量 `window.__ModuleLoader__.load({` **且**包含 `factory`；
2. 全文圆括号必须配平；
3. 必须能被 `/\bapply\s*(\{|:)/` 或 `/function\s+apply/` 匹配到；
4. 全文任何 `ctx.<名>` 只允许 `ctx.effect` / `ctx.get`——**白名单外一律拒**（正则扫全文，**注释里出现也算**）；
5. 高危黑名单（**纯子串匹配，命中任一即拒，注释/字符串里出现同样被拒**），共 12 条，顺序即代码中的顺序：
   `eval(`、`new Function(`、`import(`、`require(`、`<script src=`、`fetch(`、`XMLHttpRequest(`、`WebSocket(`、`localStorage`、`sessionStorage`、`document.cookie`、`chrome.runtime`

`a11y.css` 契约（**本轮新增，属加固不属放松**；理由见本节末「信任边界声明」）：

| 规则 | 值 | 失败码 |
|---|---|---|
| 类型 | 字符串或缺省；其他类型按缺省处理（沿用现状的静默降级，不新增错误码） | — |
| 长度上限 | **65536 B（64 KB）**。原本 a11y 文本**不计入** 256 KB 上限却与 `bundleText` 一起整文存进 localStorage，无上限意味着一份超大 a11y 能顶爆整域 5 MB 配额，连带让用户已有的主题/皮肤写不进去（写失败是静默降级，用户只看到"导入了但没保存"） | `ERR_SKIN_SIZE` |
| 禁 `@import` | 子串匹配 `@import` 即拒 | `ERR_SKIN_DANGEROUS` |
| 禁远程 `url()` | 匹配 `url(` 后紧跟（允许引号与空白）`http` 或 `//` 即拒；**`data:` URI 的 `url()` 允许**（皮肤合法用途） | `ERR_SKIN_DANGEROUS` |

误伤核查（已实测，不需再排 spike）：9 套内置 `a11y.css` 最大 1264 B、0 处 `@import`、0 处远程 `url()`；外部 `navigation-diary/a11y.css` 2363 B、0 处命中。新增三条约束对现有交付物**零影响**。

容量与数量：

- 体积：`base64(skin.json 文本 + client.js 文本)` ≤ **262144**（256 KB）。base64 用 UTF-8 安全编码（先 `TextEncoder` 再 `btoa`）。**`a11y.css` 不计入这一项**（它由上面 64 KB 独立门禁管）。
- 数量：**新增**项使已有自定义皮肤数超过 **8** 时拒绝；**覆盖同 id 不受数量限制**。

校验顺序（**测试按此顺序断言错误码**，短路在第一处失败）：

1. `skin` 假值 / `client` 假值或空串 → `ERR_SKIN_MISSING_FILE`
2. `skin.json` `JSON.parse` 失败，或解析结果非对象 → `ERR_IMPORT_INVALID_JSON`
3. 四个必填字段缺失/非字符串/空 → `ERR_SKIN_BAD_META`
4. `id` 不匹配正则 → `ERR_SKIN_BAD_META`
5. `id` 与内置皮肤冲突 → `ERR_THEME_ID_CONFLICT`（**注意：皮肤 id 冲突复用的是 THEME 前缀这个码，不是笔误，不许改**）
6. `client` 非字符串或空 → `ERR_SKIN_CONTRACT`
7. 缺 `__ModuleLoader__.load({` / 缺 `factory` / 括号不配平 → `ERR_SKIN_CONTRACT`
8. 命中高危黑名单 → `ERR_SKIN_DANGEROUS`（**先于** apply/ctx 检查，用于区分"高危"与"契约"）
9. 未导出 `apply` → `ERR_SKIN_CONTRACT`
10. 使用白名单外 `ctx.<名>` → `ERR_SKIN_CONTRACT`（message 含第一个违规名）
11. `base64(skin+client)` 超 256 KB → `ERR_SKIN_SIZE`
12. `a11y` 超 64 KB → `ERR_SKIN_SIZE`
13. `a11y` 含 `@import` 或远程 `url()` → `ERR_SKIN_DANGEROUS`
14. 数量超限 → `ERR_SKIN_COUNT`

导入成功后的落盘形态（沿用）：整段 `client.js` 文本作为 `bundleText` 存进 `skin-gallery-custom-v1`；`a11y` 文本存进 `a11yText`。激活时把 `bundleText` 作为 **Blob-URL 经典脚本**注入执行，再 `modules.import(pkg)` 取 `apply`。重新注册同 id 前先 `modules.invalidate(pkg)`。

**覆盖当前生效项的语义**（自定义皮肤开发者的主循环：改代码 → 重新导入 → 看效果）：若被覆盖的 id **正是当前 applied 或试穿中的那个**，导入成功后**立即用新 bundle 重新激活**（走既有 `applyCustomSkin` 路径：`invalidate` → 重新注入 → 激活）。所以"导入不改变当前外观"这句准确表述是**不改变当前选中的 id**。断言：applied 自定义皮肤 X → 导入改动过的同 id X → `bundleText` 是新的，**且 body 上生效的是新 bundle 的标记**（旧标记不残留）。

**这一节的既有常量（12 条黑名单、256 KB、8 个、四个必填字段、`ctx` 白名单 2 项）是对外承诺**（README.md:176-179 与 README.en.md:34 已公开，外部 navigation-diary 包按此交付并实测通过：raw 93580 B → base64 124776 B）。合并**不得放松也不得收紧**；上面新增的 a11y 三条是**在原契约未覆盖处补门禁**，不改动这 5 组常量。静态断言：这 5 组常量的字面值与 `70c230d` 逐字符相同。

**信任边界声明**（诚实优先于好听）：

- 导入的 `client.js` 以**经典脚本在主页面同源上下文执行**，拥有页面全部权限。12 条黑名单是**纯子串匹配的防手滑闸**，**不是沙箱**。
- 已知未覆盖的能力（举例，不穷举）：`indexedDB`、`new Worker(`、`navigator.sendBeacon`、`caches`、`top.location`，以及 `window['ev'+'al']` 这类字符串拼接绕过。
- a11y CSS 注入进 `<style>` 即生效，本轮补的两条（禁 `@import`、禁远程 `url()`）关掉的是最直接的两条外发通道，同样不是完备防线。
- 结论：这套闸的定位是"**受控导入**"——防止用户误粘一段明显危险的代码，以及给外部交付方一个明确的格式契约。**它不把不可信第三方的皮肤变成安全的**。给用户的文案与 README 都按这个定位表述。

### 3.8 错误契约总表与"不改状态"保证

所有失败都以 `Error` 抛出，带 `.code` 与 `.message`（中文）。UI 统一渲染 `` `${code}: ${message}` ``。

**渲染方式是硬约定**：错误文案（以及皮肤/主题的 `name` / `author` / `label` / `tagline` 等一切用户可控内容）**只作为 React text child 渲染**。`src/**` 中**不得出现** `dangerouslySetInnerHTML` / `innerHTML` / `insertAdjacentHTML`（一条静态断言）。原因：`ERR_SKIN_CONTRACT` 的 message 含"第一个违规的 `ctx.<名>`"，那是从用户粘贴文本里正则抓出来的——若用 HTML 渲染，校验失败分支本身就成了注入面。

| 错误码 | 触发面 | 触发条件（摘要） |
|---|---|---|
| `ERR_IMPORT_INVALID_JSON` | 主题导入 / 皮肤导入 | JSON 解析失败或不是对象 |
| `ERR_THEME_MISSING_FIELD` | 主题导入 | 缺 `id`/`label`/`tokens`；`id` 非法；`label` 超 80 |
| `ERR_THEME_BAD_TOKEN` | 主题导入 | token 键不以 `--dsw-` 开头；值不是 `{light,dark}` 非空字符串；值含 `}` 或非末尾 `;` |
| `ERR_THEME_ID_CONFLICT` | 主题导入 / **皮肤导入** | id 与内置项冲突（主题 15 / 皮肤 9 共用此码） |
| `ERR_UNKNOWN_ID` | 主题/皮肤的 preview / apply / 内置 activate | 目标 id 不在 registry / 不是内置 id |
| `ERR_SKIN_MISSING_FILE` | 皮肤导入 | 缺 `skin.json` 或 `client.js` |
| `ERR_SKIN_BAD_META` | 皮肤导入 | 四必填字段缺失；`id` 非法 |
| `ERR_SKIN_CONTRACT` | 皮肤导入 | 空 client；缺 loader 契约 / 括号不配平；未导出 `apply`；`ctx` 白名单外 |
| `ERR_SKIN_DANGEROUS` | 皮肤导入 | 命中 12 条高危黑名单之一；**或 a11y 含 `@import` / 远程 `url()`** |
| `ERR_SKIN_SIZE` | 皮肤导入 | `base64(skin+client)` 超 256 KB；**或 a11y 超 64 KB** |
| `ERR_SKIN_COUNT` | 皮肤导入 | 自定义皮肤数将超过 8 |

两个**无 code 的运行时错误**（引擎层，沿用现状，测试按 message 断言）：

- `[theme-gallery-skin] unknown-skin: <id> (no embedded bundle)` — 条目在 manifest 里但 bundle 文本缺失。
- `[theme-gallery-skin] "<pkg>" client bundle exports no apply` — 脚本执行了但没导出 `apply`。

**不改状态保证**（每个入口都适用，测试必须逐条验）：

1. **导入类**（T3/S7）："先全量校验通过，再 commit"。任一校验失败 → 8 个 storage 键**一个都不写**、引擎 manifest 不变、当前外观不变、`<style>` 数量不变。
2. **试穿类**（T4/S2）：不写任何 storage 键。失败时不留残留——皮肤执行失败会 `restoreSnapshot(body)` + 逆序跑完已注册 disposer 后重抛。面板关闭时主动撤销（见 3.0 / E3）。
3. **应用类**（T5/S3）：失败时不写 applied 键、不写 track 键。
4. **删除类**（T6/S8）：内置 id 与不存在的 id 都是**静默 no-op**（不抛错、不改 storage）。
5. **storage 不可用**（`getItem`/`setItem` 抛异常，如隐私模式或配额满）：所有读回落默认值、所有写静默忽略，**功能降级但不抛错**（沿用现状的 try/catch 语义）。
6. **registry 损坏**（`skin-gallery-custom-v1` 不是合法 JSON）：读作空 registry，不抛错、不清空用户数据（不主动 `removeItem`）。此时 applied 键会"悬空"，E1 摘要按实际生效外观显示（见 3.3 E1）。
7. **并发**：见 3.3 的串行化约定——重入的激活调用被忽略且不抛错。

### 3.9 模块签名与测试接线点（一个都不许改）

两个新模块的确切签名（**新写的，无旧用例可依**，测试按此写）：

```
createThemePanel({ React, families, customThemeApi, activateFamily, subscribe, onBack }) -> { Panel }
createSkinPanel({ React, engine /* 可为 null */, customSkinApi, skinRuntime, subscribe, onBack }) -> { Panel }
```

| deps 字段 | 类型 / 内容 |
|---|---|
| `React` | 宿主 React（`createElement` / `useState` / `useEffect`）。显式传入而不是用闭包里的全局，单测才能塞 fake React |
| `families` | `THEME_FAMILIES` 数组（每项含 `id` / `label` / `tokens` / `preview.{light,dark}.{background,accent}`） |
| `customThemeApi` | `createCustomThemeApi(...)` 的返回值（11 个函数，见下） |
| `activateFamily` | `(familyId) => void`：由 `apply` 层提供的"应用内置主题"复合动作（注入 tokens + 写 family 键 + `customThemeApi.activateFamily` + notify） |
| `engine` | `createSkinEngine(...)` 实例，**可为 `null`**（`__DSH_MODULES__` 缺失时）。为 `null` 时 `Panel` 只渲染占位文案（见 3.2） |
| `customSkinApi` | `createCustomSkinApi(...)` 的返回值（13 个函数） |
| `skinRuntime` | `{ previewSkin, applySkin, clearSkin, getPreviewState }` —— `apply` 层持有的皮肤运行时动作（含串行化闸与 a11y 注入） |
| `subscribe` | `(listener) => unsubscribe`：`apply` 层的变更订阅（面板用它触发重渲染） |
| `onBack` | `() => void`：面板「返回」按钮回调（由 Entry 传入，内部会先 `revertPreview()` 再关面板） |

两条边界约束（D4 拆分要买的就是这个，不写就白拆）：

1. 两个 panel 文件**不得引用 `client.js` 的任何标识符**（拼接后同作用域，物理上拦不住，靠约定 + 一条 grep 断言：panel 文件里除 deps 字段名外不出现 `apply` 层的模块级标识符）。
2. `Panel` 是**组件引用**，只经 `React.createElement(Panel, props)` 挂载，**禁止**在 Entry 里直接调用 `Panel()`——否则 hooks 会挂到 Entry 上，`open` 切换时 hooks 数量变化，React 报 "Rendered fewer hooks than expected"。

`src/acceptance-api.mjs` 必须导出以下名字（两份旧文件合一后**导出名不变**，否则根 `tests/acceptance/` 的 30 个用例全断）：

```
createThemeAcceptanceApi
createSkinAcceptanceApi
memoryStorage
BUILTIN_THEME_IDS
BUILTIN_SKINS
```

模块级导出（供单测直接 import，沿用现状）：

- `custom-theme.js`：`validateTheme`、`createCustomThemeApi`、`ERR`、`STORAGE_CUSTOM`、`STORAGE_CUSTOM_APPLIED`、`STORAGE_FAMILY`、`STORAGE_TOUCHED`、`TRACK_KEY`、`DEFAULT_THEME_ID`
- `custom-skin.js`：`validateBundle`、`createCustomSkinApi`、`ERR`、`STORAGE_CUSTOM`、`STORAGE_CUSTOM_APPLIED`、`STORAGE_SKIN`、`TRACK_KEY`、`MAX_BUNDLE_B64`、`MAX_CUSTOM_COUNT`、**`MAX_A11Y_BYTES`（新增，65536）**
- `skin-engine.js`：`validateCustomBundle`、`createSkinEngine`、`SKIN_VALIDATION_ERRORS`
- `skin-a11y.js`：`createA11yInjector`

浏览器侧两个全局测试钩子（8 个皮肤单测靠它们跑真实 bundle，**必须保留**）：

- `globalThis.__TG_EXEC_SCRIPT__` — 若为函数，引擎用它替代默认 Blob-URL 脚本注入（串行化断言也用它计注入次数）。
- `globalThis.__TG_SURFACE__` — 若为函数，`client.js` 在模块体末尾调用它并传入 `{ apply, activateSkin, previewSkin, applySkin, clearSkin, currentSkinState, getSkins, getPreviewState, readStored, writeStored, teardown }`。合并后**这 11 个字段名与语义不变**（`activateSkin` 仍是 `applySkin` 的别名），**新增第 12 个 `revertPreview`**（面板关闭撤销试穿，见 3.0）。

### 3.10 构建产物契约

| 契约 | 断言 |
|---|---|
| 壳（铁律 1） | `lib/client.js` 第 1 行 = `window.__ModuleLoader__.load({ id: "dsh-appearance-gallery", factory: (require) => {`；第 2 行 = `var module = { exports: {} }; var exports = module.exports;`；第 3 行 = `const React = require('react');`；末尾含 `return module.exports; } });` |
| 导出 | 尾部含 `exports.apply = apply` 与 `exports.inject = ['slots']` |
| 资源已嵌 | 含 `__SKIN_MANIFEST__`、`__SKIN_BUNDLES__`、`__SKIN_A11Y__`；9 个内置皮肤 id 字符串全部出现 |
| 唯一产物 | `lib/` 下只有 `client.js` 与 `index.js`，**两者都由 `build.mjs` 生成**；不保留 `invariant.js`（全仓无任何消费者，`package.json` 的 `exports["./invariant"]` 一并删除。若 `dsh web` 实跑报缺此路径，则由 build.mjs 生成它，不手工维护） |
| 体积门禁 | `lib/client.js` ≤ **TBD（T3.4 按实测落定）**；4 张背景图 base64 合计 ≤ **TBD（T3.4）**。**不可协商的兜底上限：`lib/client.js` > 921600 B（900 KB）不许收工**——必须换图或走资源外置。T3.4 落定之后，数值只准下调；build.mjs 里数字旁注明落定日期与实测来源 |
| 语法 | 生成串能通过 `new Function(src)` 编译（所有 src 文件被拼进同一个 factory 作用域，这一条用来拦住重名 `const` 造成的 `SyntaxError`） |
| `build` 语义 | 全部断言在**内存串**上通过后才写盘；任一失败 → `throw` 且 `lib/` 不被改 |
| `check` 语义 | **只读**：重新生成 → 跑同一套断言 → 与磁盘 `lib/client.js` 逐字节比对，不一致报"产物与源码不同步" |
| 壳测试独立性 | `tests/unit/shell.test.mjs` 直接读磁盘上的 `lib/client.js` 断言壳，**不得先跑 build**（`70c230d` 那次线上事故的盲区正是"没有任何测试覆盖壳"） |

### 3.11 性能验收口径（可静态断言 / 可脚本测量）

**前置警告（写给测试方与验收方）**：P1 只证明"皮肤源码里不再有 `background-attachment: fixed`"，**不证明滚动变快了**。能证明"变快了"的只有 P9 的三组对照采样。**P1 绿而 P9 没跑 = 不算达标**。

| 编号 | 口径 | 手段 | 门禁？ |
|---|---|---|---|
| P1 | `skins/**/{client.js,a11y.css}` 中 `background-attachment\s*:\s*fixed` 命中数 = **0** | 静态 grep 断言 | 是（但见上面的警告） |
| P2 | 应用任一皮肤后 `getComputedStyle(document.body).backgroundAttachment !== 'fixed'` | 浏览器脚本 | 手工 |
| P3 | 若采用专用背景层方案：`document.querySelectorAll('[data-skin-bg]').length <= 1`，且该层带 `position:fixed` + `pointer-events:none` + 负 `z-index` | 浏览器脚本 | 手工 |
| P4 | 全仓 `backdrop-filter` 出现次数 ≤ **12**，单皮肤 ≤ **4**（基线 55 / miku 45） | 静态计数断言 | 是 |
| P5 | `lib/client.js` ≤ TBD(T3.4)；4 图 base64 合计 ≤ TBD(T3.4)；**兜底 900 KB 不可协商** | 构建期 + 单测双重断言 | 是（兜底值先生效） |
| P6 | 连续 10 次 `getSkins()` 只发生 1 次 `JSON.parse`；registry 写入后下一次读恰好重新解析 1 次。**theme 与 skin 两侧各跑一遍**（两处记忆化是各写一份，不抽公共 helper，靠双侧断言防"改一边忘一边"） | 单测（计数替身 storage） | 是 |
| P7 | 入口组件 `open=false` 时渲染树节点数 ≤ **10**，且不含 `theme-gallery-card` / `skin-gallery-card` / `textarea`；`open=true` 后三者都出现 | 单测（≈20 行 fake React 记录 `createElement` 树；`React` 经 deps 传入，见 3.9） | 是 |
| P8 | 全仓 `skins/` 目录只有 1 个（`find packages -name skin.json` 命中 9 条且同在一处） | 静态断言 | 是 |
| P9 | **归因三组采样**：① 未应用皮肤 ② 应用 blue-fantasy ③ 应用 blue-fantasy 但在 devtools 里把 `background-attachment` 改成 `scroll`。用 `requestAnimationFrame` 采 60 帧 p95。②③ 差值显著才证明 fixed 是主因；治理后 ② 应逼近 ① | 真机手工（`dsh web --port 3199`） | **卡点**：T4.3 必须给出这三个数字；治理后 ②-① 仍显著劣化 → 上报用户重定验收口径，不许静默交付 |
| P10 | 从点击设置页「通用」到页面可交互的耗时（`performance.mark` 前后差），与"卸载本插件后"的同一测量对比，差值 ≤ T0 阶段实测基线后落定的阈值 | 真机手工 | 手工（BRIEF 用户原话场景，必须给数） |
| P11 | 面板打开（15+9 张卡全部挂载）时，面板内滚动 60 帧 p95，与面板关闭时对比 | 真机手工（与 P9 同一套采样脚本） | 手工。**这条同时是"不做列表虚拟化"这个决策的证据**；若超标，虚拟化再谈 |

---

## 4. 任务拆解

标注约定：`[串]` 必须按序、`[并]` 可与同组其他任务并行、`←` 依赖。

### 阶段 0 — 前置（不做完这些，后面无法判断"是不是我弄坏的"，也无法判断"到底修没修好"）

| # | 任务 | 说明 |
|---|---|---|
| T0.1 `[并]` | 固化测试基线 | 在 `70c230d` 上跑三处 `node --test`，把结果（theme 16/15 过 1 败、skin-gallery 39/39、skin-runtime 39/39、根 acceptance 30/30）写进 `.devflow/test-baseline.txt`。§9.2-C10：HEAD 上本来就有 1 红 1 假绿，不能拿"全绿"当合并成功判据 |
| T0.2a `[串]` | **spike S3（先做）**：rAF 采样脚本可用性 | 在 `dsh web --port 3199` 控制台跑 60 帧 p95 采样，重复 3 次看方差。**测量能力是决策前提，不是验收附属品**——没有它 T0.2b 无法判读。10 分钟 |
| T0.2b `[串]` ← T0.2a | **归因实验（原 S1 升级）** | 按 §1.4.1 采三组数字（未应用 / blue-fantasy / blue-fantasy+手动改 `scroll`）+ Paint flashing/Layers 观察 + 顺带记录滚动容器归属。**这是卡点**：结果决定 G1 走 A/B/C 支、决定 T3.2/T3.3 做不做，必须先给用户看。30 分钟 |
| T0.3 `[并]` | **spike S5**：`dsh plugin` 的卸载子命令名 | `dsh plugin --help`。**阻塞 README 迁移段**，不许猜。2 分钟 |
| T0.4 `[并]` | **spike S6**：拿 blue-fantasy 那张 286 KB 图试压一次 WebP | 单张试压看真实压缩率，**再**决定 G3 的门禁数值区间。避免拿倒推的愿望值当门禁。10 分钟 |
| T0.5 `[并]` | P10 基线 | 用 `performance.mark` 测"点开设置→通用"当前耗时（旧三包在装状态），作为 P10 的对照基线。5 分钟 |

### 阶段 1 — 建包（骨架，内部串行）← 阶段 0 不阻塞它，可同时起

| # | 任务 | 说明 |
|---|---|---|
| T1.1 `[串]` | 建包 + 搬文件 | `git mv` 搬 `skins/`、`skin-engine.js`、`custom-skin.js`、`skin-a11y.js`（从 skin-runtime）与 `themes.curated.js`、`custom-theme.js`（从 theme-gallery）；新写 `package.json`（inject 三项并集）、`cordis.patch.yml`、`src/index.js` |
| T1.2 `[串]` ← T1.1 | UI 工厂化 | 旧 `theme-gallery/src/client.js` → `src/panel-theme.js` 的 `createThemePanel(deps)`；旧 `skin-runtime/src/client.js` → `src/panel-skin.js` 的 `createSkinPanel(deps)`。**整体收进函数体**，内部名不动（D4）。两份 CSS 合并成一个常量 |
| T1.3 `[串]` ← T1.2 | 写 `src/client.js` | `apply(ctx)` 接线（引擎实例 + 启动恢复 + token override + 激活串行化闸 + `revertPreview`）+ `AppearanceEntry`（只有 `open` 一个 state + 旧包在场自检）+ 单槽位注册 + `__TG_SURFACE__` 钩子（11 个字段照旧 + 新增 `revertPreview`） |
| T1.4 `[串]` ← T1.3 | 写 `build.mjs` | 四项改造（§2.2）：拼接顺序、`new Function` 语法自检、断言先于落盘、`--check` 只读 |
| T1.5 `[并]` ← T1.1 | 合并 `acceptance-api.mjs` | 5 个导出名一字不改（INTERFACE §3.9） |

### 阶段 2 — 测试面（← T1.4；T2.1/T2.2/T2.3 三者可并行）

| # | 任务 | 说明 |
|---|---|---|
| T2.1 `[并]` | 搬单测 | theme 3 个 + skin 8 个（两份重复的只留一份），改路径。`scroll.test.mjs` 的跨包硬编码路径（当前红的根因）随之消失 |
| T2.2 `[并]` | 修根 acceptance 三处硬编码路径 | `tests/acceptance/skin-custom.test.mjs:17`、`theme-skin-build-static.test.mjs:12-13`；并把后者 20-41 行的宽松断言**改严**（匹配不到 `.skin-gallery-grid` 就失败，消除假绿） |
| T2.3 `[并]` | 新增 5 个测试 | `shell.test.mjs`（读磁盘产物断言壳，不跑 build）、`slot-register.test.mjs`（id/order/无 priority/只 1 处 register）、`entry-lazy.test.mjs`（fake React 树，P7 + hooks 顺序）、`perf-static.test.mjs`（P1/P4/P5/P8 + storage 键白名单含 `skins/**` + 禁 `innerHTML` 系）、`concurrency.test.mjs`（串行化闸：并发 apply + 重复 apply 的注入次数） |

### 阶段 3 — 性能治理（← **T0.2b 的归因结果决定 T3.2/T3.3 做不做、做哪些**；按皮肤切分可并行）

| # | 任务 | 说明 |
|---|---|---|
| T3.1 `[并]` | G5 记忆化 | 改 `custom-skin.js` 与 `custom-theme.js` 的 `readCustomItems`（各 ~6 行）+ P6 单测**两侧各跑一遍**。不抽公共 helper（抽了要新增文件 + 改 build 拼接顺序，不划算），靠双侧断言防"改一边忘一边"。与 T3.2/T3.3 完全不碰同一文件 |
| T3.2+T3.3 `[并按皮肤]` ← T0.2b | 皮肤资源治理 | **同一个皮肤的 G1 + G2 + G3 合在一个 commit 里做**（三者都改同一个 `skins/<id>/client.js`）；**不同皮肤之间可并行**。顺序：**先只做 miku 一款交给用户看**（blur 大户，视觉变化最明显），认可后再推 blue-fantasy / whale-song / dragon-heir / xp。若 T0.2b 判为 B 支，本任务的范围改成"归因命中的那一项" |
| T3.4 `[串]` ← T3.2 | 门禁数值落定 | 按实测值把 `build.mjs` 的两个上限写死（**先做后定**；参考 T0.4 的单张试压率），数字旁注明落定日期与实测来源，同步更新 INTERFACE §3.10/§3.11 的 TBD。**兜底 900 KB 从第一天就生效，与落定无关** |

### 阶段 4 — 验证与收尾（严格串行）

| # | 任务 | 说明 |
|---|---|---|
| T4.1 `[串]` | 门禁全绿 | `pnpm --filter dsh-appearance-gallery build && check && test` + 根 `node --test tests/acceptance/*.mjs`；对照 T0.1 基线逐项确认"该绿的绿了、没有新红" |
| T4.2a `[串]` | 新包幂等断言（删旧包**前**） | 只跑 `pnpm --filter dsh-appearance-gallery build && check`，`git status` **只看 `packages/appearance-gallery/`**。此时旧三包还在，`pnpm -r` 会被旧包那颗地雷搞脏，不是新包的问题——别在这里浪费诊断成本 |
| T4.3 `[串]` | 隔离实例实跑 | `dsh web --port 3199`，loader 失败计数 0；手工过 INTERFACE §3.3 的 E1-E3 + T1-T7 + S1-S8 全 18 个入口；**P2/P3/P9/P10/P11 在此测并把数字写进验收报告**（P9 是卡点：治理后 ②-① 仍显著劣化就上报用户重定口径）；另跑一个"旧三包在装状态下装新包"场景，确认 app 能启动且入口处出现冲突提示 |
| T4.4 `[串]` ← 用户确认 | 删旧三包 | `git rm -r packages/{theme-gallery,skin-gallery,skin-runtime}`。**批量删除是红线，执行前必须再问一次用户** |
| T4.5 `[串]` | 文档 | README.md / README.en.md（§2.5 清单）+ 包内 README/README.zh-CN/CHANGELOG 三套并一套 + 迁移命令（用 T0.3 核实的子命令名）+ 重拍截图 |
| T4.6 `[串]` | 顺手更正 | `LEARNINGS.md:19` 那句"已修…（未提交）"已过期（该修复就是 `70c230d`，已推 GitHub main），改掉（§7.1） |
| T4.7 `[串]` ← T4.4 | 全量幂等断言（删旧包**后**） | 根 `pnpm -r build` 与 `pnpm -r check` 跑完，`git status` 全仓无改动 → 这才是 BRIEF 硬约束"`pnpm -r build/check` 不得再摧毁产物"真正要的那个证明 |

**关键路径**：T0.2a→T0.2b → T1.1→T1.2→T1.3→T1.4 → T2.* / T3.* → T4.1→T4.2a→T4.3→T4.4→T4.5→T4.7。
真正能并行的是：T0.1/T0.3/T0.4/T0.5、T1.5、阶段 2 三项、阶段 3 的"按皮肤切分"（且 miku 先行是卡点）。

---

## 5. 风险清单

每条给「失败模式 → 缓解」。多文件/删除/安全类给 ≥2 个失败模式（rules.md 风险评估条）。

### R1 — 拼接作用域标识符冲突（D4，高危）

- **失败模式 1**：两份 UI 顶层同名 `const CSS` / `readStored` / `notify` 等（至少 10 个）拼进同一 factory → `SyntaxError`，宿主启动时整个 web app 起不来（不是本插件降级，是全崩）。
  **缓解**：UI 收进工厂函数（作用域隔离）；`build.mjs` 落盘前 `new Function(output)` 编译自检（只编译不执行），构建期就炸而不是运行期。
- **失败模式 2**：`stripExports` 把 `export function createThemePanel` 削成 `function createThemePanel` 时，若源码里有 `export {…}` 尾块或多行 `export default`，正则漏切留下裸 `export` → 同样 SyntaxError。
  **缓解**：同一个 `new Function` 自检覆盖；新写的两个 panel 文件只用 `export function`（与仓内现有 5 个被内联的模块保持同一写法）。

### R2 — 700 行 UI 搬家（高危：多文件 + 功能面广）

- **失败模式 1**：漏搬某个入口（`designSummary` 的 11 个版块、删除的二次确认、`previewState` 的"试穿中/已应用"标记）→ 功能静默丢失，测试不一定覆盖到。
  **缓解**：INTERFACE §3.3 的 18 个入口就是搬迁清单，T4.3 手工逐条过；30 个根验收用例守 API 层。
- **失败模式 2**：把 panel 组件当普通函数在 Entry 里直接调用（`ThemePanel()` 而不是 `createElement(ThemePanel)`）→ hooks 挂到 Entry 上，条件渲染时 hooks 顺序变化 → React 报 "Rendered fewer hooks than expected"。
  **缓解**：约定 `createThemePanel()` 返回的是**组件引用**，只经 `React.createElement` 挂载；`entry-lazy.test.mjs` 的 fake React 会记录 hook 调用顺序，open 切换前后不一致就失败。

### R3 — G5 解析记忆化

- **失败模式 1**：缓存把 `items` 数组引用交给调用方，调用方就地 mutate（引擎的 `registerCustomBundle` 会写 `manifest[i]`）→ 缓存被污染，界面显示与 storage 不符。
  **缓解**：缓存只存 parse 结果；写路径（`writeCustomItems`）一律构造新数组（现状已如此：`items.slice()` + `next`）；单测断言"import 之后再读，数量与内容正确，且上一次读到的对象未被改写"。
- **失败模式 2**：另一个标签页改了 registry，本页读到旧数据。
  **缓解**：这正是选"按 raw 字符串比对"而不是"写时失效"的原因——`getItem` 仍每次真读，只有内容相同才跳过 parse，**不存在脏读窗口**。

### R4 — 皮肤视觉改造 G1/G2（高危：改的是用户看得见的东西，且根因可能判错）

- **失败模式 0（第 1 轮审查判为致命）**：G1 的因果链没被证实就动手——若 body 不滚，删掉 `background-attachment: fixed` 是**性能零收益**的操作，而 P1 照样变绿，交付一个"门禁全绿、滚动照旧卡"的版本。
  **缓解**：T0.2b 归因实验（§1.4.1）三组对照采样，②③ 差值显著才动手；P9 从"非门禁"升级为**卡点**（治理后仍显著劣化必须上报用户，不许静默交付）；B 支明确写"G1 收益 0，如实记账"，并给出继续归因的候选清单（blur 数 / box-shadow 数 / 大图 decode + cover 缩放 / 常驻 setInterval）。
- **失败模式 1**：body 确实是滚动容器，删掉 fixed 后背景随内容滚动 → 5 款皮肤观感被破坏。
  **缓解**：走 A 支的专用 `position:fixed` 背景层（视觉等价、可独立合成），不是裸删。
- **失败模式 2**：blur 换成半透明纯色后文字对比度不足（气泡压在图上看不清）。
  **缓解**：既有"9 皮肤 × 亮暗对比度"单测必须继续全绿；换色时提高不透明度而不是降低。
- **失败模式 3**：用户不认这种视觉变化（"我要的是不卡，不是换风格"）。
  **缓解**：先只改 **miku** 一款（blur 大户）交给用户看，认可后再推其余四款——这是一个卡点，不要一口气改完 5 个皮肤。

### R5 — G3 图片重编码

- **失败模式 1**：WebP 有损压出色带/糊，用户不接受。
  **缓解**：逐皮肤单独 commit（可单点回退）；给前后对比截图；原始 data URI 永久留在 git 历史。
- **失败模式 2**：某张图带 alpha 通道，有损 WebP 边缘发脏。
  **缓解**：有 alpha 的用无损/高质量 WebP；压不下来就单独放过它，**门禁按实测达标值设定，不为凑数字牺牲观感**（T3.4）。
- **失败模式 3**：压完达不到"愿望值"，于是有人把门禁调大——门禁的公信力就此报废（"只准下调"和"按实测落定"原本互相打脸，这是第 1 轮审查 I3 指出的）。
  **缓解**：把两个数字明确分成两层——**目标值 TBD（T3.4 按实测落定，落定后只准下调）** + **兜底上限 900 KB 不可协商（超了不许收工，必须换图或走 S2 资源外置）**。T0.4 先拿单张图试压给出可信区间，避免再用倒推的愿望值。

### R6 — 升级迁移：老用户三包已装、applied 状态在旧键（高危）

- **失败模式 1**：用户先装新包、忘卸旧包 → 旧 `skin-runtime` 与新包同时启动，两个引擎都 `activateSkin`，body 属性/内联 style/chrome 元素双写，切换时卸不干净。
  **缓解**：① 新槽位 id（D2）保证**不会启动 throw**；② **运行时自检**：新包 `apply` 时探测旧包的 style 标记，命中就在入口处渲染"请先卸载旧版"的醒目提示（§3.2）——README 没人读，界面上的一行字有效一个数量级，顺带给 T4.3 的共存场景提供断言目标；③ T4.3 跑"三旧包在装状态下装新包"场景。
  **更正一处原方案的乐观说法**：原文写"刷新/卸旧包即恢复"是错的——两个包都做启动恢复、都 `activateSkin`，**刷新只会把同一个冲突状态再复现一遍**。真正恢复只能靠卸旧包。软互斥能拦住 track 键被抢占是运气，不是设计。
- **失败模式 2**：storage 键若被改名/改语义 → 老用户丢失已导入的自定义皮肤（`bundleText` 全在 `skin-gallery-custom-v1` 里）与当前外观。
  **缓解**：D5 零迁移——8 个键名与语义一字不改；INTERFACE §3.4 的 4 条兼容断言 + 第 5 条"键白名单"静态断言；registry 损坏时按空处理但**不主动 `removeItem`**（不销毁可能可修复的数据）。
- **失败模式 3**：`skin-gallery-*` 这个前缀在新包里看着"名不副实"，后来的人手痒改名。
  **缓解**：在 `custom-skin.js` 常量处写死一行注释说明"键名带旧前缀是刻意的，改名 = 老用户丢数据"，并由 §3.4 第 5 条断言兜住。

### R7 — 构建链地雷（§9.2-C5）的消除与验证

- **失败模式 1**：`--check` 语义改了，但 `pnpm -r check` 因别的包（`turn-scrubber` 等走 `tsc --noEmit`）先失败而掩盖本包问题。
  **缓解**：门禁用 `pnpm --filter dsh-appearance-gallery check`；根命令只作为回归。
- **失败模式 2**：改造后 `build` 仍不幂等（模板里带时间戳/对象键序不稳）→ `git status` 每次都脏，"幂等断言"变成噪声后被忽略，地雷复活。
  **缓解**：`buildManifest` 的排序键固定（现有 `sort((a,b)=>a.order-b.order)`），不引入任何时间/随机内容。
- **失败模式 3**：幂等断言排在删旧包之前 → 旧包那颗地雷把 `pnpm -r` 的结果搞脏，T4.2 必红且不是新包的问题，白花诊断成本（第 1 轮审查 S2）。
  **缓解**：拆成 T4.2a（删包前，只 `--filter` 本包 + 只看本包目录）与 T4.7（删包后，根 `pnpm -r` 全量幂等）。后者才是 BRIEF 硬约束要的那个证明。

### R8 — spike 清单（**需实证，不许当成立写进实现**）

| # | 假设 | 最小实验 | 阻塞什么 |
|---|---|---|---|
| **S3（提前到 T0.2a，最先做）** | rAF 采样脚本能在 DSH web 内跑并给出稳定 p95 | 控制台跑 60 帧采样，重复 3 次看方差 | **一切性能决策的前提**（原方案把它挂在"P9 能否量化"名下、排在最后，顺序颠倒了） |
| **S1（升级为归因实验，T0.2b）** | `background-attachment: fixed` 是滚动卡顿主因 | §1.4.1 的三组对照采样 + Paint flashing/Layers；顺带记录滚动容器归属（`document.scrollingElement` + document 上挂 `scroll` 监听，元素 scroll 不冒泡故可区分） | **G1 整条战线做不做、走 A/B/C 哪支**；也决定 BRIEF 成功标准 4 能承诺什么 |
| S2 | 宿主能按 URL 提供插件包内的额外静态文件 | 读 boot graph 里 bundle URL 形态；试请求同目录下另一文件 | 仅当 G3 压缩后仍超 900 KB 兜底线才需要 |
| S4 | `require('react-dom')` 在 factory 壳里可用 | 仅当用户改选形态 C 时才做：在插件里试 `require('react-dom')` | 形态 C 可行性 |
| S5 | `dsh plugin` 的卸载子命令名 | `dsh plugin --help` | README 迁移命令 |
| **S6（新增，T0.4）** | WebP 重编码能把 4 图 base64 从 ~773 KB 压到目标区间 | 拿 blue-fantasy 那张 286 KB 图单张试压，看真实压缩率 | G3 门禁数值区间（原方案的 300 KB/700 KB 是倒推的愿望值，不是实验结果） |

已消除的假设（本轮不再需要 spike）：a11y 新增门禁是否误伤现有交付物——**已实测**：9 套内置 `a11y.css` 最大 1264 B、0 处 `@import`/远程 `url()`；`navigation-diary/a11y.css` 2363 B、0 命中。`lib/invariant.js` 是否有消费者——**已 grep 全仓**：无（唯一命中是无关的宿主依赖 `@deepseek-ai/dsh-invariants`）。9 套内置皮肤是否读写 localStorage——**已 grep**：0 处。

### R9 — 无法自动化的验收（诚实声明）

P2/P3/P9/P10/P11 没有仓内自动化手段，只能在 `dsh web --port 3199` 里手工测并写进验收报告。**但 P9 是卡点**（不是"可选"）：它是唯一能证明卡顿真的被修好的口径，T4.3 必须给出三组数字；治理后仍显著劣化就上报用户重定验收口径，不许静默交付。P10（点开"通用"的耗时）与 P11（面板打开后滚动）覆盖的正是 BRIEF 引用的用户原话场景，同样必须给数——P11 还兼任"不做列表虚拟化"这个决策的证据。
§9.2-C9 说得对：写成"应用任意皮肤后滚动不卡"是超出资源现状的承诺——治理后可以承诺的是"劣化幅度受控 + 静态指标达标 + 三组归因数字在案"。

### R10 — 测试基线（§9.2-C10）

- **失败模式**：拿"测试全绿"当合并成功判据，而 HEAD 上本来 1 红（`theme-gallery/tests/unit/scroll.test.mjs:13` 跨包硬编码路径）+ 1 假绿（`theme-skin-build-static.test.mjs:20-41` 匹配不到就跳过断言）。
  **缓解**：T0.1 先固化基线；T2.2 把假绿改严；T4.1 逐项对照基线。

### R11 — BRIEF 敏感面：逐项"怎么保证不越权/不泄露"

| 敏感面声明 | 保证手段（可断言） |
|---|---|
| 不新增外部网络请求（**措辞按第 1 轮审查 I5 收窄成两句，原表述的保证范围小于其字面承诺**） | ①**包内代码**不发起外部请求：`src/**`、`skins/**`、`lib/client.js` 中不出现 `fetch(` / `XMLHttpRequest` / `WebSocket(` / `EventSource` 的**调用**（断言时先剔除 `DANGEROUS_PATTERNS` 数组字面量所在行，那是黑名单常量不是调用）。②**用户导入的 `client.js` / `a11y.css`** 在同源上下文执行，其网络行为**不受本插件约束**——这是既有契约的边界，刻意保留；本轮只补了 a11y 的两条最直接通道（禁 `@import`、禁远程 `url()`），并在 INTERFACE §3.7 写明信任边界声明。皮肤 bundle 走自产 Blob-URL 经典脚本（同源），不算外部请求 |
| 不碰密钥 | 包内不读任何环境变量、不读 `document.cookie`（后者本身在 12 条黑名单里）；无任何凭证/令牌相关代码路径 |
| localStorage 只碰外观状态、不越界读写其他键 | 只读写 INTERFACE §3.4 那 8 个键，键名只能来自模块常量（静态断言）；**不出现** `localStorage.clear()` / `Object.keys(localStorage)` / `localStorage.key(` / 任何遍历；测试第 4 条断言"跑完全流程后没有新增的 `theme-gallery`/`skin-gallery`/`dsh-appearance` 前缀键" |
| 不丢用户已导入的自定义主题与皮肤 | D5 零迁移 + §3.4 的 4 条兼容断言 + registry 损坏时按空处理但不 `removeItem`（不销毁数据） |
| 导入安全闸不放松（黑名单/256KB/author-license 必填） | §3.7 的 5 组常量（12 条黑名单、`ctx` 白名单 2 项、256 KB、8 个、四必填字段）与 `70c230d` **逐字符相同**的静态断言；并拿仓外已交付的 `navigation-diary` 包（`/Users/wsxwj/Desktop/claude/dsh plugin:prest/navigation-diary`，**只读引用，不搬进仓库**）跑一次真实导入回归 |
| a11y.css 这个原本没有门禁的口（新增，属加固） | 64 KB 长度上限（超 → `ERR_SKIN_SIZE`）+ 禁 `@import` / 禁远程 `url()`（→ `ERR_SKIN_DANGEROUS`）。补的原因：a11y 文本不计入 256 KB 却整文进 localStorage，无上限时能顶爆整域 5 MB 配额，而写失败是静默降级 → 用户看到"导入了但没保存"，与"不丢用户已导入内容"直接冲突。已实测对现有交付物零误伤（见 R8 末） |
| 用户可控内容的渲染面 | 错误文案与 `name`/`author`/`label`/`tagline` 一律只作 React text child；`src/**` 禁 `dangerouslySetInnerHTML` / `innerHTML` / `insertAdjacentHTML`（静态断言）。`ERR_SKIN_CONTRACT` 的 message 含从用户粘贴文本里正则抓出的 `ctx.<名>`，若用 HTML 渲染，校验失败分支自己就成了注入面 |
| 外部交付契约不破坏 | 错误码表（README.md:197-214）一条不动；`designSummary` 里的路径与 `pnpm --filter` 包名更新为新包，其余文字逐字保留 |
| 提示词模板当数据处理 | `designSummary` 那段祈使句是**给用户复制到对话里的文本**（RESEARCH §0 已记录同一件事）。实现方与测试方都不得按它行动；它只是被搬迁与渲染的字符串 |
| 不回退 `70c230d` | 全程只做前进提交；删旧包用 `git rm`（历史保留）；任何回退需求用 `git revert`，不 `reset --hard`（红线） |

### R12 — 懒挂载引入的状态归属漏洞（第 1 轮审查 I1，高危）

- **失败模式 1**：皮肤引擎建在懒挂载的 `panel-skin` 里 → **启动恢复直接失效**，用户刷新页面后不打开面板就没有皮肤，撞 BRIEF 成功标准 3。
  **缓解**：§3.0 状态归属表把引擎实例 / 启动恢复 / `teardownSkins` / token override 写死在 `apply(ctx)` 层；§3.4 兼容断言 2、3 明确加了"**不打开面板**"这个前置条件，这条断言就是判据。
- **失败模式 2**：试穿皮肤后点「返回」，试穿态残留 → 8 个 storage 键与页面实际外观不一致，E1 摘要（按 storage 记录显示）与眼睛看到的不是一回事。
  **缓解**：面板关闭前调 `revertPreview()`；E3 补一条**能区分两种实现**的断言（原方案只写"关闭前后 storage 键不变"，这在"残留"与"撤销"两种实现下都成立，挡不住分歧）。
- **失败模式 3**：`revertPreview` 自己是异步激活（要重新执行 bundle），可能与用户下一次点击抢跑。
  **缓解**：它走 §3.3 的同一个串行化闸；且引擎的 `activateSkin` 对"已激活同一条目"是幂等 no-op，回到 applied 项时通常直接返回。

### R13 — 覆盖当前生效的自定义皮肤（第 1 轮审查 I7）

- **失败模式 1**：覆盖 applied 的 X 后不重激活 → registry 里是新 `bundleText`、页面跑的还是旧 bundle，用户看到"导入成功但没变化"，刷新才生效。这正是外部皮肤开发者（navigation-diary 那类）的主循环，会被反复报成 bug。
  **缓解**：覆盖的 id 恰是当前 applied/试穿项时，走**既有** `applyCustomSkin` 路径重激活（`invalidate` → 重新注入 → 激活），几乎零新增代码；断言"body 上是新 bundle 的标记、旧标记不残留"。
- **失败模式 2**：新 bundle 有运行时错，重激活失败 → 用户既丢了旧外观又没有新的。
  **缓解**：引擎已有 `restoreSnapshot` + disposer 逆序回滚；重激活失败时 `bundleText`（已 commit）保留、UI 显式报错并回到无皮肤态，不静默。

### R14 — 并发与重复激活（第 1 轮审查 I4）

- **失败模式 1**：皮肤 A 还在注入时点了 B（卡片列表里 5 秒内就能触发）→ 两条流程交错：A 的 `restoreSnapshot` 可能拍在 B 已改过 body 之后，disposer 逆序执行错位 → **偶发的样式残留 / 切皮肤卸不干净**，属最难查的一类。
  **缓解**：§3.3 的串行化约定——一个布尔闸，重入直接 return（不排队不抛错）+ 按钮 `disabled`；`concurrency.test.mjs` 断言 `Promise.all([applySkin('qq98'), applySkin('miku')])` 之后 body 只剩一套皮肤痕迹且与 storage 一致。
- **失败模式 2**：重复点同一个「应用」→ 二次注入脚本，或 `__ModuleLoader__.load` 同 id 重复注册抛错。
  **缓解**：同一个闸 + 引擎已有的幂等 no-op；用可计数的 `__TG_EXEC_SCRIPT__` 替身断言注入次数 = 1。

---

## 修订记录（第 1 轮审查后）

审查输入：`.devflow/PLAN-REVIEW.md`（1 致命 + 12 重要 + 5 建议）。逐条处理如下。

| # | 处理 |
|---|---|
| **F1** 致命：G1 因果链自相矛盾 | **已改，三处联动**。新增 §1.4.1「G1 必须先做归因实验」：承认"body 不滚 ⇒ 删 fixed 性能零收益"与"fixed 是主因"不能同时成立；T0.2 从"查滚动容器"升级为**三组对照采样 + Paint flashing/Layers** 的归因实验，并把原 S3（rAF 采样可用性）提前为 T0.2a（测量能力是决策前提）；补第三分支 B（fixed 不是主因 → G1 收益记 0，转查 blur 数/box-shadow/大图 decode+cover 缩放/常驻 setInterval），以及"皮肤根本不是卡顿来源"时停下上报用户；P9 从"不作为门禁"升级为**卡点**，并在 §3.11 顶部写死"P1 绿 ≠ 滚动变快"。 |
| **I1** 试穿态归属 + 引擎归属自相冲突 | **已改**。INTERFACE 新增 §3.0 状态归属表（引擎/启动恢复/teardown/token override 在 `apply` 层；UI 态在面板；试穿态 `apply` 层持有但关面板主动撤销）；E3 补一条能区分两种实现的断言；§3.4 兼容断言 2、3 加"不打开面板"前置；新增风险 R12（3 个失败模式）。 |
| **I2** panel deps 契约缺失 + §3.9 指向空地 | **已改**。§3.9 给出两个工厂的确切签名与 deps 逐字段表（含 `React` 显式传入、`engine` 可为 `null`），并把两条边界约束（panel 不得引用 `client.js` 标识符；`Panel` 只经 `createElement` 挂载）从风险清单搬进接口契约。 |
| **I3** 体积门禁既是死断言又是待实测 | **已改**。目标值改成 `TBD(T3.4 落定)`，另立**不可协商兜底 900 KB**；"只准下调"限定为"T3.4 落定之后"；G3 预期效果标注为**估算**（WebP 对 JPEG 照片类通常仅 25%-35%）；新增 T0.4/spike S6 单张试压先给可信区间。 |
| **I4** 并发/重复操作未定义 | **已改**。§3.3 加「激活流程串行化约定」（布尔闸，重入直接 return，按钮 disabled，新流程前先撤销试穿）+ 两条断言；T2.3 新增 `concurrency.test.mjs`；新增风险 R14。 |
| **I5** a11y 是安全闸豁免口 + R11 保证范围虚高 | **已改**。§3.7 给 a11y 补三条门禁（64 KB → `ERR_SKIN_SIZE`；禁 `@import`、禁远程 `url()` → `ERR_SKIN_DANGEROUS`），并实测确认对 9 套内置（≤1264 B、0 命中）与 navigation-diary（2363 B、0 命中）零误伤；§3.7 末尾加**信任边界声明**（同源全权限、黑名单是防手滑不是沙箱、列出已知未覆盖 API）；R11 第 1 行改成两句式（包内代码可断言／用户导入内容不受约束）。 |
| **I6** 引擎 null 时 S5/S7/S8 未定义 | **已改**。§3.2 一句话填满三个空白：引擎为 `null` 时皮肤段只渲染占位文案，**S1–S8 全部不渲染、不可调用**（因此不存在"写了 storage 但引擎不知道"的半提交）；配"占位态下不存在这些按钮"的断言。 |
| **I7** 覆盖同 id 已应用皮肤未定义 | **已改，取审查的方案 a**。§3.7 加「覆盖当前生效项的语义」：覆盖的 id 恰是 applied/试穿项时立即用新 bundle 重激活（走既有 `applyCustomSkin` 路径），"不改变当前外观"改述为"不改变当前**选中的 id**"；配断言；新增风险 R13。 |
| **I8** `lib/invariant.js` 是手工产物 | **已改**。全仓 grep 确认**无消费者**（唯一命中是无关的宿主依赖 `@deepseek-ai/dsh-invariants`）→ 直接砍掉文件与 `exports["./invariant"]`；`src/index.js`/`lib/index.js` 保留并给出依据（`package.json` 的 `main`/`exports["."]` 指向它，node 侧解析包入口需要），且由 build.mjs 生成。 |
| **I9** 缺"打开设置"与"面板打开后滚动"的口径 | **已改**。新增 P10（`performance.mark` 测点开"通用"的耗时，对照 T0.5 基线）与 P11（面板打开后滚动 60 帧 p95，兼作"不做虚拟化"的证据）；两条都进 T4.3 手工验收并要求给数。 |
| **I10** 旧包共存的后果被低估 | **已改**。新增约 5 行**运行时自检**（探测旧包 style 标记 → 入口处渲染"请先卸载旧版"提示），写进 §3.2 与 D2；R6 更正"刷新即恢复"这句错误说法（两个包都做启动恢复，刷新只是复现同一冲突）。 |
| **I11** E1 悬空 applied 未定义 | **已改**。§3.3 E1 写死"摘要只反映**实际生效**的外观，不直接读 applied 键渲染文案"，配断言"预置悬空 applied + 空 registry → 摘要 = jade 的 label"。 |
| **I12** 错误文案渲染方式未约定 | **已改**。§3.8 加硬约定：错误文案与一切用户可控内容只作 React text child，`src/**` 禁 `dangerouslySetInnerHTML` / `innerHTML` / `insertAdjacentHTML`（静态断言，进 `perf-static.test.mjs`）；R11 加一行同款保证。 |
| **S1** 建议砍掉 section 懒挂载 | **采纳**。删掉 `section` state，主题区与皮肤区在面板内同时挂载；§1.2/§1.4/§3.0 三处同步，并把理由写明（不能一边说 200 节点不值得虚拟化、一边为 100 节点加一层懒挂载）。顺带少一条试穿撤销触发路径。 |
| **S2** T4.2 幂等断言排序错 | **采纳**。拆成 T4.2a（删包前，只 `--filter` 本包、只看本包目录）与 T4.7（删包后跑根 `pnpm -r` 全量幂等）；R7 加对应失败模式。 |
| **S3** 键白名单断言漏 `skins/**` | **采纳**。§3.4 第 5 条把断言路径扩到 `skins/**`，并附实测（9 套内置皮肤 0 处 `localStorage`/`sessionStorage`/`document.cookie`，断言立即可绿）。 |
| **S4** 两份记忆化不抽但要留痕 | **采纳**。不抽公共 helper（理由写进 T3.1），P6 改成 theme/skin **两侧各跑一遍**。 |
| **S5** 搜索框超长输入 | **采纳**。T1/S1 契约加"输入超过 64 字符即截断"。 |

**本轮未采纳的项：无**（12 条重要全采纳，5 条建议全采纳）。

**本轮新增的待实证假设**：只有 1 条——**S6**（WebP 单张试压的真实压缩率，T0.4，10 分钟）。同时**消除**了 3 条原本悬着的假设：a11y 新门禁是否误伤现有交付物（已实测 0 命中）、`lib/invariant.js` 是否有消费者（已 grep，无）、内置皮肤是否读写 localStorage（已 grep，0 处）。原 S1 未新增，而是**升级**为归因实验；原 S3 未新增，而是**提前**到阶段 0 最先做。
