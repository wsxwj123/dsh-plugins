# Changelog

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
