# dsh-plugins

Independent plugins for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness), maintained in one monorepo with one isolated package per plugin.

## Packages

| Package | Purpose |
|---|---|
| [`dsh-theme-gallery`](packages/theme-gallery) | A fast gallery of 15 curated theme families that follows DSH's native Light, Dark, and Follow system modes. |
| [`dsh-turn-scrubber`](packages/turn-scrubber) | Codex-style turn cluster: a short, uniform tick per user turn on the right edge; hover ripples it like a waveform, click jumps to that turn. |

## Repository layout

```text
packages/
  theme-gallery/       # One plugin package, its own source/build/docs
  future-plugin/       # Future plugins stay isolated here
```

Each plugin owns its package metadata, source, build output, Cordis patch, documentation, and changelog. Shared repository files remain at the root.

## Development

```bash
pnpm build
pnpm check
```

The packages intentionally keep DeepSeek Harness runtime packages as optional peer dependencies. This avoids bundling a second copy of DSH/Cordis into a profile and preserves runtime Symbol identity.

## Custom appearance delivery format

- **`dsh-theme-gallery` custom theme** — CSS-only JSON import (no JS executed): an object with `id`, `label` and a non-empty `tokens` map; every token key starts with `--dsw-` and its value is `{ "light": <string>, "dark": <string> }`. Supports preview / apply / delete / restore-default.
- **`dsh-skin-gallery` custom skin pack** — three flat files: `skin.json` (must include `id` / `name` / `author` / `license`; author & license are required), `client.js` (must call `window.__ModuleLoader__.load({ id, factory })` and export `apply(ctx)` consuming only `ctx.effect` / `ctx.get`), and optional `a11y.css` (missing is a non-fatal degrade). Packs with high-risk capabilities (`eval(`, `fetch(`, `localStorage`, `document.cookie`, …) are refused.
- **State machine** (`none / preview / applied / deleted`) and the cross-track soft mutation key `dsh-appearance-track-v1` ('theme' | 'skin' | '') govern the two galleries; at most one track is actively applied at a time.
- **Errors** are thrown as `{ code, message }` and never change the current appearance; see the error-code table in `README.md`.

## License

MIT
