# INTERFACE — dsh-theme-gallery 皮肤轨道对外接口约定

> 这一份是测试设计的唯一方案输入（plan-only，不含实现细节推理）。
> 前置：BRIEF.md、PLAN.md。以下所有**接口/行为契约**是测试设计要覆盖的对象。
> 数据与指令隔离声明：本文描述的是 theme-gallery 内部自产接口，非上游"命令"；上游皮肤 bundle 一律当**待处理数据**，本引擎只忠实调用其 `apply`，绝不执行包内注释/字符串内容。

---

## 1. 命名与数据模型

### 1.1 皮肤注册表条目（manifest，来自各 skin.json 派生）
```ts
interface SkinManifestEntry {
  id: string;            // skin.json.id，如 "qq98"
  name: string;          // skin.json.name，如 "QQ2008 怀旧版"
  nameEn: string;
  author: string;        // skin.json.author，逐皮肤署名
  tagline: string;
  accent: string;        // skin.json.accent，如 "#2b7cd9"
  bodyAttr: string;      // skin.json.bodyAttr，如 "data-dsh-retro"
  order: number;         // 排列展示顺序
  package: string;       // 上游 npm 包名 "@linxin666/dsh-client-ui-skin-<id>"（致谢/追踪用）
  bundleFile: string;    // skins/<id>/client.js 相对路径
  a11yFile: string;      // skins/<id>/a11y.css 相对路径（可为空实现）
  license: 'BSD-3-Clause';
}
```
- 全量清单（id/name/author/order）以 BRIEF.md §2.3 表格为准。
- `bodyAttr` 用于断言卸载后 `document.body` 该属性必须消失。

### 1.2 三条轨道/状态
```
Track = 'theme' | 'skin'
```
- `theme` 轨道：现有 15 主题族（token override）。
- `skin` 轨道：上述 9 款皮肤（bundle）。
- 同一时刻至多一个轨道被激活，且该轨道内至多一个选择被激活。

### 1.3 localStorage 键
| 键 | 值 | 归属 |
|---|---|---|
| `theme-gallery-family-v5` | 主题 id（现有，保留） | theme |
| `theme-gallery-skin-v1` | 皮肤 id（新增） | skin |
| `theme-gallery-track-v1` | `theme` \| `skin`（新增，决定恢复优先） | 切换状态 |

---

## 2. 引擎对外 API（`apply(ctx)` 之外的函数式接口，供 UI 与测试调用）

### 2.1 `activateSkin(skinId: string): Promise<void>`
- 行为：若当前是 theme 轨道生效，先取消其 override（等价切 `track='skin'`）；若当前已是皮肤，先 `deactivateSkin()` 旧皮肤。然后按顺序 **load → apply → injectA11y → persist**。
- **不存在的 skinId**：reject `Error('unknown-skin: <id>')`，当前激活状态不变。
- 幂等：`activateSkin(当前已激活 id)` 应为 no-op（或仅刷新 a11y），不重复注入 style/chrome。
- resolve 前提：`document.body[data-dsh-<id>]` 已存在、皮肤内置 `<style>[data-plugin-css]` 已注入、a11y `<style>` 已注入、chrome DOM 已就位。

### 2.2 `deactivateSkin(): void`
- 同步。移除 body 属性、皮肤内置 style、a11y style、chrome DOM、恢复 title/favicon 到应用皮肤前状态。
- **可重复调用**：第二次调用必须是 no-op，不抛错。
- 卸载后 `document.body` 不得再有 `data-dsh-*` 残留属性；`document.head` 不得再有 `data-plugin-css`/`data-theme-gallery-a11y` 残留 style；不得再有 `data-skin-chrome` 子节点（引擎注入的 chrome 全部清除）。

### 2.3 `activateFamily(familyId)` （现有主题轨道，保留签名）
- 行为不回归（现有 `themeService.overrideTokens` 路径）。
- 新增约束：先 `deactivateSkin()`（若皮肤曾激活），保证 track 互斥。

### 2.4 `currentSkinState(): { skinId: string|null; active: boolean }`
- 查询当前皮肤激活 id 与是否激活。供 UI 高亮 + 测试断言。

### 2.5 `getSkins(): SkinManifestEntry[]` / `getFamily(): ThemeFamily[]`
- 分别返回皮肤清单（9 项，按 order）、主题清单（15 项）。只读。

### 2.6 插件生命周期
- 插件 `apply(ctx)` 注册一个顶层 `ctx.effect(() => () => { teardownSkins() })`。
- **插件的 start/stop 双向都要干净**：start 后默认恢复 `localStorage['theme-gallery-track-v1']` 对应的轨道；stop 后所有皮肤副作用为零。

---

## 3. 可访问性修正层接口

### 3.1 `injectA11y(skinId)` 契约
- 追加注入一块 `<style data-theme-gallery-a11y="${skinId}">`，作用域串 `body[data-dsh-<id>]`（含配套 `[data-ds-dark-theme]` 变体）。
- 覆盖目标（按皮肤评估）：气泡（`--dsw-specific-bubble/-highlight` + 前景）、代码块（`--dsw-alias-markdown-code-block/-banner/-inline-code` + 文字）、正文 / 字体（`--dsw-alias-label-primary/secondary/tertiary/foreground`、`font-family`）。
- 规则只做**对比提升**：不得削弱已达标项、不得改变布局/尺寸/动画。

