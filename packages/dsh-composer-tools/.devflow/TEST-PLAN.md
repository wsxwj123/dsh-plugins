# TEST-PLAN — dsh-composer-tools 验收测试清单（人话版）

给用户看的测试清单。每条一行：场景 / 怎么操作 / 预期看到什么。
分「正常路径 / 边界 / 错误路径 / 反向用例 / 幂等并发」五组。

## 怎么跑这套测试

```bash
cd packages/dsh-composer-tools
node --test "tests/acceptance/*.test.mjs"
```

不装任何依赖，纯 Node 内置（node:test + node:assert + node:http）。
**接线状态（已接驳真实实现）**：`tests/acceptance/helpers/` 里的 contractHost/contractClient
**不再是契约参考实现**，而是真实实现的转发层——contractHost 用真实 `createCtHandler`（lib/handler.js）
驱动 ROUTER，discover 纯函数 re-export 自 lib/instructions.js；contractClient 的 gate/history-core/
history-storage/append 全部 re-export 自 lib/*.js。因此 131 条验收用例验证的就是**真实插件代码**
（断言行未动，仅 helpers 接驳层切换，属 T11 既定步骤）。白盒单测（tests/unit）同样直接 import 真实 lib/*。

目前共 **131 条用例**，三块：host HTTP 契约（55）、client 纯函数契约（64）、
cordis 访问纪律（6）+ 指令发现纯函数（12 并入 host 侧辅助）。
另有**第三层真实环境 e2e**（tests/e2e/，playwright + 真实 dsh web 独立 profile）7 条：
插件加载无错 / /ct RPC 真实返回 / 780 条+AGPL / 输入框 data-phase 锚点 / 面板按钮注入 /
真实按键 ↑ 回填历史 / 面板打开渲染双 tab。

---

## 一、正常路径（应该跑通、该返回 200 ok:true）

| # | 场景 | 怎么操作 | 预期看到什么 |
|---|---|---|---|
| 1 | 指令文件发现 | 造一个含 `.git` 的项目根 + 若干层 AGENTS.md/CLAUDE.md，POST `/ct/instructions.list` | 返回全部存在文件，全局在**最前**，随即项目根→子目录→更深，同目录常规文件在 `.local` 之前 |
| 2 | 发现返回字段 | 看每个文件 | 有 path / displayPath / level / name / sizeBytes / mtimeMs，类型都对 |
| 3 | 读指令文件 | POST `/ct/instructions.read` 传合法 path | 返回原文 content、path、mtimeMs、truncated:false；`\r\n` 原样保留 |
| 4 | 编辑保存 | POST `/ct/instructions.save` 传对得上的 expectedMtimeMs | 返回 ok:true + 新 mtimeMs；文件内容被写成新版本 |
| 5 | 保存后文件真变了 | 读磁盘文件 | 内容与提交一致 |
| 6 | 提示词库下发 | POST `/ct/prompts` | 返回 source（含 Cherry Studio 地址 + **AGPL-3.0**）、items 全量 |
| 7 | 提示词换行归一 | 看返回的 description/prompt | 源里的 `\r\n` 全变成 `\n` |
| 8 | 方向键——单行 | 单行输入按 ↑ / ↓ | 直接翻历史（older / newer），不关心光标在哪列 |
| 9 | 方向键——多行首行 | 光标在第一行任意列按 ↑ | 翻到更旧一条 |
| 10 | 方向键——多行末行 | 光标在末行任意列按 ↓ | 翻到更新一条 |
| 11 | 历史首条 | 发送一条消息 | 内容 trim 后去重 unshift 到最前，记入历史 |
| 12 | 翻到底找回草稿 | ↑ 翻若干条后按 ↓ 到底 | 文字回到进历史前的草稿 |
| 13 | 历史持久化 | 翻过历史后 | 状态机 cursor/stash/pending 符合文档，纯函数不改入参 |
| 14 | localStorage 读写 | load/save 历史 | key 为 `dsh-composer-tools:history:<sessionId>`，能存能读回 |
| 15 | 提示词追加 | 点提示词"发送到输入框" | 追加到末尾；空输入直接放；已有内容前空一行，不覆盖不丢字 |
| 16 | 指令发现——死目录 | cwd 指向已被删的目录 | 不报错，ok:true，projectRoot=resolve(cwd)，只列全局文件 |

## 二、边界（临界值、特殊输入）

| # | 场景 | 怎么操作 | 预期看到什么 |
|---|---|---|---|
| 17 | 正好 1MB | 读一个恰好 1048576 字节的文件 | truncated:false，全文下发 |
| 18 | 超过 1MB | 读一个 >1MB 的文件 | truncated:true + 最长合法 UTF-8 前缀（不劈在多字节字符中间） |
| 19 | 保存 1MB 内容 | save 一个恰好 1MB 的新内容 | 允许写入 |
| 20 | 一个文件都没有 | 在无任何指令文件的地方 list | files:[]，仍然 ok:true |
| 21 | `.git` 是文件 | 项目根标记是普通文件而不是目录 | 同样被识别为项目根 |
| 22 | 历史 100 条上限 | 塞 100+ 条再 commit | 裁到 100 条，最旧的丢掉 |
| 23 | 空 history + ↑ | 从没有历史开始按 ↑ | 放行（null），不拦截 |
| 24 | 历史去重 | 重复发同一条消息 | 旧条目被去掉，新的置顶 |
| 25 | 追加空 prompt | prompt 为空串追加 | 不覆盖，结尾补空行 |
| 26 | 命令菜单打开 | menuOpen=true 时任意方向键 | 放行（null），方向键归菜单 |
| 27 | 有选区 | 输入框有选中文字按 ↑ | 放行，不翻历史 |
| 28 | IME 合成 | 中文输入法选字时按 ↑/↓ | 放行，不误触 |
| 29 | 修饰键 | 按住 shift/cmd/ctrl/alt 按 ↑/↓ | 放行 |
| 30 | 非输入框目标 | 光标在面板编辑框按方向键 | 放行（不劫持面板编辑） |

## 三、错误路径（必须被精确拒绝，不能崩、不能静默出错）

| # | 场景 | 怎么操作 | 预期看到什么 |
|---|---|---|---|
| 31 | 跨站请求 | Sec-Fetch-Site: cross-site | **403**，纯文本 `forbidden` |
| 32 | 伪造 Host | Host 填成非 loopback 域名 | **403** `forbidden` |
| 33 | 跨源 Origin | Origin 与 Host 不同源 | **403** `forbidden` |
| 34 | 非 POST | 发 GET/PUT | **405** + header `allow: POST` + `method not allowed` |
| 35 | 没有方法名 | 请求 `/ct/` 或 `/ct` | **404** 纯文本 `not found` |
| 36 | body 超 2MB | 发超 2MB 的 body | **413** `payload-too-large`，报错文案逐字匹配 |
| 37 | 非法 JSON | body 不是合法 JSON | **400** `bad-request / invalid JSON` |
| 38 | 方法不存在 | 请求 `/ct/xxx` | **404**，字段叫 `error`（不是 code，历史形态） |
| 39 | cwd 非法 | cwd 是相对路径/缺失/非字符串 | **400** `invalid-cwd`，文案逐字 |
| 40 | path 非法 | 读/存一个 basename 不在白名单的路径 | **400** `invalid-path`，文案逐字 |
| 41 | 路径越界 | 读/存项目**根范围之外**的 AGENTS.md | **200** `path-out-of-scope`，文案逐字 |
| 42 | 文件不存在 | save 一个不存在的文件 | **领域级拒绝**（code 为范围/不存在类），**绝不创建新文件** |
| 43 | 截断保护 | save 一个 >1MB 的旧文件且未开 allowTruncatedBase | **200** `file-truncated`，提示用外部编辑器；文件不被改动 |
| 44 | mtime 冲突 | expectedMtimeMs 与磁盘当前不等 | **200** `mtime-conflict` + currentMtimeMs，文件不被写 |
| 45 | content 非法 | content 非字符串或超 1MB | **400** `invalid-content`，文案逐字 |
| 46 | mtime 非法 | expectedMtimeMs 为 NaN/负数/字符串 | **400** `invalid-mtime`，文案逐字 |
| 47 | 布尔字段非法 | allowTruncatedBase 传非布尔 | **400** `invalid-allow-truncated-base`，文案逐字 |
| 48 | 提示词数据读不了 | 环境里提示词数据文件读失败 | **200** `system-error`，message 以 "prompt library unavailable: " 开头 |
| 49 | 读不可读文件 | 文件无读权限（非 root） | **200** `system-error` |
| 50 | 面板/注入服务 | 试图裸访问未 inject 的 cordis 属性 | 抛 `cannot get property "..." without inject` |
| 51 | logger 跨回调 | 把 ctx.logger.debug 存成局部变量跨异步回调裸调 | 抛 `this is not a function`（必须现取） |

## 四、反向用例（断言"不该发生的没发生"）

| # | 场景 | 怎么操作 | 预期看到什么 |
|---|---|---|---|
| 52 | save 不建新文件 | 对一个不存在的路径 save | 文件仍不存在，磁盘没被写 |
| 53 | save 不写出根范围 | 对项目外的文件 save | 项目外文件内容**不动** |
| 54 | 符号链接不被收录 | 项目根内放一个指向外部的 `AGENTS.md` symlink | list 里看不到它；read/save 判越界；**目标文件不被写** |
| 55 | ← → 永不触发 | 按左右键 | 永远返回 null（不拦截） |
| 56 | dropPending 不误录 | 发送失败后 drop | pending 清空，条目不进 entries |
| 57 | 空/纯空白不录历史 | 发送一条纯空白的消息 | 不被 capture（pending 仍空） |
| 58 | 多余请求字段 | 请求体带文档没说的字段 | 被忽略，不报错 |

## 五、幂等 / 并发

| # | 场景 | 怎么操作 | 预期看到什么 |
|---|---|---|---|
| 59 | 重复请求提示词 | 连发两次 /ct/prompts | 两次 items 一致（缓存语义） |
| 60 | 重复发现 | 同一 cwd 多次 list | 结果一致、无脏数据 |
| 61 | 并发写冲突 | save 成功后外部改了文件，再 save | 第二次 `mtime-conflict`，不覆盖外部修改 |
| 62 | 双会话历史隔离 | 两个 sessionId 各存各的 | 互不覆盖，各自读回 |
| 63 | 测试可任意顺序 | 整套测试乱序跑 | 各自独立、互不依赖、全部通过 |

---

## 没覆盖什么（诚实声明）

1. **UI/DOM 交互（F1 翻历史、F2 面板、F3 面板 tab）没测**：本层是 node --test，
   只测 gate.ts 门槛判定 + 状态机 + localStorage + 追加，"真正的浏览器里按 ↑ 真的
   翻动了输入框"必须靠第三层"真实环境 e2e"（playwright + 假接收端）补。
2. **真实 cordis 运行时**：访问纪律用严格替身模拟，模拟不到 cordis 真实 fiber/
   inject 语义，必须在 headless profile 真实加载插件守门（三层防线第三层）。
3. **file-not-found 这个竞态分支**：INTERFACE 判定序里"范围检查在 file-not-found
   之前"，而发现集合是实时的——不存在的文件同时也不在集合内，会先命中
   path-out-of-scope。file-not-found 只在"发现后、读前文件刚好被删"的窗口出现，
   无法稳定复现，单测只保证"被删文件被领域级拒绝、不建新文件"。
4. **写权限的 system-error**：单测覆盖无读权限；写侧 IO 失败（如磁盘只读）在
   CI 环境难稳定触发，未专项覆盖（契约已保留该分支）。
5. **斜杠命令菜单抢占「真实渲染」**：menuOpen 判定它依赖读 textarea 的 data-phase
   且 fail-safe 按 true 处理，这个属 DOM/平台约定（INTERFACE §3），不是纯函数能测的，
   留给 e2e。
6. **剪贴板写失败反馈（writeClipboard）**：属浏览器 API，未在 node 层测。
7. **真实 780 条提示词数据文件**：本测试用参考实现注入的样例 items 验证契约形状
   （字段/换行/许可标注），不含真实 Cherry Studio 780 条数据文件本身。

## 改动清单（本次产出）

- `tests/acceptance/helpers/fixture.mjs` —— 临时目录/文件/symlink 夹具
- `tests/acceptance/helpers/http.mjs` —— 本地 HTTP 服务 + 请求驱动
- `tests/acceptance/helpers/contractHost.mjs` —— host 契约参考实现（§0/§1/§2.4）
- `tests/acceptance/helpers/contractClient.mjs` —— client 纯函数契约参考实现（§2.1/2.2/2.3/2.5）
- `tests/acceptance/helpers/scenarios.mjs` —— 项目树场景构建
- `tests/acceptance/test-01-host-transport.test.mjs` —— 传输层公共契约
- `tests/acceptance/test-02-host-list.test.mjs` —— /ct/instructions.list
- `tests/acceptance/test-03-host-read.test.mjs` —— /ct/instructions.read
- `tests/acceptance/test-04-host-save.test.mjs` —— /ct/instructions.save
- `tests/acceptance/test-05-host-prompts.test.mjs` —— /ct/prompts
- `tests/acceptance/test-06-client-gate.test.mjs` —— 方向键门槛
- `tests/acceptance/test-07-client-history-core.test.mjs` —— 历史状态机
- `tests/acceptance/test-08-client-history-storage.test.mjs` —— localStorage
- `tests/acceptance/test-09-client-append.test.mjs` —— 提示词追加
- `tests/acceptance/test-10-discover-pure.test.mjs` —— 指令发现纯函数（§2.4）
- `tests/acceptance/test-11-cordis-discipline.test.mjs` —— cordis 访问纪律（严格替身）

---

## 增量：新建项目级 AGENTS.md（新增 /ct/instructions.create 端点 + list 增补字段）

新增端点：POST `/ct/instructions.create`，body 仅 `{cwd}`，落盘目标由 host 按项目根推导。
新增 list 字段：`projectRootFound`（是否有真项目根）、`canCreateRootAgents`（client 显示「新建项目级 AGENTS.md」入口的唯一信号）。
带 ⭐ 的是我替你想到、需求没明说的验收点。

### 正常路径

| # | 场景 | 怎么操作 | 预期看到什么 |
|---|---|---|---|
| A1 | 正常创建 | 造一个含 `.git` 的项目根、cwd 指向其子目录，POST `/ct/instructions.create` | 200 `{ok:true, path, content, mtimeMs}`；content 是定死的 2 行模板全文；`<项目根>/AGENTS.md` 真的出现在磁盘上 |
| A2 | 磁盘内容抽查 | 创建后读磁盘文件 | 内容逐字等于模板，不多不少 |

### 边界

| # | 场景 | 怎么操作 | 预期看到什么 |
|---|---|---|---|
| B1 | cwd 就是项目根 | cwd=项目根创建 | 成功，落在 `<项目根>/AGENTS.md` |
| B2 | cwd 是项目根子目录（多层最深） | cwd 指向最深层 | 仍创建到项目根，不是 cwd |
| B3 | worktree：项目根用 `.git` 文件（非目录）⭐ | `.git` 写成普通文件作标记 | 识别为项目根，创建成功 |

### 错误路径

| # | 场景 | 怎么操作 | 预期看到什么 |
|---|---|---|---|
| C1 | cwd 非法 | 传相对路径/空串/非 string | 400 `invalid-cwd`，逐字文案 |
| C2 | 无项目根 | cwd 祖先链没有任何 `.git`（如临时目录） | 200 `no-project-root`，逐字文案，**且不落盘** |
| C3 | 根 AGENTS.md 已有 | 先写一个项目根 AGENTS.md 再创建 | 200 `path-exists`，原文件不被覆盖 |
| C4 | 根 AGENTS.md 被目录占用 ⭐ | 用一个**目录**占住 AGENTS.md 路径 | 200 `path-exists` |
| C5 | 根 AGENTS.md 是 symlink ⭐ | 把 AGENTS.md 做成指向项目外的符号链接 | 200 `path-exists`，**绝不跟随链接写**，链接目标文件保持原样 |
| C6 | 写入失败 ⭐ | 把项目目录设成只读再创建 | 200 `system-error`，message=String(err)，磁盘不产生文件（root 环境自动跳过） |

### 反向用例

| # | 场景 | 怎么操作 | 预期看到什么 |
|---|---|---|---|
| D1 | 不接受客户端 path | body 里带 `path`（甚至越界路径）+ 多余字段 | 仍按推导的项目根目标创建，客户端传的 path 不产生任何文件 |
| D2 | 不创建到项目根之外 ⭐ | cwd 经 symlink 目录抵达项目 | realpath 校验后文件物理落在真实项目根内，不落项目根外 |

### 幂等 / 并发

| # | 场景 | 怎么操作 | 预期看到什么 |
|---|---|---|---|
| E1 | 同 cwd 连调两次 | POST 两次 | 第一次 ok，第二次 `path-exists`，内容不被二次改写 |
| E2 | 并发同 cwd ⭐ | `Promise.all` 同时发两个 create | 恰好一个 ok、一个 `path-exists`，文件内容仍是完整模板（不追逐覆盖） |

### list 增补字段

| # | 场景 | 怎么操作 | 预期看到什么 |
|---|---|---|---|
| F1 | 有项目根、无 AGENTS.md | 建项目根，POST list | `projectRootFound=true`、`canCreateRootAgents=true`（显示新建入口） |
| F2 | 无项目根 | cwd 在无 `.git` 目录 | 两者都 `false`（隐藏入口） |
| F3 | 有项目根且 AGENTS.md 已有 | 先建根 AGENTS.md 再 list | `true/false`（已存在 → 无新建入口） |
| F4 | 根 AGENTS.md 是 symlink ⭐ | symlink 占住 AGENTS.md 再 list | `true/false`（symlink 视为已存在，不显示入口怕误导） |

### 与 save 的衔接

| # | 场景 | 怎么操作 | 预期看到什么 |
|---|---|---|---|
| G1 | create→save 编辑流 | 用 create 返回的 mtimeMs 当 save 的 expectedMtimeMs 改内容 | save 成功，内容写入 |
| G2 | 创建后被外部改再 save ⭐ | create 后外部改文件再 save | mtime 乐观锁照常拦截，返回 `mtime-conflict` |

> 本增量共 **22 条**验收用例（新增 `tests/acceptance/test-12-host-create.test.mjs`）。当前 feature 未实现，测试对现有 router **全红（端点返回 404）**，属预期——开发实现后应转绿。未覆盖：write 的 `EROFS` 只读文件系统分支（难稳定构造，`EACCES` 只读目录已覆盖 system-error 类）；`file-not-found` 竞态分支（create 原子 `wx` 天然规避，无需）。

## 增量 2：全局新建 + 删除 + 返回流程

新增端点：`/ct/instructions.create` 支持 `scope:'project'|'global'`（缺省 `'project'`，目标分别 `realpath(projectRoot)/AGENTS.md`、`realpath(dshHome)/AGENTS.md`）；新增端点 `/ct/instructions.delete`（收 path，白名单 + 发现集合 + 父目录 realpath 包含性三重闸门）；list 新增 `canCreateGlobalAgents`（client 显示「新建全局 AGENTS.md」入口的唯一信号）；client 增 `instructionViewReducer` 视图状态机（§2.6）。带 ⭐ 的是我替你想到、需求没明说的验收点。

### 正常路径

| # | 场景 | 怎么操作 | 预期看到什么 |
|---|---|---|---|
| A1 | 全局新建正常 | dshHome 无 `AGENTS.md`，POST `/ct/instructions.create` + `scope:'global'` | 200 `{ok:true, path, content, mtimeMs}`；content 是定死的全局 2 行模板全文；`~/.dsh/AGENTS.md`（测试用假 home）真落盘 |
| A2 | 全局新建→再建幂等 | 同目标再 create | 200 `path-exists`，文案「global AGENTS.md already exists; create refused to overwrite」，内容不被改写 |
| B1 | 删项目级文件 | 删一个已发现的项目级 AGENTS.md | 200 `ok:true`，文件从磁盘消失 |
| B2 | 删全局文件 ⭐ | 删 dshHome/AGENTS.md | 200 `ok:true`，全局文件消失 |
| B10 | 无 .git 的 cwd 删全局 | cwd 祖先链无 `.git` 删全局文件 | 全局不依赖项目根，仍 `ok:true` |

### 边界

| # | 场景 | 怎么操作 | 预期看到什么 |
|---|---|---|---|
| A4 | scope 缺省兼容 ⭐ | 不传 scope 调 create | 行为等同 `'project'`，落到项目根 `AGENTS.md`，不落 dshHome（向后兼容新增前行为） |
| A7 | 无 .git 建全局 | cwd 祖先链无 `.git`，`scope:'global'` | 全局新建不要求项目根标记，成功建到 dshHome |
| A5 | 全局已存在 | dshHome 已有 AGENTS.md 再建全局 | 200 `path-exists`（global 文案），原文件不被覆盖 |
| A6 | 全局被 symlink 占用 ⭐ | dshHome/AGENTS.md 是 symlink | 200 `path-exists`，绝不跟随链接写，链接目标保持原样 |

### 错误路径

| # | 场景 | 怎么操作 | 预期看到什么 |
|---|---|---|---|
| A3 | scope 非法 | scope 传 `xxx`/空串/非字符串 | 400 `invalid-scope`，文案逐字 |
| B3 | path basename 非法 | 删 `FOO.md`/`README.md` 等白名单外 | 400 `invalid-path`，文案逐字 |
| B4 | path 不在发现集合 | 删项目根内但不在发现链上的 AGENTS.md | 200 `path-out-of-scope`，磁盘文件不动 |
| B5 | path 是 symlink | 删一个指向项目外的 AGENTS.md symlink | 200 `path-out-of-scope`，symlink 与其目标都不被删 |
| B6 | 父目录链 symlink 越界 ⭐ | `tmp/A`(有 .git) 下建 symlink `lnk`→指向 `tmp/B`(无 .git); 用词法 `tmp/A/lnk/deep/AGENTS.md` 当 path | 父目录 realpath=`tmp/B/deep` 不在 `realpath(projectRoot)=tmp/A` 下 → 200 `path-out-of-scope`；真实物理文件 `tmp/B/deep/AGENTS.md` 完好 |
| B7 | 文件不存在 → file-not-found | 删除时刻文件已不存在（并发窗口卸载映射） | 200 `file-not-found`，文案逐字 |

### 反向用例

| # | 场景 | 怎么操作 | 预期看到什么 |
|---|---|---|---|
| A8 | create 不收 path | create 带越界 `path` + 多余字段 | 按 scope 推导目标落盘，客户端传的 path 不产生文件 |

### 幂等 / 并发

| # | 场景 | 怎么操作 | 预期看到什么 |
|---|---|---|---|
| B8 | 并发双删同一 path ⭐ | `Promise.all` 对同一 path 发两个 delete | 恰好一个 `ok:true`、一个 `file-not-found`；永不双 ok、永不双删 |
| B9 | 并发删不同 path | 同 cwd 并发删 AGENTS.md 与 CLAUDE.md | 各自独立 `ok:true`，互不影响 |

### client 视图状态机（§2.6）

| # | 场景 | 怎么操作 | 预期看到什么 |
|---|---|---|---|
| D1 | 主流程 | list → 全局新建 → pending → create 成功 → 编辑改脏 → 保存 | 返回 list；`create` 成功后 `dirty` 不置位，编辑后才 `dirty:true` |
| D2 | 编辑→放弃 | open-edit → mark-dirty → cancel-edit | 回 list（草稿丢弃确认属调用层） |
| D3 | 防重复点击 | 重复 `start-create` 同 scope | 原样返回；换 scope 才新建 create 态 |
| D4 | create 失败 | create-failed 事件 | 回 list（错误调用层提示） |

> 本增量新增 `tests/acceptance/test-13-host-create-global-delete.test.mjs`（共 31 条：create global 8 / delete 10 / list 增补 5 / reducer 8）。当前增量 2 未实现，create-global/delete/canCreateGlobalAgents 走真实 ROUTER **全红**（现存 create 端点忽略 scope、delete 端点 404、list 无新字段）；`scope` 缺省 A4 因增量 1 已实现而**绿**；reducer §2.6 尚未实现、contractClient 未导出，D 组驱动本文件内置参考 reducer（绿），实现落地后换接 seam。未覆盖：write 全局 `EROFS`/`EACCES` 只读分支（难稳定构造）；`file-not-found` 单靠顺序调用无法稳定复现——按契约并发双删锚定（B7/B8 都证明该映射）；全局新建/删除的 `window.confirm` 二次确认文案属 client DOM/UI 层，node 验收不覆盖（留给 e2e）。
