# dsh-composer-tools

DSH web 输入体验增强插件：**方向键输入历史** + **指令查看/编辑面板** + **提示词库**。

给 DSH（DeepSeek Harness）的输入框加三个实用功能，全部本地运行、不联网、不需要密钥。

---

## 功能

### 1. 方向键输入历史

在输入框按 **↑ / ↓** 翻看本会话发过的输入，像 shell 历史一样：

- **↑** 翻更旧的输入，**↓** 翻回更新的（到底恢复你正在编辑的草稿）
- **单行输入**：直接触发（无论光标在哪）
- **多行输入**：光标在**第一行**按 ↑ 才翻历史、光标在**最后一行**按 ↓ 才翻——光标在中间行时按键正常移动光标，不会误翻
- **← → 永不触发**；中文输入法选字时不误触；命令菜单打开时方向键归菜单
- 历史按会话隔离、刷新后仍在（localStorage），每会话最多 100 条
- **0.2.2 兼容**：DSH 0.2.2 把输入框换成 Lexical 富文本 `contenteditable`，插件通过 composer 适配层（`src/client/composer-target.ts`）同时支持旧 `textarea` 与新编辑器——文本/光标口径、菜单判据、回填后光标复位都在适配层收敛

### 2. 指令查看 / 编辑面板

输入框工具区的 **🧩 按钮**打开面板，查看当前会话实际生效的指令：

- **全局**：`~/.dsh/AGENTS.md`
- **项目**：项目根（`.git` 标记）到当前目录每层的 `AGENTS.md` / `CLAUDE.md` / `AGENTS.local.md` / `CLAUDE.local.md`
- 跨文件**全文搜索**（文件+行号+片段，点击跳转）
- **编辑保存**：全局和项目级指令文件都可改（保存前有确认，mtime 冲突会提示重载/覆盖，超 1MB 的文件提示用外部编辑器防静默丢尾）

### 3. 提示词库（同一面板的第二个 tab）