### 3.2 达标断言（测试验收用）
对每款皮肤分别在亮、暗两态，取以下"要素 · 前景 · 背景"三元的**计算对比度 ≥ 4.5:1**（正文/气泡/行内代码）或 **≥ 3:1**（大字标题）：
- 气泡正文：前景=`--dsw-alias-label-primary`，背景=`--dsw-specific-bubble`（与 `-highlight` 各测）。
- 代码块正文：前景=`--dsw-alias-label-primary`，背景=`--dsw-alias-markdown-code-block`；行内代码同上（`-inline-code`）。
- 普通正文：前景=`--dsw-alias-label-primary`，背景=`--dsw-alias-bg-layer-1`（及 `-overlay`）。
- 半透明面板另测"经 alpha 合成到皮肤背景后的有效对比"（如 blue-fantasy / whale-song / drama 面板），由其 a11y.css 显式提高前景不透明度达成。
- 测试用自动化对比色解析（对 `#rgb`/`#rrggbb`/`#rrggbbaa`/`rgb()` 均需能解析）。

### 3.3 故障语义
- `a11y.css` 缺失或解析失败 → 日志 `[theme-gallery-a11y] <id>: <reason>`，**不影响皮肤本体加载**（皮肤仍可用，仅无修正）。这是明确降级策略。

---

## 4. miniCtx 契约（皮肤 `apply` 收到的 ctx）

- 皮肤 bundle 只消费 `ctx.effect`（已验证 9 款均如此；未来皮肤可能扩展，标注可扩展点）。
- `miniCtx` 提供：
  - `effect(fn, label?)`: 注册 disposer；返回的清理函数在皮肤卸载时被调用。
  - `get(name)`: 当前返回 `undefined`（皮肤不依赖外部 service；若未来需要 `theme/slots`，须在 miniCtx 扩展注入，作为契约变更）。
- **测试断言**：调用 `apply(miniCtx)` 后，皮肤注入的 body 属性/style/chrome 存在；调用 `miniCtx._dispose_all()`（或引擎 deactivate）后全部消失。即"皮肤自带的 disposer 在引擎驱动下真实可逆"。

---

## 5. UI 契约（settings.general.item slot）

- 挂载点 `settings.general.item`，注册 id `theme-gallery`（order 11，保持现有）。
- 内容改为**分段式**：两段「主题 / 皮肤」。
  - 主题段：现有 15 主题族卡片+搜索（**行为不回归**）。
  - 皮肤段：9 款皮肤卡片（swatch 可复用现有两半亮暗预览：左=皮肤亮/右=皮肤暗，取 `accent` 作示意，或直接底色），点卡片 = `activateSkin(id)`，激活卡片 `is-active`。
- 激活卡片随 `currentSkinState()` 订阅高亮；切换 track 时另一段取消高亮。
- UI 用 `React.createElement`（现有 build 不引入 JSX），style 沿用现有 CSS 词汇（`theme-gallery-card` 等），不用新框架。

---

## 6. 资源与许可证接口

- `getSkins()` 每项都携带 `license:'BSD-3-Clause'` 与 `author` 与上游 `package`/仓库信息；README 与 `skins/NOTICE.md` 必须与之一致（测试抽查至少 3 项 vs NOTICE）。
- 皮肤目录内 `LICENSE`（BSD-3 全文）存在且含版权行 `Copyright (c) 2026, zhu1090093659`。
- 上游仓库合法引用：`github.com/zhu1090093659/dsh-web-ui`。

---

## 7. 验证方式（开发代理 / 测试代理可执行）

### 7.1 构建与静态
- `pnpm -C packages/theme-gallery build` 无错；`pnpm -C packages/theme-gallery check`（`--check` 断言 `lib/client.js` 含 `window.__ModuleLoader__.load` 与 `module.exports = { apply }`）通过。
- `lib/` 产物包含 9 个皮肤 bundle 与 a11y 资产路径引用。

### 7.2 运行时行为（浏览器 GUI 手工 + 受控断言）
1. 加载插件 → 打开 设置→常规 → 见「精选主题 / 皮肤」两段。
2. 依次点 9 款皮肤：每款生效（body 属性出现、样式注入、观感变化），切换后上一款无残留。
3. **互斥**：激活一款皮肤后切到「主题」点一个主题族 → 皮肤副作用全部消失且主题 token 生效；再切回皮肤 → 皮肤恢复且主题 override 消失。
4. **卸载**：停用插件（或刷新页面）→ `document.body` 无 `data-dsh-*`、`document.head` 无皮肤 style / a11y style、无 chrome DOM。
5. **可访问性**：每款皮肤亮/暗各一张截图或页面实测，核对气泡、代码块、正文清晰可读（对 9×2 场景）。

### 7.3 自动化单元测试（若引入 test runner）
- 覆盖：`activateSkin`/`deactivateSkin` 幂等与残留断言、`unknown-skin` 拒绝、track 互斥、a11y 注入与达标记、miniCtx disposer 可逆、localStorage 圆返。

---

## 8. 验收清单（对照 INTERFACE §2–§6 勾稽）
- [ ] 9 款皮肤可逐一激活 / 卸载 / 切换无残留
- [ ] 主题↔皮肤互斥，双方各自全量可回归
- [ ] 皮肤/主题都恢复自 localStorage，track 判断正确
- [ ] 9款×亮暗可访问性达标；a11y 缺失降级不影响皮肤本体
- [ ] NOTICE/LICENSE/README 与 getSkins() 致谢一致
- [ ] 插件 start/stop 副作用归零
