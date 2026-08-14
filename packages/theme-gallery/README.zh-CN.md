# dsh-theme-gallery 中文说明

这是 DeepSeek Harness Web GUI 的主题画廊插件。安装后，可以在设置中直接选择一套视觉风格完整的主题。

## 当前主题

共 15 个主题家族，每个家族都有完整的浅色和深色配色：

| 中文名 | English name | 视觉方向 |
|---|---|---|
| 翠玉 | Jade | 中性灰与翡翠绿 |
| 陶土 | Terracotta | 暖米色与陶土橙 |
| 余烬 | Ember | 高对比黑色与桃橙 |
| 星夜 | Starlight | 深蓝与亮蓝 |
| 蔷薇雾 | Rose Mist | 柔和紫灰与青色 |
| 紫晶 | Amethyst | 深紫与紫晶色 |
| 琥珀旧梦 | Amber Retro | 复古米黄、深棕与橙色 |
| 墨川 | Ink River | 暖灰与靛蓝 |
| 苔境 | Mossland | 自然绿色 |
| 日蚀 | Eclipse | 米黄、蓝黑与冷蓝色 |
| 天际 | Horizon | 浅蓝灰与金色 |
| 晴蓝 | Azure | 清爽现代蓝 |
| 黑白界 | Monochrome | 高对比黑白 |
| 粉霞 | Blush Dawn | 白色主体与柔和玫瑰粉 |
| 紫雾 | Lilac Mist | 白色主体与柔和淡紫色 |

## 主题模式如何工作

这个插件只负责选择**主题家族**，不负责切换浅色或深色。

DSH 自带的“外观”设置继续负责：

- 浅色；
- 深色；
- 跟随系统。

例如选择“粉霞 / Blush Dawn”后：

- DSH 外观选择浅色，使用粉霞浅色；
- DSH 外观选择深色，使用粉霞深色；
- DSH 外观选择跟随系统，会根据系统设置自动使用粉霞浅色或深色。

插件不会把 DSH 的外观设置改成自定义主题 ID，也不会让原生“浅色 / 深色 / 跟随系统”失效。

## 使用方式

1. 打开 DSH 设置；
2. 进入“通用”；
3. 在“精选外观”下看到两条轨道：
   - **主题** — 上面 15 个主题家族；
   - **皮肤** — 9 款完整的 dsh-web-ui 皮肤复刻（见下节）；
4. 搜索或点击一个卡片；
5. 在 DSH 原生“外观”设置中选择浅色、深色或跟随系统。

主题轨道与皮肤轨道互斥：激活其中一条会自动清退另一条。皮肤是**会话级尝试（try-on）**，
刷新页面回到默认外观；若要永久皮肤请继续使用官方皮肤中心（`dsh-skin use`）。本插件不会
改写官方 `skin-center` 的配置。

## 皮肤轨道

9 款皮肤 bundle 在构建期完整内嵌、运行期按需执行（不依赖任何外部/动态 URL）。每款皮肤都是
上游 `apply()` 的忠实复刻（body 属性 + 注入 CSS + chrome DOM），由一层轻量引擎保证
加载 → 应用 → 互斥切换 → 插件停止时全量回收。每款皮肤附带一份**可访问性修正层**
（`skins/<id>/a11y.css`），只修对比度（WCAG AA）：主按钮白字在浅色/悬停填充、半透明代码块
底色实体化。修正层绝不删除上游皮肤素材。

| id | 中文名 | 作者（skin.json） | 主色 |
|---|---|---|---|
| qq98 | QQ2008 怀旧版 | dsh-web-ui | #2b7cd9 |
| ths | 同花顺风格 | dsh-web-ui | #e60012 |
| xp | Windows XP (Luna) | dsh-web-ui | #316ac5 |
| blue-fantasy | 蓝色幻想 | powerdog996（DreamSkin 社区）· dsh-web-ui 适配 | #4a5fa8 |
| dragon-heir | 龙的传人 | dsh-web-ui | #c3272b |
| minecraft | Minecraft 方块世界 | dsh-web-ui | #7cbd4b |
| whale-song | 鲸吟 | dsh-web-ui | #4d8fd4 |
| trading | 交易终端 | dsh-web-ui | #f23645 |
| miku | 初音未来 · 电子歌姬 | 涂山苏苏 | #2e9bff |

## 安装

```bash
git clone <repository-url>
cd dsh-plugins
dsh plugin --profile web add "link:$PWD/packages/theme-gallery"
```

安装后重启当前 `dsh web` 进程，并刷新原有页面地址。不要启动第二个 Web 服务。

> 安装后检查 `~/.dsh/profiles/web/node_modules/@deepseek-ai` 是否变成真实目录。若是，需要按 DSH 本机规则移动备份，避免插件运行时出现符号不一致问题。

## 设计原则

### 1. 主题数量少而清晰

很多编辑器主题主要差异来自代码语法颜色。移植到聊天界面后，最终往往都变成相近的深色背景加蓝色强调色。因此这个插件不把大量相近主题全部堆给用户，而是保留视觉差异明确的一组主题。

### 2. 白色主题不把整页染彩色

粉霞和紫雾以白色为主体，只在按钮、选中区域和边框上使用粉色或紫色，避免整页出现大面积彩色。

### 3. 不伪造缺失模式

每个公开主题家族都必须同时具备浅色和深色。缺少其中一套的主题不会进入公开画廊，确保“跟随系统”始终可靠。

### 4. 不依赖外部应用

主题数据和构建产物已经包含在插件目录中。普通用户安装后直接使用，不需要安装任何其他主题源应用，也不需要本机路径。

## 技术实现

插件使用 DSH 的 `overrideTokens()` 接口，为每个 token 同时提供：

```js
{
  light: '浅色值',
  dark: '深色值'
}
```

DSH 会根据原生外观设置自动选择当前应使用的值。插件只保存用户选择的主题家族，不保存、也不覆盖 DSH 的外观模式。

## 卸载行为

插件停止时会自动清理：

- 主题 token 覆盖；
- 皮肤轨道的全部副作用（body 属性、皮肤内置样式、a11y 样式、chrome DOM、模块表注册）；
- 设置页面中的主题画廊；
- 插入的样式；
- 事件监听器。

## 致谢与许可证

本插件自身胶水代码（主题引擎、皮肤引擎、可访问性修正层、UI、构建）为 **MIT**。

内置的 9 款皮肤资产来自上游仓库 `github.com/zhu1090093659/dsh-web-ui`（聚合包
`@linxin666/dsh-skins`），为 **BSD 3-Clause** 作品，版权归 zhu1090093659（Copyright (c) 2026）。
逐皮肤作者以各 `skin.json` 的 `author` 字段为准：`dsh-web-ui`（聚合包）、`powerdog996`
（blue-fantasy，DreamSkin 社区）、`涂山苏苏`（miku）。完整 BSD-3 全文见 `skins/NOTICE.md`，
每款皮肤对应 `skins/<id>/LICENSE`。
