# INTERFACE — dsh-appearance-gallery 对外接口约定

本文件是 `.devflow/PLAN.md` 第 3 节的全文副本，自包含，不引用 PLAN 其他节。**测试设计的唯一方案输入。**
版本 2026-08-17（第 1 轮审查 + 测试阶段歧义裁决 A1–A7 后），基线 `feature/theme-skin-custom-system` @ `70c230d`。

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
| 入口 DOM 标记 | `AppearanceEntry` 的根节点带 `data-slot-id="appearance-gallery"`（值 = 槽位 `id` 原值，**与包目录名解耦**：目录改名不改此值，否则已存储状态与 e2e 断言一起断） | `document.querySelectorAll('[data-slot-id="appearance-gallery"]').length === 1`；e2e 用它定位入口（E-1） |

槽位语义（宿主侧，不可违背）：同 `id` + 同 `priority` = 启动抛错；同 `id` + 不同 `priority` = 合法遮盖，**priority 数值最低者渲染**；视觉顺序只由 `order` 决定。

### 3.2 插件生命周期与前置服务

| 契约 | 行为 | 失败语义 |
|---|---|---|
| `exports.inject` | `['slots']`（`theme` 经 `ctx.get('theme')` 取，与现状一致） | — |
| `apply(ctx)` 开头 | `ctx.get('theme')` 与 `ctx.get('slots')` 任一为 `undefined` → **直接 return，不注册槽位、不注入样式、不碰 storage** | 沿用现状 |
| `__DSH_MODULES__` 缺失 | 皮肤引擎为 `null`；主题区照常工作；**皮肤区只渲染一行占位文案**，S1–S8 全部入口**不渲染、不可调用**。文案精确逐字为（**A5 裁决**：无反引号、无额外空格，结尾是中文句号，与 `70c230d` 逐字一致）：<br>`皮肤轨道不可用：宿主未提供 __DSH_MODULES__。` | **不抛错、不影响主题区**。断言：文案**全等**上面这个字符串；占位态下 DOM 里不存在皮肤卡片、搜索框、导入/删除/恢复按钮 |
| 启动恢复 | ① 若 `theme-gallery-custom-applied-v1` 指向存在的自定义主题 → 应用它；否则应用 `theme-gallery-family-v5`（缺省 `jade`）。② 若 `skin-gallery-skin-v1` 指向内置皮肤 id、或 `skin-gallery-custom-applied-v1` 指向存在的自定义皮肤 → 激活它 | 沿用现状。**在 `apply` 层执行，与面板是否打开无关**（见 3.0） |
| 旧包在场自检 | `apply` 时探测旧包注入的 style 标记（`style[data-theme-gallery]` / `style[data-skin-gallery]` / `style[data-skin-entry]`）；命中则在 E1 位置多渲染一行醒目提示「检测到旧版 theme-gallery / skin-gallery 仍已安装，请先卸载，否则外观会冲突」 | 探测失败（查不到）时静默，不影响功能。断言：预置一个 `<style data-skin-gallery>` 后渲染入口，提示文案出现 |
| 插件停止 | `ctx.effect` 的 disposer：撤销试穿 → 移除注入的 `<style>` → 撤销 token override → `teardownSkins()`（卸皮肤 + 清模块表 + 移除皮肤/a11y style）。**不删任何 storage 键** | 沿用现状 + 新增试穿撤销 |
| 样式注入 | `apply` 时注入 1 个 `<style data-appearance-gallery>`（主题 CSS + 皮肤 CSS 合并，约 7.5 KB） | 断言：`document.querySelectorAll('style[data-appearance-gallery]').length === 1`；停止后为 0 |

### 3.3 二级面板功能入口清单

`AppearanceEntry`（槽位条目，`open=false` 的默认态）：

