# Project learnings

- Theme family selection and appearance mode are separate concerns: the plugin selects a family with `overrideTokens()`, while DSH owns Light, Dark, and Follow system.
- Every public family must provide complete `{ light, dark }` token pairs; do not expose single-mode families when native system following is required.
- Keep the public gallery small and visually distinct. Editor syntax-theme differences often collapse into near-duplicate conversational UI palettes.
- Public package metadata, theme IDs, generated data, documentation, and Git authorship must remain source-neutral and privacy-safe.

## dsh-session-manager 开发教训（2026-08-14）

- **同一仓库并行开发两个插件分支（theme-gallery 的 feature/full-skin-replica 与 dsh-session-manager 的 feat/）会互相"顶掉"工作树**：切换分支后另一分支的未跟踪目录会"消失"，已提交文件则随分支切换不见，容易误判为丢失。已发生两次（子代理会话开始时工作树被切到 main / feature/full-skin-replica）。缓解：并行开发前先确认当前分支；用 `git reflog` 排查"文件消失"；分仓库或 worktree 隔离更稳。
- **`node --test <目录>` 会把目录当模块报 MODULE_NOT_FOUND**（node v25），必须用 glob（`node --test "tests/**/*.test.js"`）或 `node --test` 自动发现。
- **官方 `connection.rpc.handle` 是 envelope 协议（{type,rpcId,method,payload}），不是裸 HTTP**——自定义 HTTP 契约的插件要么走裸路由+自实现 fence，要么重写契约迁就官方协议，二者不可兼得（本插件选了前者）。
- **DSH 真实会话目录名是编码名（projectKey→`--…--`、encodeSegment→`~XXXX`），字面 join(root,cwd,id) 定位不到**——按契约写的路径解析必须在真实环境联调验证。

## [LRN-20260817] client 懒加载入口包必须自带 __ModuleLoader__ 注册壳（skin-gallery 实爆）
- 现象：dsh 启动报 `failed to import loader entry (dsh-skin-gallery): client-modules: bundle loaded without registering "dsh-skin-gallery" via __ModuleLoader__.load`，皮肤设置项不加载。
- 根因：懒加载拆分重构（9d4743a/ce1151f）后 lib/client.js 手工产出，丢了包装壳。dsh 校验的是 bundle 执行后必须调 `window.__ModuleLoader__.load({ id: "<包名>", factory: (require) => {...} })` 自注册；壳内还需 `const React = require('react')`（裸代码直接用 React）。
- 铁律：**lib/client.js ≠ src/client.js**——lib 版必须比 src 多包一层壳（参照 theme-gallery / skin-runtime 的 lib/client.js 头尾）。"align source with built bundle" 时严禁把 lib 直接覆盖成 src 原文。
- 已修：2026-08-17 给 lib/client.js 补壳（未提交，见 git diff）。

## [LRN-20260819-A] 宿主会给未打标的 `<style>` 盖 `data-plugin` 印章 → 卸载皮肤时误删插件自己的样式

- **现象**：应用皮肤后点「恢复默认主题」，整页样式塌陷（布局全无、按钮变浏览器默认样式），面板本身也变裸 HTML。
- **根因（两个，缺一不可）**：
  1. `custom-theme.js` 的 `restoreDefaultTheme` / `activateFamily` 只写 `track='theme'`，**从不卸载正在生效的皮肤**——皮肤 CSS 还在渲染，但它依赖的 token 已被主题重置。
  2. DSH 宿主把 head 里**未打标**的 `<style>` 统统盖上 `data-plugin=<当时正在加载的包>`。本插件自己的 `<style data-appearance-gallery>` 被盖成 `data-plugin=@linxin666/dsh-client-ui-skin-miku`，`deactivateSkin` 按 `data-plugin` 选皮肤样式时把它一起删了。
- **修法**：apply 层加唯一切轨闸 `enterThemeTrack({persist})`，所有 `writeTrack('theme')` 路径必经；`deactivateSkin` 改为只回收「`data-plugin` 命中 ∩ 本次激活期间新出现」的 style。
- **为什么 25 条软互斥验收测试全绿却漏了**：契约桩里「写了 track 就算互斥」，没验证真实 DOM 清理。**跨轨切换必须断言前一轨的 DOM 痕迹清零**（body `data-dsh-*` 数 0、皮肤 style 数 0），不能只断言 storage 键。

