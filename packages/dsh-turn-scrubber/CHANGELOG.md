# Changelog

## 0.2.0 — 2026-08-17

- **Full turn index**: the rail now shows ALL turns of a session (loaded,
  unloaded history, and compacted ones) via a host-side `turnIndex` RPC
  endpoint — total count no longer depends on how much history the UI has
  loaded.
- Three states per line: loaded (waveform + tooltip + smooth scroll),
  unloaded (click auto-loads older history until the turn appears, then
  jumps), compacted (gray placeholder, click heads to the "load earlier"
  control).
- **Fisheye hover**: the cluster keeps a compact uniform pitch that always
  fits the message area (no overflow, vertically centered); hovering spreads
  the ±3 lines around the pointer (Gaussian falloff) so dense sessions stay
  readable and clickable — what you point at is what you get.
- Fixed line-length growth (idle lines are now a fixed short length).
- Turn numbering is 1-based (spike-verified against real archives);
  compaction detection via `compaction/summary.shadowedSeqs` verified on a
  276-turn real session (269 compacted correctly identified).
- Fixed the RPC result contract: the generic `connection.rpc` channel wraps
  business data in `value` (client schema strips other fields).

## 0.1.0 — 2026-08-14

- Initial release: Codex-style turn cluster for the DSH Web GUI.
- Idle: uniform short horizontal ticks (one per user turn), vertically centered on the right edge, unobtrusive.
- Hover: continuous Gaussian-falloff waveform ripple (2.4× peak), sticky tooltip with turn summary.
- Click: rAF-eased smooth scroll to the turn's anchor row.
- Safe text extraction from content-block arrays (text / image / file messages).
