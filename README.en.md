# dsh-plugins

A plugin collection for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). Monorepo layout — each plugin lives in its own directory under `packages/` and is installed independently.

中文说明：[README.md](README.md)

## Plugins

| Plugin | What it does |
|---|---|
| [`dsh-appearance-gallery`](packages/dsh-appearance-gallery) | Appearance gallery: 15 theme families + 9 dsh-web-ui skin replicas (fidelity varies, see below), merged into one plugin with a single settings entry. Supports custom theme JSON and custom skin package import. |
| [`dsh-turn-scrubber`](packages/dsh-turn-scrubber) | A turn cluster pinned to the right edge of the conversation — hover to ripple, click to jump to that user turn. |
| [`dsh-pet-bridge`](packages/dsh-pet-bridge) | Pushes live dsh session state (thinking / reading files / running commands / done) to the [cc-pet](https://github.com/wsxwj123/cc-pet) desktop pet. |
| [`dsh-session-manager`](packages/dsh-session-manager) | Session deletion (5s undo + recycle bin) and an archive view (inspect / unarchive). |
| [`dsh-composer-tools`](packages/dsh-composer-tools) | Input enhancements: arrow-key input history, an instructions panel (global + project AGENTS.md/CLAUDE.md), and a 780-entry prompt library. |

All plugins run on both macOS and Windows.

## Upgrading from the old theme / skin plugins

`dsh-theme-gallery`, `dsh-skin-gallery` and `dsh-skin-runtime` have been merged into `dsh-appearance-gallery`; their directories no longer exist. If you have the old plugins installed, uninstall them first — otherwise `dsh web` fails to load a plugin whose directory is gone.

**macOS / Linux:**

```bash
dsh plugin --profile web remove dsh-theme-gallery dsh-skin-gallery dsh-skin-runtime
dsh plugin --profile web add "link:$PWD/packages/dsh-appearance-gallery"
```

**Windows (PowerShell):**

```powershell
dsh plugin --profile web remove dsh-theme-gallery dsh-skin-gallery dsh-skin-runtime
dsh plugin --profile web add "link:$PWD\packages\dsh-appearance-gallery"
```

Restart `dsh web` and reload the page afterwards. **Your appearance settings survive the upgrade**: the merged plugin reuses the exact same storage keys, so the applied theme/skin and any imported custom themes or skins are preserved.

## Installing

### From npm (recommended)

No clone needed, and you get the prebuilt artifact — installs skip the local build step:

```bash
dsh plugin --profile web add dsh-appearance-gallery
dsh plugin --profile web add dsh-turn-scrubber
dsh plugin --profile web add dsh-composer-tools
dsh plugin --profile web add @wsxwj123/dsh-session-manager
```

> The flat name `dsh-session-manager` was already taken on npm by an unrelated package, so this plugin ships as the scoped package `@wsxwj123/dsh-session-manager`. It is identical to `packages/dsh-session-manager` in this repo.

`dsh-pet-bridge` requires [cc-pet](https://github.com/wsxwj123/cc-pet) to be installed first (it listens on `127.0.0.1:7779`; no changes needed on the pet side):

```bash
dsh plugin --profile web add dsh-pet-bridge
```

| Plugin | npm package |
|---|---|
| Appearance gallery | [`dsh-appearance-gallery`](https://www.npmjs.com/package/dsh-appearance-gallery) |
| Turn scrubber | [`dsh-turn-scrubber`](https://www.npmjs.com/package/dsh-turn-scrubber) |
| Composer tools | [`dsh-composer-tools`](https://www.npmjs.com/package/dsh-composer-tools) |
| Session manager | [`@wsxwj123/dsh-session-manager`](https://www.npmjs.com/package/@wsxwj123/dsh-session-manager) |
| Pet bridge | [`dsh-pet-bridge`](https://www.npmjs.com/package/dsh-pet-bridge) |

### From source

```bash
git clone https://github.com/wsxwj123/dsh-plugins
cd dsh-plugins
dsh plugin --profile web add "link:$PWD/packages/<plugin-dir>"
```

On Windows (PowerShell), use backslashes: `"link:$PWD\packages\<plugin-dir>"`.

`dsh-composer-tools` needs `pnpm install && pnpm build` inside its package directory when installed from source (`lib/` is not committed); the npm package ships prebuilt.

### Either way

Restart the running `dsh web` process after installing, and reload open pages. Do not start a second web server.

> After installing, check whether `~/.dsh/profiles/web/node_modules/@deepseek-ai` exists as a real directory. **It should not.** A real directory there means a second copy of the framework was installed into the profile, which splits Cordis / Tool Symbols and breaks tool calls (`Cannot read properties of undefined`). See [deepseek-harness discussion #783](https://github.com/deepseek-ai/deepseek-harness/discussions/783). Every plugin here pins framework peer ranges to explicitly match the host version (e.g. `^0.1.0-rc.6`, cordis `^4.0.1`). Note that a bare `"*"` does not match prereleases like `0.1.0-rc.6` under semver, leaving the peer permanently unsatisfied.

## Building

```bash
pnpm build
pnpm check
```

DSH runtime packages are declared as optional peer dependencies so a second copy of DSH/Cordis is never bundled into a plugin.

`dsh-appearance-gallery/lib/client.js` is generated by `build.mjs` and **must not be hand-edited**: DSH requires the bundle to register itself via `window.__ModuleLoader__.load(...)`, and that registration wrapper exists only in the built artifact. `node build.mjs --check` is a read-only verification of the wrapper, the size ceiling and skin asset integrity — safe for CI.

## Appearance gallery

15 theme families; light / dark / follow-system stays under DSH's own appearance setting. 9 built-in skin replicas, each with try-on and apply. **Fidelity varies by skin**: Hatsune Miku, THS, QQ2008 and Windows XP are full interface replicas (chrome, title bars, controls); Minecraft is close behind; Trading Terminal, Blue Fantasy, Dragon Heir and Whale Song are mostly palette-level — the interface structure stays close to stock DSH. Fidelity is inherited from the upstream dsh-web-ui packages; this plugin neither adds to nor strips from them. Pick one of the first four if you want the interface to look genuinely different.

Custom themes are **CSS-variable injection only, no JS execution**. Custom skins use a three-file controlled import (`skin.json` / `client.js` / optional `a11y.css`) with a hard rejection list for dangerous capabilities (`eval`, `fetch`, `localStorage`, `document.cookie`, …), a 256KB per-package ceiling, at most 8 custom skins, and `a11y.css` restricted to `data:` and relative `url()`. Themes and skins are softly mutually exclusive through the shared `dsh-appearance-track-v1` key — at most one track drives the appearance at a time.

Full contract, state machine and the error-code table: see [README.md](README.md).

## License

MIT
