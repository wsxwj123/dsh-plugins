# dsh-theme-gallery

A fast, curated Client Cordis theme gallery for the DeepSeek Harness Web GUI.

## Themes

The public package contains 13 original, source-neutral theme families. Every family includes a complete light and dark palette:

| 中文名 | English name | Visual direction |
|---|---|---|
| 翠玉 | Jade | Neutral gray with emerald green |
| 陶土 | Terracotta | Warm parchment with terracotta orange |
| 余烬 | Ember | High-contrast black with peach orange |
| 星夜 | Starlight | Deep blue with luminous blue |
| 蔷薇雾 | Rose Mist | Muted violet with cyan |
| 紫晶 | Amethyst | Dark violet with purple |
| 琥珀旧梦 | Amber Retro | Retro cream and brown with orange |
| 墨川 | Ink River | Warm gray with indigo |
| 苔境 | Mossland | Natural green |
| 日蚀 | Eclipse | Cream and blue-black with cool blue |
| 天际 | Horizon | Airy blue-gray with gold |
| 晴蓝 | Azure | Clean contemporary blue |
| 黑白界 | Monochrome | Accessibility-focused high contrast |

## Design approach

Editor themes often differ mainly in syntax-token colors. DSH is a conversational interface, so many editor palettes become visually indistinguishable after adaptation. This package keeps one polished representative per visual cluster instead of exposing dozens of near-identical dark-blue or white-and-blue themes.

## Features

- One unified gallery with no upstream-product categories.
- Search across 13 curated families.
- Uses DSH's native **Light / Dark / Follow system** appearance preference without disabling or replacing it.
- Applies the selected family through one `overrideTokens()` layer with complete `{ light, dark }` token pairs.
- Maps each family to DSH surfaces, text, borders, semantic states, sidebars, and button aliases.
- Stores only the selected family locally; DSH owns the appearance mode.
- Removes themes, UI, listeners, and styles when the plugin stops.
- Ships all runtime data and build output; no external theme applications or absolute paths are required.

## Install

Clone the repository and install the package into a DSH Web profile:

```bash
git clone <repository-url>
cd dsh-plugins
dsh plugin --profile web add "link:$PWD/packages/theme-gallery"
```

After installation, restart the existing `dsh web` process and refresh its current URL. Do not start a second replacement server.

> After any profile install, verify that `~/.dsh/profiles/web/node_modules/@deepseek-ai` was not created as a physical directory. DSH core packages must resolve through the profile fallback symlinks to preserve Cordis/Tool Symbol identity.

## Usage

1. Open **Settings**.
2. Open **General**.
3. Find **精选主题 / Curated themes**.
4. Search for a theme family and click its card.
5. Use DSH's built-in **Appearance** control to choose Light, Dark, or Follow system.

## Attribution

The package contains compact palette adaptations for a conversational interface, not editor syntax definitions. Theme family names, IDs, UI labels, package metadata, and generated runtime output are source-neutral. The adaptation code and DSH integration are MIT licensed.

## License

MIT