内置 **780 条中文提示词**（源自 [Cherry Studio agents-zh.json](https://github.com/CherryHQ/cherry-studio)，**AGPL-3.0** 许可，面板内常驻标注来源）：

- 按分类折叠浏览 + 搜索（标题/描述/正文）
- **发送到输入框**：点一下追加到输入框末尾（已有内容自动空一行，不覆盖不自动发送）
- **复制**到剪贴板

---

## 安装

### 从 dsh-market / GitHub 安装

包内已声明 `prepare` 构建脚本；pnpm 从 Git 安装时会自动执行 `node build.mjs` 生成 `lib/`。pnpm 10+ 默认拦截依赖的构建脚本，按 dsh-market 的提示把 pnpm 打印的 key 加入 profile 的 `pnpm-workspace.yaml` 的 `allowBuilds` 后重试即可。

```bash
# dsh-market 目标与此等价：
dsh plugin --profile web add "github:wsxwj123/dsh-plugins#path:/packages/dsh-composer-tools"
```

### 从本地源码 link 安装

`lib/` 不入库，本地 `link:` 安装不会触发依赖构建，需要先构建：

```bash
# 1. 构建
cd packages/dsh-composer-tools
pnpm install
pnpm build

# 2. 装进你的 profile
cd ~/.dsh/profiles/web
pnpm add "link:/绝对路径/packages/dsh-composer-tools"

# 3. 装完检查 @deepseek-ai 物理复制坑（见下方"已知问题"），然后重启 dsh web
```

或直接 `dsh plugin --profile web add "link:$PWD/packages/dsh-composer-tools"`。

**兼容版本**：`@deepseek-ai/dsh` 0.1.5、0.2.0-rc.2，以及桌面版 0.2.2-rc.5（三档都真机验证可装可用）。

> 0.2 适配说明：
> - 0.2.0 从 `sessions.list` 快照删掉了 `current` 字段，本插件改为读会话作用域的
>   标准 `sessionId` prop 来定位当前会话目录（`snapshot.current` 仅作 0.1.5 兜底）。
> - 0.2.2 把输入框从 `<textarea data-phase>` 换成 Lexical `contenteditable`：
>   方向键历史改走 composer 适配层（`contenteditable[data-phase]` 锚点 + 块级
>   `'\n'` 文本口径 + Range 光标偏移 + `[data-trigger-menu]` 菜单判据）；发送采集
>   因 `SessionSnapshot.nodes` 被删除，改读 `SessionBinding.eventSource` 的
>   `user/message`（`source.kind === 'user'`）事件。详见 LEARNINGS。

---

## 工作原理（给维护者）

- **host 半（node）**：挂 `/ct` 前缀 RPC（loopback 信任围栏 + POST-only）——指令发现（`.git` 找项目根 + 祖先链，`lstat` 拒符号链接）、读写（basename 白名单 × 精确发现成员资格双闸门防逃逸 + mtime 乐观锁 + 截断保护）、提示词库按需下发
- **client 半（React）**：注册输入框 slot 注入入口按钮；方向键用 document capture keydown 拦截（先于 React 与 Lexical 的 keymap），官方 `inputActions.setDraft` 回填 + rAF 把光标复位到末尾；composer 目标/文本/光标/菜单判定全部走 `composer-target.ts` 适配层（textarea ↔ contenteditable 同口径）；发送采集主路径为「会话快照 nodes（0.1.5–0.2.0）或会话事件流 user/message（0.2.2+）」，斜杠命令仍由 phase 机两段式兜底

## 边界与已知限制

- 输入历史**按会话隔离**、明文存 localStorage（README 提示）
- 指令面板只读列出 + 编辑**已发现的**文件，不创建新文件
- 提示词库数据为 AGPL-3.0（Cherry Studio），随 MIT 插件分发，来源与许可证已在面板和本文件标注
- 真实浏览器交互（方向键门槛、IME、菜单让路、0.2.2 Lexical 回填）由 playwright e2e 在隔离实例自动化验证
- 0.2.2 的 Lexical 文档里如果含 chip/quote 等原子节点，DOM 文本与草稿投影在极端情况下可能有微小差异（插件只用它做行号判定与光标复位，回填文本始终来自历史条目本身）

## 测试

```bash
npm run check                        # 双 tsconfig 类型检查
npm run test:acceptance              # 契约验收（真实实现，含 0.2.2 事件流采集）
node --test tests/unit/*.test.mjs    # 白盒单测
node tests/e2e/composer-target.dom.test.mjs   # composer 适配层真实 Chromium DOM 测试
node tests/e2e/composer-0.2.2.e2e.mjs         # 0.2.2 真机 e2e（自动拉起隔离 DSH 实例 + 真实按键）
npx playwright test tests/e2e/       # 旧版 e2e（需先起 composer-e2e profile，端口 3099）
```

`tests/e2e/composer-0.2.2.e2e.mjs` 默认用本机 desktop 安装（可用 `DSH_APP_BIN` /
`DSH_ASAR_DIR` / `DSH_PROFILE_SRC` / `DSH_022_PORT` 覆盖），把 profile 复制到
`mkdtemp` 出来的临时 `DSH_HOME`，不触碰真实 `~/.dsh` 数据；覆盖 ↑↑↓↓ 往返、
多行行边界、菜单让路、手动编辑重置、会话隔离、真实发送后的事件流采集。

## 已知问题（本机 dsh 环境）

装插件后若所有工具调用报 `Cannot read properties of undefined (reading 'prepare')`——是 `pnpm install` 把 `@deepseek-ai/*` 物理复制成第二份导致 Symbol 分裂。检查 `~/.dsh/profiles/<name>/node_modules/@deepseek-ai/`，若是真目录则 `mv` 掉它（回退共享 symlink），重启 dsh。详见 [deepseek-harness discussion #783](https://github.com/deepseek-ai/deepseek-harness/discussions/783)。

## License

MIT（插件代码）。提示词数据源自 [Cherry Studio](https://github.com/CherryHQ/cherry-studio)（AGPL-3.0）。
