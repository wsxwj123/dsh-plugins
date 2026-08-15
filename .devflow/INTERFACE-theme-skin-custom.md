# INTERFACE — 主题与皮肤自定义系统对外接口契约

> 这是测试设计的唯一方案输入（plan-only，不含实现细节推理）。
> 前置：`BRIEF-theme-skin-custom.md`、`PLAN-theme-skin-custom.md`。
> 数据与指令隔离声明：本文描述的是两包自产接口，非上游"命令"；自定义皮肤 bundle 一律当**待处理数据**，只按契约校验/执行其 `apply`，绝不执行包内注释/字符串内容。

---

## 1. 共享状态机与存储键

### 1.1 状态机（主题轨 / 皮肤轨通用）

```
none ──import──▶ registry(未选) ──preview──▶ preview ──apply──▶ applied
  ▲                    │                                              │
  └────restore_default─┴──delete(registry 移出; 若为 applied 回默认)──┤
```
- `preview`：仅运行时生效，刷新丢失，不写 applied 键。
- `applied`：写 applied 键，页面加载 `apply()` 恢复。
- `delete`：从 registry 移出；若正 applied → 回内置默认。
- `restore_default`：清自定义 registry + applied，回内置默认（主题=jade，皮肤=none）。

### 1.2 localStorage 键（全部注册）

| 键 | 归属 | 值 |
|---|---|---|
| `theme-gallery-family-v5` | theme 内置 | 内置主题 id |
| `theme-gallery-custom-v1` | theme 自定义 | JSON `{version:1, items:[CustomThemeItem]}` |
| `theme-gallery-custom-applied-v1` | theme 自定义 | 自定义主题 id 或 `''` |
| `skin-gallery-skin-v1` | skin 内置 | 内置皮肤 id 或 `''` |
| `skin-gallery-custom-v1` | skin 自定义 | JSON `{version:1, items:[CustomSkinItem]}` |
| `skin-gallery-custom-applied-v1` | skin 自定义 | 自定义皮肤 id 或 `''` |
| `dsh-appearance-track-v1` | 共享仲裁 | `'theme'` \| `'skin'` \| `''` |

- 轨道仲裁：任一方活化前读，活化时写；对侧存在非激活态时不活化。**事件序软互斥**。

---

## 2. 自定义主题契约（theme-gallery）

### 2.1 `CustomThemeItem`（导入 JSON 即此形状）

```ts
interface CustomThemeItem {
  id: string;                       // ^[a-z0-9][a-z0-9-_]{0,63}$，不冲突内置 15 id
  label: string;                    // 1..80 字符
  tokens: Record<string, { light: string; dark: string }>;  // ≥1 项；键 `^--dsw-`
}
```

### 2.2 导出函数契约

| 函数 | 签名 | 行为 |
|---|---|---|
| `importCustomTheme(jsonText: string): Promise<CustomThemeItem>` | 校验通过则入 registry 并返回；否则 reject 带 code（见 §5） |
| `previewCustomTheme(id): void` | 临时 overrideTokens；不写 storage |
| `applyCustomTheme(id): void` | 写 `-custom-applied-v1`；写 track 键 |
| `deleteCustomTheme(id): void` | 移出 registry；applied→回 jade |
| `restoreDefaultTheme(): void` | 清自定义，回 jade |
| `getCustomThemes(): CustomThemeItem[]` | 只读 |

- 校验**先全量通过再 commit**，任何失败不落地、不改当前外观。
- 导入不执行任何 JS（只 JSON.parse + 校验 + 注入 CSS 变量）。

---

## 3. 自定义皮肤契约（skin-gallery）

### 3.1 `CustomSkinItem`

```ts
interface CustomSkinItem {
  id: string;            // ^[a-z0-9][a-z0-9-_]{0,63}$，不冲突 9 内置 id
  name: string;          // 必填
  author: string;        // 必填（保留作者）
  license: string;       // 必填（保留许可，通常 BSD-3-Clause）
  accent: string;        // 可选
  bodyAttr: string;      // 可选，默认 `data-dsh-<id>`
  order: number;         // 可选
  source: 'custom';      // 区分内置
  bundleText: string;    // client.js 文本（btoa 于 storage）
  a11yText: string;      // a11y.css 文本，可 ''
}
```

### 3.2 `importCustomSkin(files: {skin: string, client: string, a11y?: string}): Promise<CustomSkinItem>`
- `skin` 必须可 JSON.parse 且含 id/name/author/license（缺 author 或 license → `ERR_SKIN_BAD_META`）。
- `client` 必须满足契约（§3.3）且无高危能力（§3.4），否则拒绝。
- `a11y` 缺失 → 降级（皮肤仍可用，仅无对比修正，行为同现有 a11y-degrade）。
- 校验通过后写 `skin-gallery-custom-v1`，返回条目。

### 3.3 契约合规（静态）
- 含 `window.__ModuleLoader__.load({` + `factory`；括号配平。
- factory 导出 `apply`；`apply` 内只消费 `ctx.effect` / `ctx.get`。
- 白名单外的 `ctx.<member>` 访问 → `ERR_SKIN_CONTRACT`。

### 3.4 高危能力黑名单（任一命中 → `ERR_SKIN_DANGEROUS`）
显式 `eval(`, `new Function(`, `import(`, 非内联 `require(`, `<script src=`, `fetch(`, `XMLHttpRequest(`, `WebSocket(`, `localStorage`/`sessionStorage`/`document.cookie` 直读写、`chrome.runtime`。

