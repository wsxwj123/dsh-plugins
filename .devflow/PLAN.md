# PLAN — dsh-theme-gallery 内置九款完整皮肤：实现架构

> 前置：BRIEF.md（需求定稿）。本文是方案定稿，供开发代理落地。
> 本方案只读探查了本机 `@linxin666/dsh-skins` 及其 `skins/*`、`skin-center` 的实现，以下机制描述以实际 bundle 为准（已验证）。

---

## 1. 结论先行

在**现有 `packages/theme-gallery` 包内**新增一条"皮肤轨道（skins track）"，与现有"主题轨道（token track）"并存互斥：

- 新增 `src/skins/` 资产目录：9 款上游 `lib/client.js` bundle 原样副本 + 各自 `skin.json`（保留 author/order/bodyAttr）+ 每款一份 `LICENSE`/NOTICE 摘录。
- 为每个 skin bundle 生成一个"可访问性修正 CSS"（`a11y/<id>.css`，含亮/暗两段）。
- 新增一个 browser 端皮肤引擎 `apply(skins)`：加载→应用→互斥切换→卸载全部走 `ctx.effect` 生命周期，可回退。
- 新增 UI 卡组（挂在 `settings.general.item`，与主题卡组并列）：`skin 皮肤` / `主题` 两个 tab 或分段，二选一激活。
- README + `LICENSE`/`NOTICE` 增加 BSD-3 全文与逐皮肤致谢。

**关键决策**：不引入 Host 层持久皮肤开关（不碰 `~/.dsh/cordis.patch.yml` / symlink），皮肤选择是**进程内、会话级、可回退**的 try-on；要永久生效仍走官方 `dsh-skin use`。理由见 §5。

---

## 2. 包结构

当前 `packages/theme-gallery/`：
```
src/index.js  src/client.js  src/themes.curated.js
lib/{index,client,invariant}.js  (build.mjs 生成)
cordis.patch.yml  build.mjs  package.json  LICENSE  README.md  README.zh-CN.md  CHANGELOG.md
```

目标结构（新增以 ▲ 标注）：

```
packages/theme-gallery/
  src/
    index.js                     # 不变：host 空 apply
    client.js                    # ▲ 改写：新增 skins 引擎 + 轨道拆分 + 皮肤 UI
    themes.curated.js            # 不变：现有 15 token 主题族
    skin-engine.js               # ▲ 新增：bundle 加载/应用/互斥/卸载核心（无 React 依赖）
    skin-a11y.js                 # ▲ 新增：可访问性修正层（每皮肤 override 规则 + 应用）
  skins/                         # ▲ 新增：九款皮肤资产（逐个复刻自上游）
    manifest.json                # ▲ 皮肤注册表（id->meta/bodyAttr/author/order/a11y）,由 skin.json 派生
    qq98/client.js  qq98/skin.json  qq98/a11y.css  qq98/LICENSE
    ths/...
    xp/...
    blue-fantasy/...  dragon-heir/...  minecraft/...  whale-song/...  trading/...  miku/...
    NOTICE.md                    # ▲ 逐皮肤作者 + 上游仓库 + BSD-3 汇总
  build.mjs                      # ▲ 改写：把 skin-engine/a11y/skins 资产线进 client bundle，生成 lib/
  lib/                           # build 产物（不变路径，随 build 重建）
  package.json                   # ▲ 增加 files: skins（若发布）；不变依赖
  LICENSE                        # 保持 MIT（自身胶水）；皮肤部分另以 NOTICE/各 skin LICENSE 呈 BSD-3
  README.md / README.zh-CN.md    # ▲ 增致谢章节
  CHANGELOG.md
```

> 原则：`skins/` 里的 bundle 是**只读资产副本**，构建脚本只搬运、不重写；可访问性修正独立在 `a11y/*.css`，绝不 merge 进上游 bundle 文本。

---

## 3. Bundle 加载 / 应用 / 互斥 / 卸载（核心引擎）

### 3.1 加载：走宿主真实模块系统，不用 eval
上游 skin bundle 的形态是 `window.__ModuleLoader__.load({ id, factory })`。theme-gallery 复刻皮肤时有两类可行来源（**实现选 B**）：