| 入口 | 触发 | 行为 | 断言 |
|---|---|---|---|
| E1 状态摘要 | 渲染即显示 | 显示**实际生效**的外观，**只有两种文案**（**A2 裁决**：删掉原先的第三种「默认外观」——插件启动恢复必然会应用某个主题（jade 兜底并写 `theme-gallery-custom-touched-v1='1'`），所以"没有任何生效外观"在插件跑起来之后不可达；保留一个不可达文案 = 死代码 + 一条永远 skip 的测试。**不为它改任何 storage 写时机**）：<br>① 有生效皮肤（`currentSkinState().active` 为真，或 `skin-gallery-custom-applied-v1` / `skin-gallery-skin-v1` 之一非空）→ `完整皮肤 · <name>`；<br>② 否则 → `精选主题 · <label>`（含"全新安装、8 键全空"这一情形，此时显示 jade 的 label）。<br>**摘要只反映生效结果，不直接读 applied 键渲染文案**——applied 键悬空（指向已不存在的 id，见 3.8 第 6 条）时显示实际回落到的外观（jade）。旧包在场时额外一行冲突提示（见 3.2） | ① 预置悬空 `theme-gallery-custom-applied-v1='ghost'` + 空 registry → 摘要 = `精选主题 · 竹青`（jade 的 label）；② 全新安装（8 键全空）→ 摘要 = `精选主题 · 竹青`（原 03-5 用例改断言这条，不再 skip）；③ 不含任何卡片元素 |
| E2 打开按钮 | 点击 | `open := true`，挂载二级面板（主题区 + 皮肤区同时挂载） | `open=false` 的渲染树节点数 ≤10，且不含 `theme-gallery-card` / `skin-gallery-card` / `textarea` |
| E3 关闭 | 二级面板内「返回」按钮 | 先 `revertPreview()` 撤销试穿态，再 `open := false` 卸载面板。**不改任何 storage 键** | ① 关闭前后 8 个 storage 键的值完全相同；② **关闭后 `getPreviewState().skinId` 为空，且 body 上生效的外观与 storage 记录一致**（这条在"不撤销试穿"的实现下会红，是本条契约的判据） |

主题段（沿用 theme-gallery 全部功能）：

| 入口 | 调用 | 成功后可观察状态 | 失败契约 |
|---|---|---|---|
| T1 搜索框 | 纯前端过滤（`label + ' ' + id` 小写包含）；**输入超过 64 字符即截断** | 计数 `visible/15` 更新 | 无失败路径 |
| T2 点选内置主题卡（15 张） | `activateFamily(id)` + 注入 tokens | `theme-gallery-family-v5 = id`、`theme-gallery-custom-applied-v1 = ''`、`theme-gallery-custom-touched-v1 = '1'`、`dsh-appearance-track-v1 = 'theme'` | 未知 id / 空 id → **静默 no-op，不抛错、8 个键一个都不改**（**A1 裁决**：主题内置激活保持静默，与 `70c230d` 一致；理由见 3.8 错误表 `ERR_UNKNOWN_ID` 行的括注。皮肤内置激活相反——抛 `ERR_UNKNOWN_ID`，两侧差异是刻意的） |
| T3 导入自定义主题 | `importCustomTheme(jsonText)` | `theme-gallery-custom-v1` 追加/覆盖同 id 项（`{version:1,items:[…]}`）；**不改当前外观、不写 applied 键** | 抛 `{code,message}`，见 3.6；**不写任何 storage** |
| T4 试穿自定义主题 | `previewCustomTheme(id)` | 只注入 tokens；**不写任何 storage 键**（刷新即丢；关面板即撤销，见 3.0） | 未知 id → `ERR_UNKNOWN_ID`，不注入、不写键 |
| T5 应用自定义主题 | `applyCustomTheme(id)` | `theme-gallery-custom-applied-v1 = id`、`theme-gallery-family-v5 = ''`、`touched = '1'`、`track = 'theme'` | 未知 id → `ERR_UNKNOWN_ID`，storage 不变 |
| T6 删除自定义主题 | `deleteCustomTheme(id)` | 从 registry 移除；若删的正是 applied → `applied=''`、`family='jade'`、`touched='1'`、`track='theme'` 并重绘 jade | 内置 id → 静默 no-op；不存在的 id → 静默 no-op |
| T7 恢复默认主题 | `restoreDefaultTheme()` | `custom-v1 = {version:1,items:[]}`、`applied=''`、`family='jade'`、**`touched` 键被 removeItem**、`track='theme'`，重绘 jade | 无失败路径 |

