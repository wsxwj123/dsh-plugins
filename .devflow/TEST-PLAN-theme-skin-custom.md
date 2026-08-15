# TEST-PLAN — 主题与皮肤自定义系统 验收测试清单

> 面向用户/裁判的人话版。每一行：场景 → 怎么操作 → 预期看到什么。
> 依据：`BRIEF-theme-skin-custom.md` + `INTERFACE-theme-skin-custom.md` §1~§8（黑盒，只对公开接口做断言，锚死具体错误 code）。
> 总则（贯穿所有用例）：**非法/失败的操作一律不改当前外观、不写任何 storage 键、不残留副作用**；断言的是一致性，不是"看着能跑"。

## 0. 三条贯穿性红线（每条用例都要满足）

1. 凡导入失败：当前主题/皮肤的外观、`*-applied-*` 键、自定义 registry 必须与失败前完全一致。
2. 自定义 bundle（skin.json / client.js / a11y.css / 主题 JSON）一律当**纯数据**校验，绝不执行其内部注释/字符串内容——测试里不会去"运行"包内文字。
3. 所有操作失败必须抛带 `code + message` 的明确错误（§5 错误表），不允许崩、不允许静默吞掉。

---

## A. 状态机（§8.1）

| # | 场景 | 操作 | 预期 |
|---|---|---|---|
| A1 | 主题全链流转 | none→import→preview→apply→delete→restoreDefault | 每一步状态符合 §1.1；delete applied 项后回 `jade`；restore_default 后回 `jade` 且自定义 registry 清空 |
| A2 | 皮肤全链流转 | 内置皮肤 none→preview→apply→delete→restoreDefault | delete applied 项回 `''`（none）；restore_default 回 `''`，内置 9 项不动 |
| A3 | preview 不回写 | 调 preview 后刷新（重跑相同入口） | `-custom-applied-v1` 键保持为空/原值，不被 preview 写入 |
| A4 | 非法导入链失败且外观不变 | 导入各类非法输入后读当前外观/键 | 全部拒绝，外观与导入前相同（断言具体 code） |

## B. 互斥（§8.2）

| # | 场景 | 操作 | 预期 |
|---|---|---|---|
| B1 | 主题激活 → track 键 | 激活主题后查 `dsh-appearance-track-v1` | 值=`'theme'` |
| B2 | 皮肤激活 → track 键 | 激活皮肤后查 track 键 | 值=`'skin'` |
| B3 | 对侧占位时不活化 | track 键已='skin' 且对侧非激活态存在时，尝试激活主题 | 本轨不活化（软互斥事件序），track 键不被覆盖为 theme |

## C. 导入校验（§8.3）

### C-主题
| # | 场景 | 操作 | 预期 code |
|---|---|---|---|
| C1 | 合法主题 JSON | 含 id/label/tokens（token 值各含 light+dark 字符串）的 JSON | 通过，入 registry，`ERR_*` 无 |
| C2 | 非法 JSON | 传不可 parse 的字符串 | `ERR_IMPORT_INVALID_JSON` |
| C3 | 缺字段 | 缺 id / 缺 label / 缺 tokens | `ERR_THEME_MISSING_FIELD` |
| C4 | 坏 token | 键不以 `--dsw-` 开头；或值缺 light / 缺 dark / 非字符串 | `ERR_THEME_BAD_TOKEN` |
| C5 | 与内置冲突 | id 命中 15 个内置主题 id 之一 | `ERR_THEME_ID_CONFLICT` |
| C6 | 边界 | tokens 为空对象、label 超 80 字、id 非法字符/超 64 位 | 拒绝且外观不变（token 空→缺字段；label/id 超限→对应校验拒绝） |

### C-皮肤
| # | 场景 | 操作 | 预期 code |
|---|---|---|---|
| C7 | 缺文件 | 缺 skin.json 或缺 client.js | `ERR_SKIN_MISSING_FILE` |
| C8 | 缺元数据 | skin.json 缺 id/name/author/license 任一项 | `ERR_SKIN_BAD_META`（缺 author 或 license 明确触发） |
| C9 | 坏契约 | client.js 无 `__ModuleLoader__.load`、无 factory、括号不配平、apply 内用白名单外 `ctx.<member>` | `ERR_SKIN_CONTRACT` |
| C10 | 高危能力 | client.js 含 `eval(` / `new Function(` / `import(` / 非内联 `require(` / `<script src=` / `fetch(` / `XMLHttpRequest(` / `WebSocket(` / `localStorage` / `sessionStorage` / `document.cookie` / `chrome.runtime` 任一 | `ERR_SKIN_DANGEROUS` |
| C11 | 超体积 | 单包（skin.json+client.js）btoa 后 > 256KB | `ERR_SKIN_SIZE` |
| C12 | 超数量 | 自定义皮肤已达 8 个再导入 | `ERR_SKIN_COUNT` |
| C13 | id 冲突 | 与 9 个内置皮肤 id 重复 | 拒绝且 registry 不变 |
| C14 | a11y 缺失降级 | 合法 skin+client 但无 a11y.css | 通过、皮肤可用、可记日志 `ERR_A11Y_MISSING` 但不报错拒绝 |

