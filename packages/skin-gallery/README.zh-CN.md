# dsh-skin-gallery 中文说明

这是 9 款 dsh-web-ui 完整皮肤的独立插件包。它与轻量主题包 `dsh-theme-gallery` 分开，避免打开通用设置时加载全部皮肤资源。

## 皮肤列表

| id | 中文名 | 作者（skin.json） | 强调色 |
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

## 行为

- 在“设置 → 通用”中新增“完整皮肤”区域；
- 点击皮肤时才加载对应 bundle；
- 刷新后会恢复上次选择的皮肤；
- 切换皮肤前会完整卸载上一个皮肤的样式、控件、body 属性和事件副作用；
- 停止插件时会清理全部皮肤副作用；
- 每款皮肤有独立的可读性修正层，保证消息气泡、代码块、行内代码和主按钮对比度；
- 不删除上游皮肤素材，也不改写上游 bundle。

## 安装

```bash
git clone <repository-url>
cd dsh-plugins
dsh plugin --profile web add "link:$PWD/packages/skin-gallery"
```

安装后重启当前 `dsh web` 进程并刷新页面。

## 致谢与许可

9 款皮肤资产来自上游仓库 `github.com/zhu1090093659/dsh-web-ui`（聚合包 `@linxin666/dsh-skins`），许可为 BSD-3-Clause，版权归 zhu1090093659（Copyright (c) 2026）。

逐皮肤作者以 `skin.json` 为准：

- `dsh-web-ui`
- `powerdog996（DreamSkin 社区）· dsh-web-ui 适配`
- `涂山苏苏`

完整许可文本见 `skins/NOTICE.md` 与每个 `skins/<id>/LICENSE`。

本包的加载、卸载、设置页与可读性修正代码为 MIT 许可；内置皮肤资产为 BSD-3-Clause。