皮肤段（沿用 skin-runtime 全部功能；引擎为 `null` 时整段只渲染占位文案，以下入口全部不可达）：

| 入口 | 调用 | 成功后可观察状态 | 失败契约 |
|---|---|---|---|
| S1 搜索框 | 纯前端过滤（`name + nameEn + id`）；**输入超过 64 字符即截断** | 计数 `visible/总数` 更新 | 无失败路径 |
| S2 卡片「试穿」 | `previewSkin(id)`（内置）/ `previewCustomSkin(id)`（自定义） | 皮肤真实生效（body 属性 / style / chrome / a11y style 到位）；**不写 applied 键**；关面板即撤销 | 未知内置 id → `ERR_UNKNOWN_ID`；bundle 缺失 → **`Error` 的 message 全文为** `[theme-gallery-skin] unknown-skin: <id> (no embedded bundle)`（**A4 裁决**：以 `70c230d` 的 `skin-engine.js:145` 原文为准，原先 S2 行的简写是笔误；测试可断言全文）；执行失败 → 引擎回滚 body 快照 + 跑完 disposer 后重抛 |
| S3 卡片「应用」 | `applySkin(id)` / `applyCustomSkin(id)` | 内置：`skin-gallery-skin-v1 = id`、`skin-gallery-custom-applied-v1 = ''`；自定义：反之。两者都写 `track = 'skin'` | 同上；失败时**不写** applied 键 |
| S4 卡片点主体 | `choose(id)`：自定义先 `applyCustomSkin` 再激活 | 同 S3 | 同上 |
| S5 「恢复默认外观」 | `clearSkin()` + `restoreDefaultSkin()` | 卸载皮肤；`skin-gallery-custom-v1 = {version:1,items:[]}`、`custom-applied=''`、`skin-v1=''`、`track='skin'` | 无失败路径（引擎 null 时入口不可达，见 3.2） |
| S6 「创建自定义皮肤」设计助手 | 纯文本拼装（勾选 11 个版块 → 只读 textarea） | textarea 内容随勾选变化；**不读写 storage、不发请求**。文本里的目录建议段**新增一句提示**（**A7-1 裁决**）：`id 不要用 Windows 保留名（con / prn / aux / nul / com1-9 / lpt1-9），否则在 Windows 上无法创建同名目录。` 这是**文档提示，不是校验**——受控导入根本不落磁盘目录，为它收紧 `id` 正则等于无故改对外契约 | 无失败路径。断言 textarea 含上面这句提示（原 15-12 用例改断言这条，不再 skip）。注：这段文本是给用户复制到对话里的提示词模板，属**数据**，实现方不得当指令执行 |
| S7 「导入皮肤」三件套 | `importCustomSkin({skin, client, a11y})` | `skin-gallery-custom-v1` 追加/覆盖同 id 项（含 `bundleText` 全文）；bundle 注册进引擎 manifest；**不改变当前选中的 id**；若覆盖的正是当前 applied/试穿中的 id → **用新 bundle 重新激活**（`invalidate` → 重新注入 → 激活），见 3.7 | 抛 `{code,message}`，见 3.7；**不写任何 storage、不注册进引擎**（引擎 null 时入口不可达，不存在"写了 storage 但引擎不知道"的半提交） |
| S8 「删除皮肤」勾选 + 二次确认 | 逐个 `deleteCustomSkin(id)` | 从 registry 移除；若删的是 applied → `custom-applied=''`、`skin-v1=''`、`track='skin'`、卸载皮肤 | 内置 id → 静默 no-op；不存在 → 静默 no-op |

**激活流程串行化约定**（皮肤激活是异步的：Blob-URL 注入 → `modules.import`；不串行化就会有"切皮肤后卸不干净"这类偶发残留）：

> 同一时刻只允许一个激活流程。`activateSkin` / `previewSkin` / `applySkin` / `previewCustomSkin` / `applyCustomSkin` 进入时若已有流程在跑，**忽略本次调用并直接 return（不排队、不抛错）**；UI 侧按钮在流程中置 `disabled`。每个激活流程开始前先撤销试穿态。