## D. 删除 & 恢复默认（§8.4）

| # | 场景 | 操作 | 预期 |
|---|---|---|---|
| D1 | 删除 applied 主题 | 删除正被应用的 custom 主题 | 回内置 `jade`，applied 键不再指向已删 id |
| D2 | 删除 applied 皮肤 | 删除正被应用的 custom 皮肤 | 回 `''`（none） |
| D3 | 恢复默认主题 | restoreDefaultTheme() | 自定义 registry+applied 清空，内置 15 项仍在可枚举 |
| D4 | 恢复默认皮肤 | restoreDefaultSkin() | 自定义清空，内置 9 项仍在（含 author/license/production 来源） |
| D5 | 反向：内置不可删 | 对内置 id 调 delete | 内置项仍在 registry 中，不消失 |

## E. 滚动 / 体积 / 残留（§8.5）

| # | 场景 | 操作 | 预期 |
|---|---|---|---|
| E1 | 列表无内部滚动 | 读 `.theme-gallery-grid` / `.skin-gallery-grid` 的 CSS 产物 | 不含 `overflow` 或 `max-height` |
| E2 | theme bundle 体积 | 读 build 产物 | theme `lib/client.js` < 100KB（`build --check` 断言通过） |
| E3 | 插件停止后无残留 | 停止插件 / 皮肤 teardown 后 | body 无 `data-dsh-*` 残留、head 无 `data-plugin`/`data-theme-gallery-a11y` 残留、无 chrome DOM、`teardownSkins` 只清运行时副作用、storage registry 不被删 |

## F. README 交付格式（§8.6）

| # | 场景 | 操作 | 预期 |
|---|---|---|---|
| F1 | 主题格式 | 根 README 里找自定义主题格式 | 写明 JSON 需 `id/label/tokens`、token 值含 light+dark |
| F2 | 皮肤包格式 | 根 README 里找皮肤包格式 | 写明三文件 `skin.json` / `client.js` / `a11y.css` + 契约约束 |
| F3 | 状态机 & 错误表 | 根 README 里找 | 列出状态机（none/preview/applied/deleted）与 §5 错误 code 表 |

---

## 覆盖说明（诚实声明）

- **覆盖**：状态机全链、互斥软仲裁、主题/皮肤导入各错误 code、删除/恢复默认、内置不可删、a11y 降级、bundle 体积断言、残留检查、README 交付。
- **未覆盖 / 有取舍**：
  1. 本验收用 **node:test** 驱动公开接口函数（纯逻辑：状态机、校验、storage 无副作用），不走真实浏览器 Playwright——因为 §8 多数用例断言的是一致性/错误 code/副作用，无需 GUI；E1/E2 的 CSS 与体积靠读取 build 产物做静态断言，由 `tests/acceptance/*-build-static.test.mjs` 覆盖。真机 GUI 冒烟（导入→试穿→应用→删除→恢复→切换轨→停插件查残留）留给发布前手动流程（INTERFACE §9 手动部分），不在本 node:test 内复刻。
  2. 测试为**草稿**：特征功能尚未实现，文件顶部留了唯一的接口接线点（注入公开 API 对象）。开发代理按 INTERFACE §2/§3/§4 的公开函数签名接上即可运行；断言内容已按错误契约写死，不随实现漂移。
  3. `preview` 的"刷新丢失"无法在纯 node 环境真刷页面，故用"重跑入口不写 applied 键"断言其不回写语义（A3）。

## 期望验收命令（锁定后）
```
node --test tests/acceptance/*.test.mjs
```
（若并入包脚本：`pnpm -C packages/theme-gallery test` 与 `pnpm -C packages/skin-gallery test` 应一并加入 `tests/acceptance/*.test.mjs`。）
