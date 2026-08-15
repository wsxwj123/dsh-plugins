# TEST-PLAN — dsh-composer-tools 验收测试清单（人话版）

给用户看的测试清单。每条一行：场景 / 怎么操作 / 预期看到什么。
分「正常路径 / 边界 / 错误路径 / 反向用例 / 幂等并发」五组。

## 怎么跑这套测试

```bash
cd packages/dsh-composer-tools
node --test "tests/acceptance/*.test.mjs"
```

不装任何依赖，纯 Node 内置（node:test + node:assert + node:http）。
注意：测试目前驱动的是 `tests/acceptance/helpers/` 里的**契约参考实现**
（把 INTERFACE.md 的契约逐字实现成可执行代码，当基准）。
真实插件写完后，把各 `*.test.mjs` 顶部那一行 import 源换成插件实际导出的
同名函数/HTTP 路由即可，**断言一行都不用改**。

目前共 **131 条用例**，三块：host HTTP 契约（55）、client 纯函数契约（64）、
cordis 访问纪律（6）+ 指令发现纯函数（12 并入 host 侧辅助）。

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
