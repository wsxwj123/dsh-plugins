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

## License

MIT