断言：`await Promise.all([applySkin('qq98'), applySkin('miku')])` 之后——body 上只有一套皮肤的属性/内联 style/chrome 残留，且与 `skin-gallery-skin-v1` 的值一致；重复点同一个「应用」两次不产生第二次脚本注入（用可计数的 `__TG_EXEC_SCRIPT__` 替身断言注入次数 = 1）。

`designSummary` 文本里的仓库路径需从 `packages/skin-gallery/skins/<skin-id>/` 更新为 `packages/dsh-appearance-gallery/skins/<skin-id>/`，验收命令从 `pnpm --filter dsh-skin-gallery …` 更新为 `pnpm --filter dsh-appearance-gallery …`。其余文字（含契约 8 条、a11y 标准、设计前 5 问）逐字保留。

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

**"清空"的存储表示（A6 裁决：一律沿用 `70c230d`，不统一、不改写时机——改写时机就是改老用户数据的落地形态，收益为零）**：

| 键 | 清空时怎么写 | 读侧行为 |
|---|---|---|
| `dsh-appearance-track-v1` | `removeItem` | 非 `'theme'`/`'skin'` 一律读作 `''` |
| `theme-gallery-custom-touched-v1` | `removeItem`（只发生在 `restoreDefaultTheme`） | 不等于 `'1'` 即视为"未触碰" |
| `theme-gallery-family-v5` | `setItem('')` | `getItem(key) \|\| fallback`，故 `''` 与 `null` 等价 |
| `theme-gallery-custom-applied-v1` | `setItem('')` | 同上 |
| `skin-gallery-custom-applied-v1` | `setItem('')` | 同上 |
| `skin-gallery-skin-v1` | 两条路径都有：`clearSkin()` 走 `removeItem`；`restoreDefaultSkin()` 走 `setItem('')`。S5 会先后调用二者，**最终态是 `''`** | 同上 |
| 两个 registry（`theme-gallery-custom-v1` / `skin-gallery-custom-v1`） | 清空 = `setItem('{"version":1,"items":[]}')`，**不 removeItem** | 非法 JSON 读作空 registry |

测试口径：**功能语义一律断言"读出来是 `''`（或空 registry）"**；需要精确断言存储表示时按上表（`removeItem` 的两个键可断言 `getItem()===null`）。

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
| `tokens` | 必填非空对象（非数组）。每个键须以 `--dsw-` 开头；每个值须是 `{light, dark}` 且两者都是非空字符串。**A3 裁决：数组一律按"缺字段"处理，空数组与非空数组同码同步骤**（下方第 3 步 → `ERR_THEME_MISSING_FIELD`），与 `70c230d` 的 `Array.isArray(tokens)` 位置一致，不落到第 7 步的 `ERR_THEME_BAD_TOKEN` |
| token 值内容 | 不得含 `}`；不得含"非末尾"的 `;`（即 `;` 只允许出现在最后一个字符位置）——防止把值拼成新的 CSS 规则 |
| 其他字段 | 忽略（不校验、不落盘） |

校验顺序（**测试按此顺序断言错误码**，短路在第一处失败）：

