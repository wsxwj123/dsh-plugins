# Project learnings

- Theme family selection and appearance mode are separate concerns: the plugin selects a family with `overrideTokens()`, while DSH owns Light, Dark, and Follow system.
- Every public family must provide complete `{ light, dark }` token pairs; do not expose single-mode families when native system following is required.
- Keep the public gallery small and visually distinct. Editor syntax-theme differences often collapse into near-duplicate conversational UI palettes.
- Public package metadata, theme IDs, generated data, documentation, and Git authorship must remain source-neutral and privacy-safe.
