# TEST-PLAN — DSH 0.2 适配（turn-scrubber / composer-tools / appearance-gallery）

> 修 bug 模式：核心产物是**复现测试**（修复前红、修复后绿）+ 相邻回归用例。
> 本清单只依据 `.devflow/INTERFACE-dsh-0.2-adapt.md`（必验清单 A1-A7 / B1-B7 / C1-C6 / D1-D2）。
> 自动可跑 = 本机 `node --test` / `npx playwright test` 能复跑；人工真机 = 卡点③真机实测（桌面 0.2 版）。

## 运行命令（四条，均在仓库根）

```bash
# 1) 静态门禁 + 发布面 + A3/C2 行为级（自动可跑，修复前应红→修复后绿）
#    glob *.test.mjs 已包含 A3/C2 行为级测试（起桌面 0.2 临时 profile，约 40 秒）
node --test "tests/acceptance/dsh-0.2-adapt/*.test.mjs"

# 2) 0.1.5 dsh web 回归 e2e（自动可跑；先起实例）
DSH_E2E_BASE_URL=http://127.0.0.1:3099 npx playwright test tests/acceptance/dsh-0.2-adapt/e2e/

# 3) 三个包既有单测（A6/B7/C6，回归面，自动可跑；composer-tools 需先 build）
(cd packages/dsh-turn-scrubber && node --test "tests/unit/*.test.ts")
(cd packages/dsh-composer-tools && node --test "tests/unit/*.test.mjs")   # 需先 node build.mjs
(cd packages/dsh-appearance-gallery && node --test "tests/unit/*.test.mjs")

# 4) A3/C2 行为级复现（自动可跑，单独跑这条更快定位；桌面 App 未装时优雅跳过）
node --test "tests/acceptance/dsh-0.2-adapt/A3-C2-activation-behavior.test.mjs"
```

## 逐条清单

| 编号 | 场景 | 怎么操作 | 预期看到什么 | 方式 | 修复前 |
|---|---|---|---|---|---|
| A1 | turn-scrubber inject 加 `webServer` | 跑命令① | 断言 `inject === ['connection','sessionPersistence','sessions','webServer']` | 自动 | 🔴红 |
| A2 | rpc.handle 删第三参 `{authority:'loopback'}` | 跑命令① | 断言 lib 与 src 都不再含 `authority:'loopback'` | 自动 | 🔴红 |
| A3 | 0.2 启动审计 0 条 `did not activate` | 跑命令④：临时 profile（含 turn-scrubber）用桌面 0.2 CLI 起实例，看启动日志 | 无 `webServer without inject`、无 `did not activate`、有 `http://127.0.0.1:<port>` 就绪行 | 自动（行为级） | 🔴红（改前必挂） |
| A4 | 0.2 `rpc.call('/turn-scrubber','turnIndex',{sessionId})` 有响应 | 桌面 0.2 会话内触发 turn 索引 | 对真实会话返回 `{ok:true, value:{total≥0}}` | 人工真机 | 🔴红 |
| A5 | 0.1.5 回归：插件仍正常激活 | 跑命令②（A5 用例） | 页面无 webServer/without inject 报错 | 自动 | 🟢绿 |
| A6 | turn-scrubber 既有单测全绿 | 跑命令③第 1 条 | 全绿 | 自动 | 🟢绿 |
| A7 | 删第三参后通道仍 loopback-only | 跑命令②（A7 用例） | 非可信来源 403 且不含 preview；loopback 非 403 | 自动（0.1.5）＋人工（0.2） | 🟢绿 |
| B1 | composer-tools 静态：EntryProps 加 `sessionId?`，取值 `props.sessionId ?? snapshot.current` | 跑命令① | 4 条静态断言全绿 | 自动 | 🔴红 |
| B2 | 0.2 面板显示会话目录（非「无当前会话目录」） | 桌面 0.2 绑定目录的会话里点「指令/提示词」 | 显示该会话工作目录 | 人工真机 | 🔴红 |
| B3 | 0.2 面板列出并打开 `~/.dsh/AGENTS.md`（global） | 面板点开 global 文件 | 编辑器读到 AGENTS.md 内容 | 人工真机 | 🔴红 |
| B4 | 0.2 空白新会话 cwd=undefined 不崩 | 桌面 0.2 新建空白会话，打开面板 | 显示空/无目录状态，不抛错不崩溃 | 人工真机 | 🔴红 |
| B5 | **首验项**：`props.sessionId` 随会话切换变化 | 桌面 0.2 `console.log(props.sessionId)` + 切换会话 | 切会话后值跟着变（不通过即上报，不硬写后续断言） | 人工真机 | 🔴红 |
| B6 | 0.1.5 回归：面板仍正常 | 跑命令②（B6 用例） | 入口注入、点开正常、无插件错误 | 自动 | 🟢绿 |
| B7 | composer-tools 既有单测全绿 | 跑命令③第 2 条（先 build） | 全绿 | 自动 | 🟢绿 |
| C1 | appearance-gallery 三 ui-* peer 改 `^0.1.0-rc.6 \|\| ^0.2.0-rc.1`，cordis/react/meta 不变 | 跑命令① | 静态断言全绿 | 自动 | 🔴红 |
| C2 | 0.2 去豁免后能加载、审计无 peer 告警、无 `did not activate` | 跑命令④：临时 profile 不拷 `compatibility.json` 豁免、bundle 用工作区本地 link | 无 `skipping profile bundle`（appearance-gallery）、加载成功、有就绪行 | 自动（行为级） | 🔴红 |
| C3 | 0.2「打开外观设置」入口出现 | 桌面 0.2 设置→通用 | 出现外观入口（order:11 与原生并列） | 人工真机 | 🔴红 |
| C4 | 0.2 功能闭环 5 条（切主题/切皮肤/试穿回滚/导入应用/恢复默认） | 桌面 0.2 逐条触发 | 全部生效、无残留 `<style data-plugin>` 与 `data-dsh-*` body 属性 | 人工真机 | 🔴红 |
| C5 | 0.1.5 去豁免后仍能加载（双区间覆盖 0.1.5-rc.2） | 跑命令②（C5 用例）；pnpm 可能打一条 peer WARN 属预期 | 设置页出现外观入口、无插件错误 | 自动 | 🟢绿 |
| C6 | appearance-gallery 既有单测全绿 | 跑命令③第 3 条 | 全绿 | 自动 | 🟢绿 |
| D1 | `git diff` 脱敏扫描通过 | 跑命令①（D1 用例） | 开发者手写内容无 /Users/…、邮箱、sk-/ghp_/私钥 | 自动 | 🟢绿 |
| D2 | 三包 lib 均已重建、产物与 src 一致 | 跑命令①（D2 用例）+ 改后 `node build.mjs` | 构建入口齐全、已提交产物非空；composer-tools lib 为构建期生成 | 自动＋人工（重建） | 🟢绿 |

