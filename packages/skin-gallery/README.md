# dsh-skin-gallery

Nine complete dsh-web-ui skin replicas for the DeepSeek Harness Web GUI, packaged separately from the lightweight `dsh-theme-gallery` so ordinary theme browsing stays fast.

## Skins

| id | 中文名 | author (skin.json) | accent |
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

## Behavior

- Registers a **完整皮肤** row under **Settings → General**.
- Loads only the selected skin at runtime; skin bundle bytes are committed at build time.
- Restores the last selected skin on page load.
- Switching skins first disposes the previous skin's CSS, DOM chrome, body attributes, and event effects.
- Stopping the plugin removes every skin side effect.
- Adds a per-skin accessibility layer for message bubbles, code blocks, inline code, and primary-button contrast without deleting upstream artwork or controls.

## Install

```bash
git clone <repository-url>
cd dsh-plugins
dsh plugin --profile web add "link:$PWD/packages/skin-gallery"
```

Restart the existing `dsh web` process after installation.

## Attribution

The nine bundled skin assets are third-party BSD-3-Clause works from `github.com/zhu1090093659/dsh-web-ui` (aggregate `@linxin666/dsh-skins`), Copyright (c) 2026, zhu1090093659. Per-skin authorship follows each upstream `skin.json` `author` field:

- `dsh-web-ui`
- `powerdog996（DreamSkin 社区）· dsh-web-ui 适配`
- `涂山苏苏`

See `skins/NOTICE.md` and each `skins/<id>/LICENSE` for full license text.

## License

The integration code in this package is MIT. Bundled skin assets are BSD-3-Clause.