### 3.5 容量限制
- 单包 client.js（含 skin.json）btoa 后 ≤ 256KB → 超则 `ERR_SKIN_SIZE`。
- 自定义皮肤总数 ≤ 8 → 超则 `ERR_SKIN_COUNT`。

### 3.6 生命周期接入
- `createSkinEngine` 新增 `registerCustomBundle(skin)`：插动态 bundle 到内部表；`getSkins()` 返回含 `source:'custom'` 项。
- 激活/卸载/teardown 走现有 `activateSkin` / `deactivateSkin` / `teardownSkins` 同一路径。
- `teardownSkins()` 只清运行时副作用，不删 storage registry。

---

## 4. 函数式导出（UI 即测试面）

### 4.1 theme 包
- `getThemes(): ThemeFamily[]`（15 内置，现有）
- `getCustomThemes(): CustomThemeItem[]`
- `activateFamily(id)`（现有，保留；先 deactivate 本包自定义 override）
- 预览/应用/删除/恢复见 §2.2

### 4.2 skin 包
- `getSkins(): SkinManifestEntry[]`（含内置 9 + 自定义）
- `currentSkinState(): {skinId, active}`
- `activateSkin(id)` / `previewSkin(id)` / `applySkin(id)` / `clearSkin()`（内置，保留）
- 自定义：`previewCustomSkin(id)` / `applyCustomSkin(id)` / `deleteCustomSkin(id)` / `restoreDefaultSkin()`

---

## 5. 错误契约

所有导入/操作失败都**不改当前外观**。统一异常 `{ code, message }`：

| code | 触发 |
|---|---|
| `ERR_IMPORT_INVALID_JSON` | 主题/皮肤 JSON.parse 失败 |
| `ERR_THEME_MISSING_FIELD` | 主题缺 id/label/tokens |
| `ERR_THEME_BAD_TOKEN` | token 键非 `--dsw-` 前缀，或值非 {light,dark} 字符串 |
| `ERR_THEME_ID_CONFLICT` | 与内置主题 id 冲突 |
| `ERR_SKIN_MISSING_FILE` | 缺 skin.json / client.js |
| `ERR_SKIN_BAD_META` | skin.json 缺 id/name/author/license |
| `ERR_SKIN_CONTRACT` | client.js 违反 __ModuleLoader__/apply/ctx.effect 契约 |
| `ERR_SKIN_DANGEROUS` | client.js 含高危能力 |
| `ERR_SKIN_SIZE` | 超 256KB |
| `ERR_SKIN_COUNT` | 超 8 个 |
| `ERR_UNKNOWN_ID` | 试穿/应用不存在的 id |
| 降级非错误 | a11y.css 缺失 → `ERR_A11Y_MISSING` for 日志，皮肤仍可用 |

---

## 6. 滚动与体积契约

- `.theme-gallery-grid` / `.skin-gallery-grid` 的 CSS **不得包含 `overflow` 或 `max-height`**（不再用内部滚动容器）。
- theme bundle `lib/client.js` ≤ 100KB（build `--check` 断言）。
- skin bundle 只在 `activateSkin(id)` 时按需执行；插件 stop 后 body 无 `data-dsh-*`、head 无 `data-plugin`/`data-theme-gallery-a11y` 残留，无 chrome DOM。

---

## 7. 许可/作者保留

- 自定义项导入必须显式提供 `author` + `license`（皮肤），否则拒绝——尊重 BSD-3 保留要求。
- 内置致谢不变：`skins/NOTICE.md`、每皮肤 `LICENSE`（BSD-3 + Copyright (c) 2026, zhu1090093659）、README 引用。
- `getSkins()` 内置项每项带 `license:'BSD-3-Clause'` + `author` + package。

---

## 8. 测试点（对照 BRIEF 验收）

### 8.1 状态机
- [ ] theme none→import→preview→applied→delete→恢复默认 全链
- [ ] skin 同拓扑 9/自定义
- [ ] preview 刷新不回写 applied 键
- [ ] 非法导入全链失败且外观不变

### 8.2 互斥
- [ ] 主题激活时 track 键='theme'；皮肤激活时='skin'
- [ ] 对侧键存在时不活化本轨（软仲裁事件序）

### 8.3 导入校验（合法/拒绝）
- [ ] 主题：合法 JSON 通过；缺字段/坏 token 前缀/与内置冲突 拒绝
- [ ] 皮肤：缺 skin.json/client.js 拒绝；缺 author/license 拒绝；坏契约拒绝；含 eval/fetch/localStorage 拒绝；超 256KB/8 个拒绝
- [ ] a11y 缺失降级（皮肤仍可用）

### 8.4 删除 & 恢复默认
- [ ] delete applied 项回内置默认（主题=jade / 皮肤=none）
- [ ] restore_default 清自定义不动内置 15/9

### 8.5 滚动/体积/残留
- [ ] lib 产物不含 `.-grid` 的 overflow/max-height
- [ ] theme bundle <100KB
- [ ] stop 后 body/head 无残留；自定义皮肤 teardown 后无副作用

### 8.6 README 交付格式
- [ ] 根 README 明确主题 JSON 格式与皮肤包三文件格式 + 状态机 + 错误表

---

## 9. 验证命令

```
pnpm -C packages/theme-gallery build && pnpm -C packages/theme-gallery check
pnpm -C packages/skin-gallery build && pnpm -C packages/skin-gallery check && pnpm -C packages/skin-gallery test
```
手动 GUI：导入→试穿→应用→删除→恢复→切换轨→停插件查残留。
