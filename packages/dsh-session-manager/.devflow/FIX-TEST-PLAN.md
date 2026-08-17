# FIX-TEST-PLAN — 18 条问题的复现测试（人话版）

针对 `.devflow/REVIEW-BLIND-20260817.md` 的 18 条（F1-F3 / H1-H4 / M1-M5 / L1-L6）。
**修之前跑：红 = 真复现了问题。修之后跑：全绿 = 修好了。**

## 怎么跑（一条命令）

```bash
cd packages/dsh-session-manager && node --test "tests/regression/*.test.mjs"
```

引号必须留着：`node --test tests/regression` 会把目录当模块，报 MODULE_NOT_FOUND。

当前基线（未修任何代码）：**92 个用例 → 红 43 / 绿 40 / skip 9**。
（18 条盲审项：红 35 / 绿 34 / skip 6；W 系列 Windows 兼容：红 8 / 绿 6 / skip 3。）

这套测试直接加载 `src/*.ts`（node 原生剥类型 + 一个把 `./x.js` 指回 `./x.ts` 的
resolve hook，见 `tests/regression/_harness.mjs`），**不经过 `lib/`**。原因：本
worktree 没装 node_modules，`npm run build` 跑不了，`lib/` 不存在——既有
`tests/unit/*` 全都 import `lib/*.js`，所以在这个工作树里一条也跑不起来（这本身就是
L6）。副作用是好事：测的永远是当前源码，不会测到过期构建产物。

**既有测试一个字没动**（`git status` 只有 `tests/regression/` 一个新目录）。

## stub 按真实运行时校准（不再把危险假设写成真）

| 假设 | 既有单测的写法 | 本套的写法（真实语义来源） |
|---|---|---|
| `domain.global.set()` | 同步函数，抛错才算失败 | 返回 Promise；排在**一条 chain** 上；内存值**落盘后**才更新；`disposing` 时直接 reject（`dsh-storage-domain/lib/index.js:151-215`、`types/domain.d.ts:28`） |
| 写 Promise 无人 await | 无感知 | stub 记录“调用方有没有挂 handler”，对应真实的 `unhandledRejection → exit(1)`（`dsh-app-boot/lib/index.js:1042-1066`） |
| 行序 | ids 序 = DOM 行序 | 显式构造 DOM 行序 ≠ ids 序（`dsh-client-ui-workspace` flat 视图 `rows.sort(byRecency)` + 可拖拽持久顺序） |
| 会话可见性 | 只跳过 blank | 混入 archived / `origin:'subagent'`（官方 `sessionVisible`，`client.js:100-102`） |
| aria 模板 | 自造 label | 真模板 `会话“{name}”的操作` / `Session actions for {name}`（`client.js:2227/2292`） |

## 逐条清单

格式：**条目 / 复现什么 / 现在红还是绿 / 修后预期**

