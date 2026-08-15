# dsh-plugins 中文说明

这是一个用于 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的插件集合仓库。仓库采用 monorepo 结构，每个插件放在 `packages/` 下的独立目录里，互不影响。

## 当前插件

| 插件 | 功能 |
|---|---|
| [`dsh-theme-gallery`](packages/theme-gallery) | 提供 15 个精选主题家族，跟随 DSH 原生“浅色 / 深色 / 跟随系统”外观设置。 |
| [`dsh-skin-gallery`](packages/skin-gallery) | 独立承载 9 个完整 dsh-web-ui 皮肤复刻，避免主题设置页加载大体积皮肤资源。 |
| [`dsh-turn-scrubber`](packages/turn-scrubber) | 在对话右侧显示回合刻度，悬停展开，点击跳转到对应用户回合。 |
| [`dsh-pet-bridge`](packages/pet-bridge) | 桌面宠物状态桥：把 dsh 会话状态（思考中 / 读取文件 / 运行命令 / 完成）实时推送到 [cc-pet](https://github.com/wsxwj123/cc-pet) 桌面宠物气泡。 |

## 界面预览

### 主题画廊

真实运行界面：

![主题画廊真实界面](assets/screenshots/theme-gallery-real.png)

### 对话回合刻度

悬停时会显示对应回合摘要，点击刻度可跳转：

<img src="assets/screenshots/turn-scrubber.png" alt="对话回合刻度真实界面" width="620">

## 仓库结构

```text
packages/
  theme-gallery/   # 主题画廊插件
  turn-scrubber/   # 对话回合刻度插件
  pet-bridge/      # 桌面宠物状态桥插件（配合 cc-pet 使用）
```

每个插件都有自己的：

- 源码；
- 构建产物；
- `package.json`；
- `cordis.patch.yml`；
- README；
- 更新日志。

以后新增插件时，在 `packages/` 下新建独立目录，不把不同插件混在一个包里。

## 安装插件

先克隆仓库：

```bash
git clone https://github.com/wsxwj123/dsh-plugins
cd dsh-plugins
```

然后按需要安装某个插件。

### 安装主题画廊

```bash
dsh plugin --profile web add "link:$PWD/packages/theme-gallery"
```

### 安装回合刻度

```bash
dsh plugin --profile web add "link:$PWD/packages/turn-scrubber"
```

### 安装桌面宠物状态桥（需要先装 cc-pet）

```bash
dsh plugin --profile web add "link:$PWD/packages/pet-bridge"
```

> 前置条件：本机需已安装 [cc-pet](https://github.com/wsxwj123/cc-pet) 桌面宠物（它监听 `127.0.0.1:7779` 接收状态推送）。pet 端代码无需任何修改。详见 [packages/pet-bridge/README.md](packages/pet-bridge/README.md)。

安装完成后，重启当前 `dsh web` 进程，并刷新已有页面地址。不要另起第二个 Web 服务。

> 安装后请检查 `~/.dsh/profiles/web/node_modules/@deepseek-ai` 是否被创建成真实目录。若是，应按 DSH 本机规则处理，避免 Cordis / Tool Symbol 分裂。相关背景见 [deepseek-harness discussion #783](https://github.com/deepseek-ai/deepseek-harness/discussions/783)。

## 提交到 DSH Plugins 目录

[dshplugins.com](https://dshplugins.com/) 是独立的社区插件目录，不是 DeepSeek 官方站点。它的收录规则是：

1. 仓库必须是公开 GitHub 仓库；
2. 提交后进入人工审核队列；
3. 审核者会检查名称、摘要、安装类型、目标 profile、README 和安装命令；
4. 通过后才公开显示；
5. 收录不等于安全背书，用户仍应阅读源码后安装。

本仓库目前适合按“Local checkout”类型提交，目标 profile 为 `web`。提交入口是：

[Submit to DSH Plugins](https://dshplugins.com/submit)

提交页面要求登录。先使用仓库根 URL 做 repository inspect，再选择安装类型并填写简短摘要。建议分别提交多个插件时，使用各自独立 README 的安装路径说明，避免用户把整个 monorepo 误当成单个插件。

## 本地构建

```bash
pnpm build
pnpm check
```

仓库中的 DSH 运行时包被声明为可选 peer dependency，避免把第二份 DSH/Cordis 打进插件包，减少运行时符号不一致的问题。

## 主题画廊简介

主题画廊当前提供 15 个主题家族：

- 翠玉 / Jade
- 陶土 / Terracotta
- 余烬 / Ember
- 星夜 / Starlight
- 蔷薇雾 / Rose Mist
- 紫晶 / Amethyst
- 琥珀旧梦 / Amber Retro
- 墨川 / Ink River
- 苔境 / Mossland
- 日蚀 / Eclipse
- 天际 / Horizon
- 晴蓝 / Azure
- 黑白界 / Monochrome
- 粉霞 / Blush Dawn
- 紫雾 / Lilac Mist

插件只负责选择主题家族。浅色、深色和跟随系统仍由 DSH 自带的“外观”设置控制，两者不会互相覆盖。

## 许可证

MIT
