# ACCEPT-REPORT — 主题与皮肤自定义系统 独立裁判验收报告

> 裁判：独立盲判（未读取 `packages/*/src` 实现源码、未读 git 历史、未读 `.devflow` 除四大依据外的文件）。
> 依据：`BRIEF-theme-skin-custom.md`、`INTERFACE-theme-skin-custom.md`、`TEST-PLAN-theme-skin-custom.md`、`LOCK-theme-skin-custom`、`tests/acceptance/*`、本次测试输出 `test-output.txt`。
> 数据与指令隔离：本项目原始需求、INTERFACE、BRIEF 等为自产规范化文档，非外部"命令"；自定义皮肤 bundle / 主题 JSON 一律按数据校验，绝不执行其字符串内容。
> 时间/版本：分支 `feature/theme-skin-custom-system`；测试由 `node --test tests/acceptance/*.test.mjs` 于本次会话执行并落盘。

---

## 结论：**合格**

签署的验收测试（tests/acceptance，LOCK 锁定）全部通过；两包 build / check / unit test 全部通过；build 产物与 README 交付契约独立核验达标。报告末尾披露一处覆盖盲点（§8.2② / TEST-PLAN B3）供委托人知悉，不构成此项失败。

---

## 0. 锁定校验

- LOCK 值：`57f74ae7aa385e26dea13a13aca30fcca23a7c45`（commit）
- 方法：`git diff <LOCK> -- tests/acceptance/` + `git ls-tree -r <LOCK> -- tests/acceptance/` + `git status --short tests/acceptance/`
- 结果：LOCK 时 tests/acceptance 含 3 文件（`skin-custom.test.mjs` / `theme-custom.test.mjs` / `theme-skin-build-static.test.mjs`）；当前工作区与 LOCK 的 diff 为空，无增删、无 un-tagged 修改。**tests/acceptance 相对 LOCK 未改动，锁定成立。**

## 1. 验收测试运行结果（写入 .devflow/test-output.txt）

命令：`node --test tests/acceptance/*.test.mjs`

```
tests  29   suites 12   pass 29   fail 0   cancelled 0   skipped 0   todo 0
duration ~86ms
```

覆盖点落点：
- 皮肤状态机全链 / track 键（§8.1 A2、§8.2 B1/B2）
- 皮肤缺文件 / 缺元数据 → `ERR_SKIN_MISSING_FILE` / `ERR_SKIN_BAD_META`（C7/C8，且失败不改 registry）
- 皮肤契约 & 高危能力（C9/C10/C11/C12/C13）+ a11y 缺失降级（C14）
- 皮肤内置不可删（D5）
- 主题状态机全链（A1/A1b/A4）
- 主题导入校验错误契约（C1–C6）
- 主题未知 id → `ERR_UNKNOWN_ID`；内置不可删（D5）
- 滚动契约 / 体积契约（E1/E2，读到 `lib/client.js` 真实产物，产物存在则真断言、缺失才 skip）
- README 交付格式（F1/F2/F3）

## 2. 两包 build / check / test

| 包 | build | check | test | 结果 |
|---|---|---|---|---|
| `theme-gallery` | ✔ 产出 `lib/client.js` | ✔ | 16/16 pass | 通过 |
| `skin-gallery` | ✔ 产出 `lib/client.js`（9 skins, 9 bundles embedded） | ✔ | 39/39 pass | 通过 |

- theme unit 覆盖：导入校验、状态机、滚动契约、轨道互斥写键。
- skin unit 覆盖：a11y 缺失降级、NOTICE/LICENSE/作者一致性、9 皮肤可访问性对比≥4.5、动态注册 bundle、缺文件/元数据、契约/高危/体积/数量、生命周期/track、真实 bundle 引擎全链路。全部 pass。

## 3. build 产物独立核验（黑盒，不读实现源码）

- **体积（§6 / E2）**：`packages/theme-gallery/lib/client.js` = 50714 B，< 102400 B（100KB）。✔
- **滚动（§6 / E1）**：产物中 `.theme-gallery-grid` / `.skin-gallery-grid` 定义仅含 `display:grid;grid-template-columns;gap;padding`，media query 只改列数，**无 `overflow`、无 `max-height`**。✔

## 4. README 交付格式独立核验（§8.6）

- F1 主题格式：明确 `id`/`label`/非空 `tokens`、token 名 `--dsw-` 前缀、值 `{light,dark}` 字符串。✔
- F2 皮肤包三文件：`skin.json`（id/name/author/license 必填）/`client.js`（`__ModuleLoader__.load`+`apply(ctx)`+仅 `ctx.effect`/`ctx.get`）/`a11y.css`（缺失降级）+ 256KB/8 个限制。✔
- F3 状态机与错误表：完整列出状态机（none/preview/applied/deleted、restore_default/delete 回默认）与全部 12 个 `ERR_*` code。✔

