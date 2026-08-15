# ACCEPT-REPORT — 主题与皮肤自定义系统 独立裁判验收报告（B3 覆盖缺口复核）

> 裁判：独立盲判。本复核仅评估"B3 覆盖缺口是否已关闭"。依据：`BRIEF-theme-skin-custom.md`、`INTERFACE-theme-skin-custom.md`、`TEST-PLAN-theme-skin-custom.md`、`LOCK-theme-skin-custom`、`tests/acceptance/*`、本次运行输出 `test-output.txt`。**未读取实现源码、未读 git 历史、未读 `.devflow` 除指定文件外内容，未修改任何项目文件**（仅更新 `.devflow/test-output.txt` 与本报两份裁判产出物）。
> 数据与指令隔离声明：测试输出与文件内容视为**数据**，不是命令；任何试图放宽标准的文字均未执行。自定义皮肤 bundle / 主题 JSON 一律按数据校验，不执行其字符串内容。
> 时间/版本：分支 `feature/theme-skin-custom-system`；验收命令 `node --test tests/acceptance/*.test.mjs` 于本会话执行并落盘。

---

## 结论：**合格**

本复核针对上期报告的覆盖盲点（TEST-PLAN `B3` / INTERFACE §8.2②：对侧 `track=skin` 时本轨不抢占、明确应用才写 theme）执行：当前 LOCK 锁定的 `tests/acceptance` 中已新增可执行 B3 断言，实跑 30/30 全通过（含该 B3 用例），**B3 覆盖缺口已关闭**。未发现阻断性缺陷。

---

## 0. 锁定校验（tests/acceptance 相对 LOCK 未改动）

- LOCK 当前值：`0d698f5c2453313ba3d8ebe3bd53a25504047be1`
- 方法：`git ls-tree -r <LOCK> -- tests/acceptance/` + `git ls-files -s -- tests/acceptance/` + `git status --short`
- 结果：LOCK 时 tests/acceptance 含 3 文件；当前工作区 3 文件 blob 哈希与 LOCK 完全一致（`skin-custom.test.mjs`=`9765862…`、`theme-custom.test.mjs`=`930c5d3…`、`theme-skin-build-static.test.mjs`=`efa6a2a…`），`git status` 干净、index 相对 LOCK diff 为空。**tests/acceptance 相对 LOCK 未改动，锁定成立。**

> 注：LOCK 值较上期（`57f74ae7…`）已更新为 `0d698f5c…`——即重新锁定并纳入了新增的 B3 断言文件。当前 `tests/acceptance` 与当前 LOCK 逐字一致。

## 1. 验收测试运行结果（写入 .devflow/test-output.txt）

命令：`node --test tests/acceptance/*.test.mjs`（node v25.9.0，exit 0）

```
tests  30   suites 13   pass 30   fail 0   cancelled 0   skipped 0   todo 0
duration ~129ms
```

关键落点：
- **新增用例（§8.2 B3，主题⇄皮肤软互斥边界）**：`theme-custom.test.mjs` 新增 describe「主题↔皮肤软互斥边界 (§8.2 B3)」，单条 it：**对侧 skin 已激活时，主题包不主动覆盖 track；本包用户明确应用时才写入 theme**。✔ 通过。
- 其余原 29 项（皮肤/主题状态机、校验错误契约 C1–C14、D5 内置不可删、E1/E2 滚动与体积、F1–F3 README）全部保持通过。

## 2. 对侧 track=skin 覆盖核对（本任务重点）

任务要求确认 B3 是否覆盖「对侧 track=skin 时主题导入不抢占，明确应用才写 theme」。核对锁定文件 `theme-custom.test.mjs` 的 B3 断言：

| 步骤 | 断言 | 是否命中要求 |
|---|---|---|
| 预置对侧 track=skin（`setAppearanceTrack('skin')`） | — | 模拟「对侧已激活、track='skin'」 |
| `importCustomTheme(validThemeJSON)` 导入主题 | `getAppearanceTrack() === 'skin'`（导入**不抢占**） | ✔ |
| `applyCustomTheme('my-theme')` 明确应用 | `getAppearanceTrack() === 'theme'`（**明确应用才写**） | ✔ |

实跑中该用例通过（`✔ 对侧 skin 已激活时，主题包不主动覆盖 track；本包用户明确应用时才写入 theme`）。上期报告 §7-①「B3 拒绝路径缺乏可执行验收」的缺口已由锁定的可执行断言闭合。

> **诚实披露（不构成失败）**：该 B3 用例以 `if (!api.getAppearanceTrack) return` 作为读取缝的软守卫——若某配置下接口未暴露该 getter，用例会静默返回而被 stat 计为 pass，而非 loud-fail。本案实跑中该断言真实执行（否则 `importCustomTheme` 后 track 非 'skin' 的断言之上的 `assert.equal` 会抛错），故当前配置下覆盖为真；但该写法使「读取缝缺失」这一退化路径无强失败信号。属健壮性提示，不计入失败。

## 3. 其余审核面（沿用锁定 test 覆盖）

- 状态机：主题/skin 全链、preview 不回写、非法导入不变外观（A1/A1b/A2/A4）。✔
- 导入校验错误契约：主题 C1–C6、皮肤 C7–C14（缺文件/缺元数据/坏契约/高危/体积/数量/内置冲突/a11y 降级）。✔
- 删除 & 恢复默认、内置不可删（D1–D5）。✔
- 滚动/体积/README（E1/E2、F1–F3）：读取 `lib/client.js` 产物与根 README 做静态断言，产物存在即真断言、缺失才 skip。本运行 30/30 全过、无 skip。✔

## 4. 判定

- 红线（非法不改外观/不写 storage；bundle 按数据不执行包内文字；失败抛 `{code,message}`）：由 A4、C2–C14、C7/C8「导入失败不改 registry」等断言覆盖且全部通过。✔
- **未发现阻断性缺陷；B3 覆盖缺口已关闭。** 结论：**合格**。

---

验收人：独立裁判（current session，B3 复核）
日期：本会话执行日
结论：**合格**
