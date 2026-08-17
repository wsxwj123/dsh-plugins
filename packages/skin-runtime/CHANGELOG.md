# Changelog

## Unreleased

- Added **恢复默认外观** to clear the active skin and return to DSH's native appearance.
- Added a **创建自定义皮肤** design assistant that asks users to choose target areas and produces a prompt for AI-guided skin design.

## 0.1.0

- Initial standalone release of nine complete dsh-web-ui skin replicas.
- Loads each selected skin on demand from committed bundle bytes.
- Restores the selected skin across page reloads.
- Adds mutual exclusion and full teardown for skin CSS, body attributes, chrome DOM, and event effects.
- Adds per-skin accessibility overrides for bubbles, code blocks, inline code, and primary buttons.
- Preserves upstream BSD-3-Clause attribution in `skins/NOTICE.md` and per-skin `LICENSE` files.