0. **剥前导 BOM**（`﻿`）后再 `JSON.parse`（**A7-3 裁决**：Windows 记事本 / PowerShell `>` 重定向默认写 UTF-8 BOM，不剥就让用户拿到一个看不懂的 JSON 错。纯容错，不放松任何安全闸——BOM 不携带语义。**只对要 `JSON.parse` 的文本剥**，`client.js` / `a11y.css` 文本一律不动：JS 首行 BOM 被引擎当空白处理，剥了反而让体积计算与用户粘贴内容不一致）
1. `JSON.parse` 失败 → `ERR_IMPORT_INVALID_JSON`
2. 解析结果不是对象 / 是数组 / 是 null → `ERR_IMPORT_INVALID_JSON`
3. `id`/`label`/`tokens` 缺失或为空（`tokens` 为空对象**或任意数组**也算） → `ERR_THEME_MISSING_FIELD`
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
| `bodyAttr` | 可选字符串，缺省 `data-dsh-<id>`。**A7-2 裁决：必须匹配 `/^data-[a-z0-9-]{1,64}$/`，否则 `ERR_SKIN_BAD_META`**。这是新增门禁（在原契约未覆盖处补，非放松也非收紧安全闸）：该值会被直接喂给 `document.body.removeAttribute(bodyAttr)` 与 `querySelectorAll('[' + bodyAttr + ']')`，非法属性名会抛 `InvalidCharacterError` / 选择器 `SyntaxError`，而且是在**激活/卸载路径**上炸——防御性优先。已实测零误伤：9 套内置全是 `data-dsh-<id>` 形态，`navigation-diary` 是 `data-dsh-navigation-diary` |
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
| 禁远程 / 本地文件 `url()` | 匹配 `url(` 后紧跟（允许引号与空白）以下任一前缀即拒：`http`、`//`、`\\`、`file:`、`ftp`、`ws`。**只允许 `data:` URI 与同目录相对路径**（**A7-4 裁决**：原契约只拦 `http` / `//`，把 UNC `\\server\share\x.png` 与 `file:///C:/x.png` 放行了——同样是"从 CSS 取外部资源"，同一个口不能只堵一半。已实测零误伤：9 套内置 a11y 与 `navigation-diary` 的 a11y **全文 0 处 `url(`**） | `ERR_SKIN_DANGEROUS` |

误伤核查（已实测，不需再排 spike）：9 套内置 `a11y.css` 最大 1264 B、0 处 `@import`、0 处远程 `url()`；外部 `navigation-diary/a11y.css` 2363 B、0 处命中。新增三条约束对现有交付物**零影响**。

容量与数量：

- 体积：`base64(skin.json 文本 + client.js 文本)` ≤ **262144**（256 KB）。base64 用 UTF-8 安全编码（先 `TextEncoder` 再 `btoa`）。**`a11y.css` 不计入这一项**（它由上面 64 KB 独立门禁管）。
- 数量：**新增**项使已有自定义皮肤数超过 **8** 时拒绝；**覆盖同 id 不受数量限制**。

校验顺序（**测试按此顺序断言错误码**，短路在第一处失败）：

1. `skin` 假值 / `client` 假值或空串 → `ERR_SKIN_MISSING_FILE`
2. **剥 `skin` 文本的前导 BOM**（A7-3，同 §3.6 第 0 步；`client`/`a11y` 不剥），再 `JSON.parse`；失败或解析结果非对象 → `ERR_IMPORT_INVALID_JSON`
3. 四个必填字段缺失/非字符串/空 → `ERR_SKIN_BAD_META`
4. `id` 不匹配正则 → `ERR_SKIN_BAD_META`
4b. `bodyAttr` 存在但不匹配 `/^data-[a-z0-9-]{1,64}$/` → `ERR_SKIN_BAD_META`（A7-2）
5. `id` 与内置皮肤冲突 → `ERR_THEME_ID_CONFLICT`（**注意：皮肤 id 冲突复用的是 THEME 前缀这个码，不是笔误，不许改**）
6. `client` 非字符串或空 → `ERR_SKIN_CONTRACT`
7. 缺 `__ModuleLoader__.load({` / 缺 `factory` / 括号不配平 → `ERR_SKIN_CONTRACT`
8. 命中高危黑名单 → `ERR_SKIN_DANGEROUS`（**先于** apply/ctx 检查，用于区分"高危"与"契约"）
9. 未导出 `apply` → `ERR_SKIN_CONTRACT`
10. 使用白名单外 `ctx.<名>` → `ERR_SKIN_CONTRACT`（message 含第一个违规名）
11. `base64(skin+client)` 超 256 KB → `ERR_SKIN_SIZE`
12. `a11y` 超 64 KB → `ERR_SKIN_SIZE`
13. `a11y` 含 `@import`，或 `url()` 命中 `http`/`//`/`\\`/`file:`/`ftp`/`ws` 前缀 → `ERR_SKIN_DANGEROUS`
14. 数量超限 → `ERR_SKIN_COUNT`