> 🔴 = 修复前预期失败（证明真复现）；🟢 = 修复前已通过（回归/门禁，修后必须仍绿）。
> A3/C2 已由命令④「行为级」自动覆盖：起一个带 `-verify` 后缀的临时 profile（只含核心 bundle + 三个工作区 link 包、
> 不拷兼容豁免），用桌面 0.2 CLI 启动并断言「无 `did not activate` / `without inject` / `skipping profile bundle`，且有就绪行」。
> 其余 A4/B2/B3/B4/B5/C3/C4 是桌面 0.2 的会话/UI 行为，宿主进程由桌面 App 管理，仍走卡点③真机实测。

## 覆盖说明

- **正常路径**：A4（真实会话索引）、B2/B3（面板显示目录、打开 global 文件）、C3/C4（入口 + 功能闭环）、A5/B6/C5（0.1.5 回归正常面）。
- **边界**：B4（空白新会话 cwd=undefined 不崩）；composer-tools 的 cwd 非法（缺失/空串/非绝对路径→400 `invalid-cwd`）已由既有 `test-02-host-list` 覆盖，本次不重复。
- **错误路径**：turn-scrubber 错误码（`session-not-found`/`unavailable`/`bad-request`、非可信 403）与 `/ct` 传输层 + 领域错误码（§2.2 全套 13 个）**本次不改任何错误码**，全部由既有 composer-tools `test-01..16` 与 turn-scrubber 契约测试覆盖；本次新增的是「0.2 激活失败消失」（A3）+「非可信来源被拒」（A7）。
- **反向用例**：A7（非可信来源**不得**返回 `turns[].preview`）、D1（不该泄漏的个人路径/密钥不出现）。
- **幂等/并发**：本次适配不引入新状态机/写操作，无新增幂等/并发面；既有 appearance-gallery 的并发/互斥测试（`10-track-mutex`/`11-concurrency-idempotence`）不受影响。
- **常理必须正确**：D2（改完必须重建产物）、A2（源码与产物两处都要删死参数，防止只改一处）。

## 没覆盖 / 需人工（交卡点③）

- 桌面 0.2 全部会话/UI 运行时：A4、B2、B3、B4、B5、C3、C4（上表「人工真机」行）。A3/C2 已由命令④自动覆盖。
- A2 的「`NodeContext.connection.rpc.handle` 类型签名无 `options` 形参」属 TypeScript 类型层，
  grep 无法可靠定位类型声明（会假绿），不作为独立自动断言——由本包 `check`（tsc --noEmit）
  + A3/A4 运行时 + A2 死参数删除共同守门。
- 0.1.5 `dsh web` 的 e2e（A5/A7/B6/C5）需先手动起实例并 `dsh plugin add` 装入 profile；
  本机未装 node_modules / playwright，未实跑（测试文件已语法校验通过）。
