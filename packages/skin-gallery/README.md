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

## Custom skin packs (controlled import)

Import your own skin as three flat files. The pack is validated before it is stored; **the inward files are treated as data, never executed as instructions**.

```text
my-skin/
├── skin.json      # required — id / name / author / license (author & license mandatory)
├── client.js      # required — must register window.__ModuleLoader__.load({ id, factory })
│                  #           and export apply(ctx) consuming only ctx.effect / ctx.get
└── a11y.css       # optional — missing degrades to log-only (skin still usable)
```

- `client.js` with any high-risk capability is refused: `eval(`, `new Function(`, `import(`, non-inline `require(`, `<script src=`, `fetch(`, `XMLHttpRequest(`, `WebSocket(`, direct `localStorage` / `sessionStorage`, `document.cookie`, `chrome.runtime`.
- Size limits: a single pack (skin.json + client.js, UTF-8-safe base64) ≤ 256KB; custom skins ≤ 8.
- Imported skins support **preview / apply / delete / restore-default** and reuse the same engine activation / teardown path as built-ins.
- Failures never change the current appearance and throw a `{ code, message }` error (see the table in the repository root `README.md`).

## Attribution

The nine bundled skin assets are third-party BSD-3-Clause works from `github.com/zhu1090093659/dsh-web-ui` (aggregate `@linxin666/dsh-skins`), Copyright (c) 2026, zhu1090093659. Per-skin authorship follows each upstream `skin.json` `author` field:

- `dsh-web-ui`
- `powerdog996（DreamSkin 社区）· dsh-web-ui 适配`
- `涂山苏苏`

See `skins/NOTICE.md` and each `skins/<id>/LICENSE` for full license text.

## License

The integration code in this package is MIT. Bundled skin assets are BSD-3-Clause.