## [LRN-20260819-B] 普通消息发送不改变 input phase → 依赖 phase 迁移的采集永远不执行

- **现象**：composer-tools 方向键历史「一直是空的」，但注入一条历史后按 ↑ 能正常回填——读取/回填/gate/事件监听全部正常，只有写入侧从没执行过。
- **根因**：`dsh-client-ui-conversation` 的 `onEnter(mode)`：`trimmed.startsWith('/')` 才进 `adjudicating`，普通消息走 `return [{type:'default-sink'}]`，**phase 全程保持 `plain`**。而插件采集条件是 `(p==='submitting'||p==='adjudicating') && p!==prevP`，对普通消息永不成立。
- **修法**：采集改走会话快照订阅（新 user 节点），不依赖 phase 迁移。注意 keydown 方案覆盖不全——发送按钮点击（`inputActions.submit()`）根本没有 keydown，且含 @chip 的 draft 抓到的是占位符。
- **教训**：250 项测试全绿是因为测试用插件自造的 phase 序列驱动，与真实宿主行为不符。**测试替身必须按宿主真实行为校准**。

## [LRN-20260819-C] 框架包 peer 范围必须显式匹配预发布版，通配符匹配不到

- **实证**（semver）：`satisfies('0.1.0-rc.6','*')` → **false**；`satisfies('0.1.0-rc.6','>=0.0.0')` → **false**；`satisfies('0.1.0-rc.6','^0.1.0-rc.6')` → true。node-semver 只有当范围中存在同 `major.minor.patch` 且自带预发布标签的比较符时才放行预发布版本。
- **影响**：DSH 全线是 `0.1.0-rc.6` 预发布版，写 `"*"` 等于这条 peer **永远不满足**；在 monorepo 根跑 `pnpm install --lockfile-only` 时，8 个框架包被写进 importers 的 `dependencies` 段。
- **正确写法**（与社区已发布插件一致）：`@deepseek-ai/cordis: ^4.0.1`（正式版），其余 `@deepseek-ai/dsh-*: ^0.1.0-rc.6`。
- **纠偏**：A/B 实测（干净环境、无 `.npmrc`）两种写法的用户安装都是 0 副本，**`"*"` 并不会让用户安装时崩**——曾据此对用户做过夸大表述，已纠正。改动的真实价值是语义正确 + 与社区一致 + 规避 awesome 文档警告的 npm `ERESOLVE`。
- 仓库根 `.npmrc` 保留 `auto-install-peers=false` 作为开发期护栏。

## [LRN-20260819-D] 包/目录改名会断掉 profile 的 link，必须重装 + 重启 web

- 把 `packages/turn-scrubber` 改名为 `dsh-turn-scrubber` 后，`~/.dsh/profiles/web/node_modules/dsh-turn-scrubber` 成为悬空软链，页面报 `failed to import loader entry ... bundle script failed to load`。
- **改名清单**：`package.json` 的 `name`、`cordis.patch.yml` 的 `name` 字段（DSH 靠它找包）、profile 重新 `dsh plugin add`、**重启 `dsh web`**（运行中的进程持有启动时的路径映射，只改 profile 不重启无效）。
- 产品文案里写死的仓库路径（如 designSummary 的 `packages/<x>/skins/`）也要同步，连带测试期望值。

## [LRN-20260819-E] awesome-dsh-plugin 提 PR 的三个硬约束

1. **README 是生成的，禁止手改**：数据在 `data/plugins/<owner>__<repo>.yml`，改完必须 `npm ci && node scripts/generate-readme.mjs` 一起提交。手改会被打回。
2. **stale-fork guard**：CI 统计 README 条目行 diff，`removed > 2 && removed > added` 即判定 fork 陈旧并失败。一次合并 2 条 + 改名 2 条 = -4/+3 会被拦；**拆成多个 PR**（改名 -2/+2、合并 -2/+1）各自都在阈值内。等量修改（-5/+5）不触发。
3. **fork 要跟得上**：该仓每天新增几十条，基线落后会 `CONFLICTING`。生成文件冲突不要 rebase 解冲突，直接 `git checkout -B <branch> upstream/main` 重做改动更干净。
- `data/screenshots.json`：key 必须逐字等于 README 里的条目链接，图片限 GitHub 域名、每条 1-8 张；**追加时不要重排整个文件**（重排会产生 1882 行 diff，违反「只改自己那条」）。
