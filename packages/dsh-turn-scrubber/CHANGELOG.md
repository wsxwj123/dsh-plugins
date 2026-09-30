# Changelog

## 0.2.1 — 2026-09-30

适配 DSH 0.2 的工作分支版本。**尚未发布**：0.2 运行时仍有一个宿主侧问题待解决，
详见下条。

- Declared `webServer` in `inject` and dropped the dead third argument to
  `rpc.handle` (`{authority:'loopback'}`): the options argument was never
  accepted by 0.1.5 or 0.2 (silently ignored), and loopback-only isolation comes
  from the host RPC channel boundary rather than a caller-supplied flag.
- **Known blocker (not fixed here)**: on 0.2.0-rc.2 `connection.rpc.handle`
  still throws `cannot get property "webServer" without inject` even with
  `webServer` declared in `inject`, because the host implementation registers the
  route through a cordis *shadow* context that no longer resolves `webServer`.
  Declaring the service is necessary but not sufficient. Until that is resolved
  the plugin does not activate on 0.2; it keeps working on 0.1.5.

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