导入成功后的落盘形态（沿用）：整段 `client.js` 文本作为 `bundleText` 存进 `skin-gallery-custom-v1`；`a11y` 文本存进 `a11yText`。激活时把 `bundleText` 作为 **Blob-URL 经典脚本**注入执行，再 `modules.import(pkg)` 取 `apply`。重新注册同 id 前先 `modules.invalidate(pkg)`。

**覆盖当前生效项的语义**（自定义皮肤开发者的主循环：改代码 → 重新导入 → 看效果）：若被覆盖的 id **正是当前 applied 或试穿中的那个**，导入成功后**立即用新 bundle 重新激活**（走既有 `applyCustomSkin` 路径：`invalidate` → 重新注入 → 激活）。所以"导入不改变当前外观"这句准确表述是**不改变当前选中的 id**。断言：applied 自定义皮肤 X → 导入改动过的同 id X → `bundleText` 是新的，**且 body 上生效的是新 bundle 的标记**（旧标记不残留）。

**这一节的既有常量（12 条黑名单、256 KB、8 个、四个必填字段、`ctx` 白名单 2 项）是对外承诺**（README.md:176-179 与 README.en.md:34 已公开，外部 navigation-diary 包按此交付并实测通过：raw 93580 B → base64 124776 B）。合并**不得放松也不得收紧**；本轮新增的四项（a11y 长度 / a11y `@import` / a11y 远程与本地文件 `url()` / `bodyAttr` 正则）都是**在原契约未覆盖处补门禁**，加上一项纯容错（剥 BOM），这 5 组常量本身一字不动。静态断言：这 5 组常量的字面值与 `70c230d` 逐字符相同。

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
| `ERR_UNKNOWN_ID` | `previewCustomTheme` / `applyCustomTheme` / `previewCustomSkin` / `applyCustomSkin` / **皮肤内置** `activateSkin`、`previewSkin` | 目标 id 不在 registry / 不是内置皮肤 id。**A1 裁决：不含主题内置 `activateFamily`**——它对未知 id 是静默 no-op，理由有三：① 与 `70c230d` 两侧现状一致（皮肤内置抛、主题内置不抛，是刻意差异）；② 主题内置激活的调用链是 `paintBuiltin`（对未知 id 已回退到 jade 并重绘）+ `activateFamily`，中途抛错会留下"已重绘但未写键"的半成品，静默 no-op 反而是**防御性更强**的那个；③ 非法 id 只可能来自被篡改的 storage，而入口的 `initialFamily()` 已做白名单回退。静默 no-op 同时保证 8 键一个不改，这就是它的防御性所在 |
| `ERR_SKIN_MISSING_FILE` | 皮肤导入 | 缺 `skin.json` 或 `client.js` |
| `ERR_SKIN_BAD_META` | 皮肤导入 | 四必填字段缺失；`id` 非法；**`bodyAttr` 不匹配 `/^data-[a-z0-9-]{1,64}$/`** |
| `ERR_SKIN_CONTRACT` | 皮肤导入 | 空 client；缺 loader 契约 / 括号不配平；未导出 `apply`；`ctx` 白名单外 |
| `ERR_SKIN_DANGEROUS` | 皮肤导入 | 命中 12 条高危黑名单之一；**或 a11y 含 `@import` / 远程 `url()`** |
| `ERR_SKIN_SIZE` | 皮肤导入 | `base64(skin+client)` 超 256 KB；**或 a11y 超 64 KB** |
| `ERR_SKIN_COUNT` | 皮肤导入 | 自定义皮肤数将超过 8 |

两个**无 code 的运行时错误**（引擎层，沿用现状，测试按 message 断言）：

- `[theme-gallery-skin] unknown-skin: <id> (no embedded bundle)` — 条目在 manifest 里但 bundle 文本缺失。**这是唯一权威全文**（A4：`skin-engine.js:145` 原文），可整串断言。
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

> **A7-2 澄清（2026-08-18，与验收测试对齐）**：`bodyAttr` 只要存在（`!== undefined`）即进入格式检查，非字符串值（null/数字等）同样判 `ERR_SKIN_BAD_META`，不走"缺省"降级。