- A. **静态内嵌**：把 9 个 bundle 文本直接拼进 theme-gallery 自己的 `lib/client.js`（build.mjs 搬运），运行时 `window.__ModuleLoader__.load(...)` 注册后取 `id` 再 `ctx.theme`/手动调 `apply`。
- B. **按需注入**：build.mjs 把 9 个 bundle 作为独立 `lib/skins/<id>/client.js` 输出（或经同源 URL 片段内联），运行时用 `<script>`/`import` 动态执行，注册后按 id 调用其 `apply`。**选 B**：避免单条 bundle 体积膨胀到一两 MB 也避免全部一次解析，且与 skin-center 的 `/api/skin-center/bundle/<id>` 模式一致，但**不依赖 Host 路由**——theme-gallery 是纯 Client 插件，不能假设 Host 有 webServer。

**实现要点（B）**：
- build.mjs 把 `skins/*/client.js` 各自包装为可注入脚本，并生成 `skins/manifest.json` 的 JS 版导出（id↔文件名↔a11y 文件↔bodyAttr）。
- 运行时引擎 `loadSkin(id)`：确保该 id 只注册一次；用 `script.src = URL 或 Blob/data:` 注入，等 `window.__ModuleLoader__` 里出现该 id 后，取出 `apply` 入口。失败 Promise reject，不吞。
- **不修改上游 bundle**：`apply` 签名保持原样，直接调用 `skinApply(miniCtx)`，其中 `miniCtx` 提供 `ctx.effect(fn)` 最小实现，让皮肤的 disposer 机制原样工作（见 3.4）。

### 3.2 应用：忠实执行 SKIN 的 apply
调用 `apply(miniCtx)`，其内部会：
- `document.body.dataset.dshXxx = ""`（Xxx 由 skin 决定，如 `data-dsh-retro`）；
- 注入 `body[data-dsh-*]` 选择器的 `<style>`；
- 追加 chrome DOM（标题/状态栏）、favicon、canvas 背景（视皮肤）；
- 通过 `miniCtx.effect` 注册卸载回调。

theme-gallery **不改写**这些逻辑，只保证 miniCtx 正确转交生命周期。

### 3.3 互斥：切换前完整回收上一个
- 维护 `activeSkinId` 与当前皮肤的全部副作用句柄（[移除函数, style 元素引用, chrome DOM 引用, body 属性名]）。
- `activate(skinId)` 顺序：
  1. `deactivate()` 上一个（见 3.4）；
  2. 清除自身主题轨道 override（若主题轨道曾激活）；
  3. `loadSkin` → `apply` → 记录副作用 → 追加 a11y 修正（见 §4）；
  4. 持久化选择到 `localStorage`（会话级，键 `theme-gallery-skin-v1`）。
- UI 上皮肤轨道与主题轨道同一时刻最多一个激活。

### 3.4 卸载：双保险
- **皮肤自带 disposer**：`ctx.effect` 注册的清理会在皮肤"停止"时执行——theme-gallery 通过外包的卸载函数在切换/插件停止时调用它。
- **引擎兜底**：即使皮肤 disposer 未把 body 属性等清干净，引擎记录一次性的"还原快照"（切换前的 body `dataset` diff、注入 style 的引用、`data-skin-chrome` 子节点引用），卸载时逐项还原。
- **插件停止**：`apply` 顶层 `ctx.effect(() => () => { deactivate(); /* 清仍存活的 style/chrome */ }, "theme-gallery: skins teardown")`，保证 stop/update 时零残留。

> 与 skin-center try-on 的区别：skin-center 无法卸载"active skin 自己的 fiber"，只能 recipe 回收；theme-gallery **自己就是皮肤的唯一 owner**，activeS皮肤由本引擎创建的 miniCtx 持有，因此可以**彻底卸载**，这是本方案优于借用 skin-center 的地方。