| 条目 | 复现什么场景 | 现在 | 修后预期 |
|---|---|---|---|
| **F1** | 归档写盘失败（磁盘满）时 `/sm/unarchive` 报了成功 | 🔴 | ok:false + `system-error`，归档集不变 |
| **F1** | 域正在关闭（set 立刻 reject）时也报成功 | 🔴 | ok:false |
| **F1** | 写 Promise 完全没人管（真实环境=整个 `dsh web` exit(1)） | 🔴 | 必须 await/catch |
| **F1** | 删归档会话时归档清理失败，没给 `moved:true` | 🔴 | ok:false + moved:true（可重试） |
| **F1** | `ok()` 在落盘前就返回，"可重试契约"在真后端失效 | 🔴 | 响应返回时写已落盘 |
| F1-相邻×4 | 成功路径不能被 await 改坏：正常 unarchive 仍 ok、只改 archivedSessionIds、幂等 no-op 不写盘、纯 ok 无 moved、域不可用仍 moved:true | 🟢 | 保持绿 |
| **F2a** | 已归档的同名会话占了 tie 槽位 0 → 删可见会话实际删归档的 | 🔴 | 绑到可见会话 |
| **F2a** | 子代理（`origin:'subagent'`）同名会话占槽位 | 🔴 | 绑到可见会话 |
| **F2b** | DOM 行序≠ids 序时按序号对齐 = 赌，两行都会错绑 | 🔴 | 同名歧义两行都不给按钮 |
| **F2c** | 存在标题叫「会话」的会话 → 所有更短标题的行都绑到它 | 🔴 | 精确重建 label 匹配 |
| **F2c** | 英文同理：标题叫 `Session` 劫持所有行 | 🔴 | 同上 |
| F2-相邻×5 | 唯一标题正常绑定（含 cwd/running）、只有 displayTitle 也能绑、blank/项目行不绑、无匹配返回 null、互为子串各归其主 | 🟢 | 保持绿 |
| **F3** | `smRestore` 全仓只有定义处，UI 里零调用点 | 🔴 | 至少一个 UI 调用点 |
| **F3** | 归档视图没有「恢复」控件 | 🔴 | 有「恢复」并接 smRestore |
| F3-相邻×2 | `smRestore` 仍 POST `/sm/restore` 只带 id；归档视图三个老入口还在 | 🟢 | 保持绿 |
| **H1** | 取消归档"当场生效、刷新回滚"这个限制既没走官方 API 也没写进文档/UI | 🔴 | README/UI 标注 或 改走 registry API |
| H1-相邻 | README「边界与已知限制」小节仍在（新说明写这里） | 🟢 | 保持绿 |
| **H2** | 连点两次取消归档 → 第二次读到落盘前的快照 → 第一次被静默还原 | 🔴 | 两个 id 都被移出（读-改-写串行） |
| **H2** | 同时删两个归档会话 → 丢掉一个的归档清理 | 🔴 | 两条都清掉 |
| H2-相邻 | 落盘后再发第二个写请求仍正确（串行化别把顺序写弄坏） | 🟢 | 保持绿 |
| **H3** | `empty()` 把回收站根下的 `.DS_Store` / `notes.txt` 一起删了 | 🔴 | 普通用户文件留着 |
| **H3** | `empty()` 递归删掉无 record、无 session marker 的普通目录 | 🔴 | 目录及内容留着 |
| H3-相邻×2 | 有 record 的真条目仍被清；带 marker 的孤儿仍被清 | 🟢 | 保持绿 |
| **H4** | `/etc/dsh-trash`、`/usr/local/lib/...`、`/private/tmp/...` 全部放行（名单只做全等） | 🔴 | 系统目录的子目录一律拒 |
| **H4** | trashRoot 是指向 sessions root 内部的 symlink → 所有边界检查被绕过，照样挂载 | 🔴 | 拒绝启用回收站 |
| H4-相邻×5 | 全等命中的老用例仍拒（根/home/home 父目录/`/tmp`/tmpdir 本身）、`~/.dsh/session-manager-trash` 仍放行、**os.tmpdir() 的子目录仍放行**、正常 root 仍挂载、trashRoot 在 sessions 内仍拒 | 🟢 | 保持绿（见下方冲突 2） |
| **M1** | record 的 `originalDir` 被改到 sessions root 之外，restore 直接 mkdir+rename 过去 | 🔴 | 拒绝 + 条目留在回收站 + 目标不被创建 |
| **M1** | record 是 `{}`（缺字段）→ 抛 TypeError（被外层兜成 400） | 🔴 | 结构化拒绝，不抛 |
| **M1** | record.id 与请求 id 不一致 → 搬走别人的条目 | 🔴 | 拒绝 |
| M1-相邻×2 | 正常 record 仍能还原（含内容）；原位置被占仍 `restore-target-exists` 不覆盖 | 🟢 | 保持绿 |
| **M2** | 设了 `$DSH_HOME` 也还是去 `~/.dsh/sessions` 找 | 🔴 | sessionsRoot 跟随 DSH_HOME |
| M2-相邻×2 | 显式 config 仍优先；没 DSH_HOME 仍回落 `~/.dsh` | 🟢 | 保持绿 |
| **M3** | `compression:'none'` 部署（`session.jsonl`）删除全被判 `not-a-session` | 🔴 | 能删，进回收站 |
| M3-相邻×2 | `.zstd` 仍可删；完全没 marker 的目录仍拒（别放宽成什么都能搬） | 🟢 | 保持绿 |
| **M4** | workspace 域没打开被当成"没归档"，删除返回纯 ok（归档集永远没清） | 🔴 | ok:false + moved:true |
| M4-相邻×2 | 同情形下 unarchive 仍 `workspace-domain-unavailable`；域可读时路由层删除仍 ok | 🟢 | 保持绿 |
| **M5** | live-but-not-persisted 删除返回 ok 但回收站无凭据 → 与 `/sm/trash` 对账后已删会话又冒出来 | 🔴 | 对账后仍隐藏（tombstone 或独立码） |
| **M5** | 没有任何 `storage` 事件监听 → 双标签页不同步 | 🔴 | 有跨页同步 |
| M5-相邻×2 | 真实落盘会话删除后对账仍隐藏；`deletedIds` 仍存 localStorage（key 不改名） | 🟢 | 保持绿 |
| **L1** | 同 id 二次删除 rename 失败，回滚把**既有** record 删了 → 老条目成不可恢复孤儿 | 🔴 | 老 record 完好且仍指向老原位置 |
| L1-相邻 | 无既有 record 时失败仍不留 record | 🟢 | 保持绿 |
| **L2** | `/sm/trash` 不给 `deletedAt` | 🔴 | 暴露真实 `deletedAt` |
| **L2** | `deadline` 里装的是 `deletedAt`（等值）→ 回收站永不过期 | 🔴 | 无 deadline 或 deadline > deletedAt |
| L2-相邻 | 仍只暴露 id/title，不泄露 originalDir/projectKey | 🟢 | 保持绿 |
| **L3** | 行上已有按钮就无条件 early-return，id 冻结在注入时刻 | 🔴 | 存 id 到 dataset 并与新 action.id 比对重绑 |
| L3-相邻 | 注入仍只靠 role 锚点，不用 hash 类名 | 🟢 | 保持绿 |
| **L4** | 150 行×150 会话 → 22500+ 次 byId 读取（每行全量重扫） | 🔴 | ≤ 4×N 次（复用 idsByTitle 索引） |
| **L5** | `tsdown.config.mjs` 在 ESM 里用 `require.resolve`（裸 CSS 分支休眠 bug） | 🔴 | createRequire / import.meta.resolve |
| L5-相邻 | CSS Module 分支、lightningcss、`<style data-plugin>` 注入都还在 | 🟢 | 保持绿 |
| **L6** | `.gitignore` 忽略 `lib/`，但单测 import `lib/*.js`，测试脚本又不带构建 | 🔴 | 三者对齐（跟踪 lib ∥ 测试改指 src ∥ 脚本先 build） |
| **L6** | LEARNINGS 写"lib/ 被 git 跟踪"，`.gitignore` 却忽略它 | 🔴 | 两处一致 |

