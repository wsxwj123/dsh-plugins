# dsh-plugins 中文说明

这是一个用于 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的插件集合仓库。仓库采用 monorepo 结构，每个插件放在 `packages/` 下的独立目录里，互不影响。

## 当前插件

| 插件 | 功能 |
|---|---|
| [`dsh-theme-gallery`](packages/theme-gallery) | 提供 15 个精选主题家族，跟随 DSH 原生“浅色 / 深色 / 跟随系统”外观设置。 |
| [`dsh-turn-scrubber`](packages/turn-scrubber) | 在对话右侧显示回合刻度，悬停展开，点击跳转到对应用户回合。 |

## 仓库结构

```text
packages/
  theme-gallery/   # 主题画廊插件
  turn-scrubber/   # 对话回合刻度插件
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
git clone <repository-url>
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

安装完成后，重启当前 `dsh web` 进程，并刷新已有页面地址。不要另起第二个 Web 服务。

> 安装后请检查 `~/.dsh/profiles/web/node_modules/@deepseek-ai` 是否被创建成真实目录。若是，应按 DSH 本机规则处理，避免 Cordis / Tool Symbol 分裂。相关背景见 [deepseek-harness discussion #783](https://github.com/deepseek-ai/deepseek-harness/discussions/783)。

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