### 3.5 miniCtx 最小实现
皮肤 bundle 里实际只消费 `ctx.effect`（探查 qq98/dragon-heir/minecraft 均如此）。miniCtx 只需：
```js
function miniCtx() {
  const disposers = new Set();
  return {
    effect(fn /* (dispose)=>void */, label) {
      if (typeof fn === 'function') { const d = fn(() => {}); if (typeof d === 'function') disposers.add(d); }
    },
    get(name) { return undefined; },           // 皮肤不依赖外部 service（仅 theme/slots 才用，皮肤不用）
    _dispose_all() { for (const d of disposers) try { d() } catch {} disposers.clear(); },
  };
}
```
> 若某皮肤未来依赖 `theme`/`slots`/`webServer`（当前 9 款均不依赖，已验证），此段需补注入；作为扩展点标注在代码注释与 INTERFACE。

---

## 4. 可访问性修正层（skin-a11y.js）

### 4.1 目标与策略
只修正"不可读"，不改坏皮肤观感。策略 = **增量 override CSS**，在皮肤注入的 `<style>` **之后**追加一块 `body[data-dsh-<id>]`（及 `[data-ds-dark-theme]`）作用域的覆盖规则，**对比度达标优先**。每款皮肤一份 `a11y.css`（亮/暗两段），由 `skin-a11y.js` 在 `apply` 后追加注入，并随皮肤卸载一并移除。

### 4.2 已确认待修正的三类问题（对每款逐一过）
1. **消息气泡**：覆盖 `--dsw-specific-bubble / --dsw-specific-bubble-highlight` 及其前景 `--dsw-alias-label-primary(-foreground)`。典型：qq98 高亮气泡 `#b6d6f4` 底配白字——修正为高对比前景或加深底色；miku/whale-song 半透明气泡底叠背景。
2. **代码块**：覆盖 `--dsw-alias-markdown-code-block / -banner / -inline-code / -segment-*` 与行内/块内文字，保证块背景 vs 前景对比、代码与正文可区分。minecraft（深色块 `#1e2620` 上高亮）、ths/trading（数据终端感浅灰底）重点。
3. **字体/正文颜色**：覆盖 `--dsw-alias-label-primary/secondary/tertiary/foreground`、`font-family`/`font-size` 被皮肤改后与背景的对比；尤其**半透明面板**（`*57`/`*61`/`*6b` 类 alpha）在背景画上对比漂移——给足前景不透明度、必要时加深或加 scrim。

### 4.3 达标口径
- 每款亮/暗两态下，正文/气泡/代码块的 WCAG 对比度目标 **AA ≥ 4.5:1**（大字 3:1）；修正层实现时用脚本校验（见 §6 验证）。
- 不覆盖皮肤已达标的项；a11y rules 只声明"若当前计算对比 < 阈值则替换"，实现上写成带 `!important` 的确定性覆盖并附注释说明改了什么。

### 4.4 与皮肤加载的关系
顺序固定：`apply(skin)` → **皮肤内置 CSS 已注入** → `injectA11y(skin)` 追加修正在后 → 同优先级后定义者胜（`!important` 保险）。卸载皮肤时 `injectA11y` 返回的 style 一并移除。

---

## 5. 为什么不做 Host 持久皮肤开关（设计取舍）

skin-center 已提供权威的永久启停（改 `~/.dsh/cordis.patch.yml` + symlink + config watcher）。theme-gallery 若自己再写一套同样的 Host 层：
- 与 skin-center **竞争同一 `managed` 段**，会互相覆盖、坏配置；
- 需要 `webServer` 依赖与文件写权限，范围膨胀。

故 theme-gallery 采用**进程内会话皮肤**（refresh 回默认），把"永久启用"留给官方 skin-center，二者并存不互踩。这是文档明确写出的边界，避免实现时误引入对 `~/.dsh/cordis.patch.yml` 的写。

---

## 6. 现有主题轨道与新皮肤轨道的关系

| | 主题轨道（现有） | 皮肤轨道（新增） |
|---|---|---|
| 机制 | `themeService.overrideTokens` | body 属性 + CSS 注入 + chrome DOM |
| 数量 | 15 主题族 | 9 款 skin |
| 持久 | `localStorage theme-gallery-family-v5` | `localStorage theme-gallery-skin-v1` |
| 卸载 | `removeOverride` | miniCtx disposer + 快照兜底 |
| UI | 现有"精选主题"卡组 | 新增"皮肤"卡组 |

