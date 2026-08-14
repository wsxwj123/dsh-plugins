# Changelog

## 0.7.0

- Added a second, mutually exclusive **skin track**: nine complete dsh-web-ui skin replicas
  (qq98 / ths / xp / blue-fantasy / dragon-heir / minecraft / whale-song / trading / miku).
- Skin bundles are embedded at build time and executed lazily on demand (no external/dynamic URL);
  the skin engine guarantees load → apply → switch mutual exclusion → full teardown on plugin stop.
- Added a per-skin accessibility layer (`skins/<id>/a11y.css`) that applies only WCAG-AA contrast
  fixes (primary-button text on light/hover fills, semi-transparent code-block backgrounds).
- Theme and skin tracks are mutually exclusive; selection is remembered in
  `localStorage` without modifying the official skin-center configuration.
- Added BSD-3-Clause attribution for the bundled skin assets: `skins/NOTICE.md`, per-skin
  `skins/<id>/LICENSE`, README attribution sections (EN/zh-CN) and a LICENSE note.

## 0.6.0

- Added Blush Dawn / 粉霞 with white surfaces and soft rose accents.
- Added Lilac Mist / 紫雾 with white surfaces and gentle lilac accents.
- Added coordinated dark palettes so both families follow DSH's native appearance modes.

## 0.5.0

- Made the native DSH Appearance preference the sole owner of light, dark, and follow-system behavior.
- Replaced custom theme registration and `setTheme()` calls with one `overrideTokens()` layer containing `{ light, dark }` pairs.
- Removed the plugin's own light/dark controls.
- Reduced the gallery to 13 complete families so every selection works in all three native appearance modes.
- Added paired light/dark swatches to each family card.

## 0.4.0

- Replaced imported product and editor-theme names with original, source-neutral names and IDs.
- Reduced the public runtime catalog to 15 curated families and 28 concrete palettes.
- Removed the upstream import pool and maintainer importer from the public package.
- Kept light and dark variants together on one family card.
- Preserved single-theme startup registration and the lightweight Settings gallery.
- Completed privacy cleanup for package metadata, generated output, documentation, and Git history.

## 0.3.0

- Unified the gallery into one source-neutral product catalog.
- Curated visually distinct theme families from a larger experimental pool.
- Added the Jade / 翠玉 family name for the neutral-gray and emerald-green palette.

## 0.2.0

- Added searchable family cards and light/dark controls.
- Added reproducible palette generation during development.

## 0.1.0

- Initial public release.