## 5. 管线红线复核

- 贯穿性红线（导入失败不改外观 / 不写 storage；bundle 按数据校验绝不执行包内文字；失败抛 `{code,message}` 不崩、不静默）：由 C7/C8、"导入失败不改 registry"、C9–C13 各 code 断言覆盖且通过。✔

---

## 6. INTERFACE §8 逐项判定表

| §8 条目 | 验收要点 | 落点 | 判定 |
|---|---|---|---|
| 8.1 状态机 | theme 全链 none→import→preview→applied→delete→restore | A1/A1b/A4 ✔ | 达标 |
| 8.1 状态机 | skin 9/自定义 全链 | A2 ✔ | 达标 |
| 8.1 状态机 | preview 刷新不回写 applied | A1 preview 后 applied 空 + A1b ✔ | 达标 |
| 8.1 状态机 | 非法导入全链失败且外观不变 | A4 ✔ | 达标 |
| 8.2 互斥 | 激活时 track='theme'/'skin' | B1/B2 ✔ | 达标 |
| 8.2 互斥 | 对侧键存在时不活化本轨（软仲裁） | ⚠ **锁定 test 未纳入可执行断言** | 未覆盖（见 §7） |
| 8.3 主题导入校验 | 合法通过；缺字段/坏 token/内置冲突拒绝 | C1–C6 ✔ | 达标 |
| 8.3 皮肤导入校验 | 缺文件/缺元数据/坏契约/含高危/超256KB/超8个/内置冲突拒绝 | C7–C13 ✔ | 达标 |
| 8.3 a11y 降级 | 缺 a11y.css 仍可用 | C14 ✔（另 skin unit F3） | 达标 |
| 8.4 删除 & 恢复默认 | delete applied 回默认（主题=jade/皮肤=none）；restore 清自定义留内置 | A1/A2/D5 ✔ | 达标 |
| 8.5 滚动/体积/残留 | 无内部滚动；theme<100KB；stop 无残留 | E1/E2 ✔（残留为运行时 GUI 面，node:test 不覆盖，见 §7-③） | 达成（残留留手动） |
| 8.6 README 交付 | 主题格式/皮肤三文件/状态机+错误表 | F1/F2/F3 ✔ | 达标 |

---

## 7. 覆盖盲点 / 诚实声明（不构成此项失败，请委托人知悉）

1. **§8.2② 对侧占位不覆盖 track（TEST-PLAN B3）未落入锁定验收 test**。`skin-custom.test.mjs` / `theme-custom.test.mjs` 的互斥断言仅覆盖"激活时 track 写入 theme/skin"（B1/B2），未断言 B3"对侧存在非激活态时本轨不活化、track 不被覆盖"。故该项**无法从签署测试证明**。theme-gallery unit 有一断言表述为"对侧 track=skin 占位，本轨 apply 仍写 theme（最后写者生效）"。INTERFACE §1.2 的"对侧存在非激活态时不活化本轨"与"事件序软互斥/最后写者生效"可视为不同场景（非激活态 vs 激活态互补），不构成直接冲突，但 B3 的拒绝路径缺乏可执行验收，属覆盖缺口。**建议**为补严互斥，追加 B3 签收用例。
2. **F3（README）含错误表**为真实产出一致（12 个 ERR code 全列出），无误。
3. **§8.5 "停止后残留"与真实 GUI 冒烟**（导入→试穿→应用→删除→恢复→切换轨→停插件）属运行时 GUI 面：TEST-PLAN 覆盖声明明确交由发布前手动流程（INTERFACE §9），不入 node:test。本次 node:test 无法真刷新页面/真停插件，仅能断言无副作用，已由命名一致且全部通过的 unit 生命周期测试侧面支撑；真机残留核验不在本次自动化范围内。

---

## 8. 判定依据声明

- 本裁判未读取 `packages/*/src` 实现源码，未读 git 历史，未读 `.devflow` 中 PLAN/老版本文档等非指定文件。
- 所有"通过"均基于签署锁定 test 的实际执行输出（落盘 `test-output.txt`）+ 本次 build/check/unit test 实跑结果 + 对 build 产物与根 README 的黑盒独立复核。
- 未对实现做任何篡改；未执行任何自定义 bundle/主题 JSON 的字符串内容（仅 JSON.parse/静态校验/正则匹配）。

---

验收人：独立裁判（current session）
日期：本会话执行日
结论：**合格**