- 两轨**互斥**：UI 用一个分段/一个 `track` 状态，展示"皮肤"项时数据来自 `skins/manifest`；激活皮肤套件时会先清掉主题轨道 override，反之亦然。
- 不共用选辑：同一时刻只有一个 `track='theme'|'skin'` 的激活。restore 时读取对应 localStorage 键，冲突时主题优先（向后兼容已有用户）。

---

## 7. README / 致谢 / 许可证

### 7.1 包内文件
- 新增 `skins/NOTICE.md`：逐皮肤列出 **author（skin.json 为准）→ 上游备份 id → 上游仓库 `github.com/zhu1090093659/dsh-web-ui`**，并附聚合包版权 `Copyright (c) 2026, zhu1090093659`。
- 每款皮肤目录内 `LICENSE`：BSD-3-Clause 全文（含版权行）。
- 包根 `LICENSE`：保持 MIT 仅覆盖自身主题/引擎胶水代码；**并明确写一句**"含 BSD-3 皮肤资产，详见 skins/NOTICE.md"。
- `package.json` 增加 `"files": ["lib","src","skins",...]`（若改为发布），防止漏发皮肤资产。

### 7.2 README 致谢章节（中英两份）
新增"Attribution / 致谢"节，内容：
1. 上游 dsh-web-ui / `@linxin666/dsh-skins`，作者 zhu1090093659，仓库链接，BSD-3。
2. 九款皮肤逐项 author 表（同 BRIEF §2.3，含 powerdog996、涂山苏苏 的署名来源说明）。
3. BSD-3 三段条款全文或明确指向 `skins/NOTICE.md`。

---

## 8. 实施步骤（开发代理落地顺序）

1. 资产搬运脚本/步骤：把 9 套 `skins/<id>/{client.js, skin.json}` 只读复制进 `packages/theme-gallery/skins/`，保留原字节；补 `a11y/*.css`（空壳待填）与 `NOTICE.md`。
2. `skin-engine.js`：miniCtx + load/apply/deactivate/teardown + 快照兜底。
3. `skin-a11y.js`：a11y rules 装载与注入、达标校验钩子。
4. `build.mjs` 扩展：汇入 `skins/manifest`、搬运 bundle、织入 engine/a11y 到 `lib/client.js`；保持 `--check` 校验。
5. `src/client.js` 改写：轨道拆分 + 皮肤 UI 卡组 + 分段切换 + localStorage。
6. `README`/`README.zh-CN`/`CHANGELOG` 更新 + 许可证文件。
7. 逐皮肤填 `a11y.css`（按 §6 验证）。
8. 跑 `pnpm -C packages/theme-gallery build && check`。
9. 手动验证（见 6/6.2）。

---

## 9. 风险与对策

| 风险 | 对策 |
|---|---|
| 皮肤 bundle 体积大（blue-fantasy/whale-song/miku 含内嵌 art base64） | 按需注入、不内联进主 client；首屏只 load 用户当前选的皮肤 |
| `ctx.effect` 语义被 miniCtx 简化导致皮肤卸载不干净 | 快照兜底 + 插件 stop teardown 双保险；逐皮肤验证卸载前后 `body` / `document.head` 无残留 |
| 皮肤间 body 属性残留冲突 | 引擎统一管理 `activeSkinId`，切换前完整 deactivate |
| 与皮肤中心（skin-center）打架 | 不做 Host 永久开关，进程内会话；文档明确冲突边界 |
| 修正层破坏皮肤观感 | a11y 只覆盖对比不达标项、注注释、可一键回退（切主题轨道即移除 skin） |
| 上游 bundle 未来变化 | skins/ 为复制快照，升级时重新搬运 + 重跑对比验证 |

---

## 10. 交付物核对（对照 BRIEF 验收口径）
- [ ] 9 款皮肤资产齐全且字节完整
- [ ] 皮肤引擎 load/apply/mutex/unload 可用
- [ ] 可访问性修正层覆盖气泡/代码块/字体（九款 × 亮暗，AA 达标）
- [ ] 主题轨道与皮肤轨道互斥共存，主题 15 族回归不坏
- [ ] README+NOTICE+LICENSE 致谢完整（BSD-3 + 三来源作者）
- [ ] `build/check` 通过