## W 系列：Windows 双平台（用户补充需求）

`tests/regression/w-windows-compat.test.mjs`。本包 path 全是静态 import，注入不了
`path.win32`，所以能平台无关表达的写行为断言（“像 Windows 绝对路径的输入必须按
Windows 语义判定”，在 macOS 上跑也成立），只有真机能触发的标 skip。

| 条目 | 复现什么场景 | 现在 | 修后预期 |
|---|---|---|---|
| **W1** | `C:\Windows\dsh-trash`、`C:\Program Files\...`、`C:\ProgramData\...` 全部放行（名单只有 POSIX 语义 + 全等比较） | 🔴 | 一律拒绝 |
| **W1** | `c:\windows\...`、`C:\PROGRAM FILES\...` 放行（Windows 路径大小写不敏感，比较却敏感） | 🔴 | 一律拒绝 |
| **W1** | `C:/Windows/dsh-trash`（Windows 也吃正斜杠）放行 | 🔴 | 拒绝 |
| **W1** | 盘根 `C:\` 与 UNC 根 `\\server\share` 放行 | 🔴 | 拒绝 |
| **W1** | 源码里没有任何 Windows 判定面（无 path.win32 / 平台分支 / 大小写归一） | 🔴 | 至少一种 |
| W1-相邻×2 | `C:\Users\bob\.dsh\session-manager-trash` 仍放行；`C:\Users\bob` 自身与 `C:\Users` 仍拒 | 🟢 | 保持绿（见冲突 4） |
| **W2** | `$DSH_HOME=C:\dsh-home` 时 sessions root 仍指向 `~/.dsh/sessions` | 🔴 | `path.join(DSH_HOME,'sessions')` |
| W2-相邻 | 默认 root 用 `path.sep` 拼接且是绝对路径（防 `${home}/.dsh` 式修法） | 🟢 | 保持绿 |
| **W3** | 全 `src/**.ts(x)` 扫描：不得有 `${x}/…` 或 `'/' +` 字面拼接（排除注释/URL/纯文件名） | 🟢 | 保持绿（当前 0 处，护栏防修复时新增） |
| **W4** | Windows 保留设备名 `CON/NUL/AUX/COM1`（含小写）能通过 id 校验 → 拿 rename/rm 去操作设备 | 🔴 | id 门直接拒 |
| **W4** | 大小写只差一字母的两个 id（`Foo`/`foo`）在大小写不敏感卷（APFS 默认 = NTFS 同款）上，第二次删除会**覆盖并回滚删掉** `Foo` 的 record → 老条目变不可恢复孤儿 | 🔴 | `Foo` 的 record 完好且仍指向自己的原位置 |
| W4-相邻×2 | 正常 id（含 `CONSOLE`/`nullify`/带点带连字符）不得被保留名规则误杀；`Foo` 的条目目录与内容仍在 | 🟢 | 保持绿 |
| W-真机×3 skip | CON/NUL 目录创建失败与 empty() 行为；`%SystemRoot%` 展开 / `PROGRA~1` 短名 / 盘符大小写；`encodeSegment`/`projectKey` 在 Windows 的落盘形态（盘符冒号折成 `-`） | ⏭ | Windows 机器上跑同一条命令 |

W4 的大小写用例会在**大小写敏感**文件系统上自动 `t.skip()`（运行时探测），所以这套
测试本身在 Linux/case-sensitive 卷上也能跑；tmpdir 豁免护栏用的是 `os.tmpdir()`
动态取值，没有硬编码 macOS 的 `/var/folders`。

## 修复时必须先决策的四个冲突（我不能改既有测试，只能上报）

1. **F2 的修法与既有锁定测试直接对撞。**
   `tests/unit/sessionRowMatch.unit.test.js:80-121`（I-6 系列）断言"两个同名行按
   ids 序绑到不同 id"，而盲审报告证明这个前提（DOM 行序=ids 序）是假的，修法是
   "同名歧义宁可不给按钮"。**这两套断言不可能同时绿**：改 F2 就必须同步退役/改写
   那 3 条 I-6 用例（连同 `DeleteButton.tsx` 头注释里的 I-6 说明）。
2. **H4 的"名单改前缀匹配"会顺手废掉所有临时目录测试。**
   macOS 的 `os.tmpdir()` 是 `/var/folders/...`（在 `/var` 下），Linux 在 `/tmp` 下——
   两者都落进拒绝名单前缀。若不显式豁免 `os.tmpdir()` 子树，
   `tests/unit/cordis-access.unit.test.js` 的 apply 用例、本套 H4b/M4 用例、CI 全部
   会变成"拒绝挂载"。我用 `H4-相邻: 系统临时目录的子目录仍然放行` 把这条要求钉住了。
3. **W1 与 H4 的名单改法必须同时兼顾两个平台的“别一刀切”。**
   POSIX 面要豁免 `os.tmpdir()` 子树（冲突 2），Windows 面要豁免 `C:\Users\<自己>`
   子树——名单里的 `C:\Users` 只能当“home 的祖先/全等”判据，一旦改成纯前缀 ban，
   Windows 上默认回收站 `C:\Users\bob\.dsh\session-manager-trash` 直接被封，插件不可用。
   两条护栏用例（`H4-相邻: 系统临时目录的子目录仍然放行`、
   `W1-相邻: Windows 上的默认回收站位置必须仍然放行`）就是这个红线。
4. **M1 的拒绝码没定。** 报告只说"加边界门 + 校验结构"，没给码名。测试接受
   `path-out-of-bounds` / `invalid-record` / `not-in-trash` / `system-error` 四者之一；
   若要新码名，改测试里的 `REFUSAL_CODES` 常量即可（行为断言不动）。

## 这套测试**没**覆盖什么（别假装全绿=没问题）

- **真实浏览器行为**：6 条 skip 在 `tests/regression/browser-e2e.skip.test.mjs`，
  文件头写了 04 之后接 playwright 的具体步骤（composer-tools 已有 playwright 可抄）。
  F2 的真实拖拽顺序、F3 的点击恢复、L3 的 React 节点复用、M5 的双标签页、H1 的刷新
  回滚，都只能在那里验。
- **F3 / L3 / M5(双页) / H1 是源码结构断言**，不是行为断言：它们能证明"入口存在/
  监听存在/限制被记录"，不能证明"点下去真的好用"。同既有
  `delete-controller-dispose.unit.test.js` 的做法一致，但这层保证更弱，务必配 e2e。
- **H1 的运行时表现**（取消归档 → 刷新 → 是否回滚）需要报告里那 2 分钟人工验证，
  node 层测不了 dsh-workspace 的内存缓存。
- **真实 storage-domain / dsh-workspace 进程**：本套用的是校准过的 stub，不是真跑
  `dsh web`。stub 只覆盖 set 的 Promise/串行/落盘顺序语义，不覆盖 zstd 编码、
  多域并发、`domain/changed` 广播链路。
- **既有 `tests/unit` / `tests/acceptance` / `tests/integration` 本次一行未跑**
  （没 node_modules → 没 `lib/`）。修完必须 `npm install && npm run build` 再跑那三套，
  确认没被这批修复带崩——尤其是上面冲突 1、2 点到的两个文件。
- **Windows 真机**：W 系列在 macOS 上验的是“平台无关可表达的那部分”（判定语义、
  id 门、大小写碰撞）。真机才能验的 3 条已 skip：设备名目录、`%SystemRoot%`/8.3 短名/
  盘符大小写、`encodeSegment`/`projectKey` 的 Windows 落盘形态。Windows 上跑的命令与
  macOS 完全相同（`node --test "tests/regression/*.test.mjs"`），W4 大小写用例在
  case-sensitive 卷上自动 skip。
- **Windows 上的文件锁/占用语义**（被打开的会话文件 rename 会 EBUSY/EPERM，POSIX 不会）
  完全没覆盖——这是 Windows 上最可能新增的失败模式，建议真机专门补一条。

## 文件清单

| 文件 | 管什么 |
|---|---|
| `tests/regression/_harness.mjs` | TS 源加载 hook、临时目录、**真实语义的 workspace 域 stub**、cordis ctx、路由 POST 驱动 |
| `tests/regression/_env.mjs` | handler 级环境（真实 sessions 树 + TrashStore + 注入 stub） |
| `tests/regression/f1-h2-archive-write.test.mjs` | F1（5 红 + 4 相邻）、H2（2 红 + 1 相邻） |
| `tests/regression/f2-l4-row-binding.test.mjs` | F2a/b/c（5 红 + 5 相邻）、L4（1 红） |
| `tests/regression/f3-h1-l3-m5-client.test.mjs` | F3（2 红 + 2 相邻）、H1（1 红 + 1 相邻）、L3（1 红 + 1 相邻）、M5 双页（1 红 + 1 相邻） |
| `tests/regression/h3-h4-l1-trash.test.mjs` | H3（2 红 + 2 相邻）、H4（2 红 + 5 相邻）、L1（1 红 + 1 相邻） |
| `tests/regression/m1-m5-l2-handler.test.mjs` | M1（3 红 + 2 相邻）、M2（1 红 + 2 相邻）、M3（1 红 + 2 相邻）、M4（1 红 + 2 相邻）、M5 幽灵行（1 红 + 1 相邻）、L2（2 红 + 1 相邻） |
| `tests/regression/l5-l6-repo-config.test.mjs` | L5（1 红 + 1 相邻）、L6（2 红） |
| `tests/regression/w-windows-compat.test.mjs` | W1（5 红 + 2 相邻）、W2（1 红 + 1 相邻）、W3（1 护栏绿）、W4（2 红 + 2 相邻）、3 条真机 skip |
| `tests/regression/browser-e2e.skip.test.mjs` | 6 条 skip + playwright 接线说明 |
