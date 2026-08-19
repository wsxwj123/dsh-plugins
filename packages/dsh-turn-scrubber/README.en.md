# dsh-turn-scrubber

<p align="center">English | <a href="README.md">中文</a></p>

A Codex-style **turn cluster** for the DeepSeek Harness Web GUI: a block of thin horizontal lines pinned to the right edge of the conversation, vertically centered. Each user turn is one line — the rail shows **every turn of the session** (including unloaded history and compacted turns); idle lines are uniform, short and unobtrusive; hovering ripples them like a waveform and spreads the lines around the pointer (fisheye) so dense sessions stay readable; clicking a line smooth-scrolls to that turn.

Ported from [claude-gui](https://github.com/wsxwj123/claude-gui)'s TurnScrubber idea, re-styled as a linear waveform per user preference.

## Preview

<img src="../../assets/screenshots/turn-scrubber.png" alt="Turn scrubber real preview" width="620">

## Behavior

- **All turns**: the rail renders the session's full turn index (host `turnIndex` endpoint): loaded turns (waveform + snapshot tooltip + smooth scroll), **unloaded history** (click auto-loads older pages until the turn appears, then jumps; tooltip shows the host preview), and **compacted turns** (gray placeholder; click heads to the "load earlier" control).
- **Idle**: a cluster of equal-length short ticks (fixed 6px), 6px off the window edge, faint — invisible while chatting. The pitch is uniform and always fits the message area, vertically centered (never overflows, no matter how many turns).
- **Hover (fisheye)**: the ±3 lines around the pointer spread apart (Gaussian falloff, 3× at the peak) while far lines compress to compensate — total height unchanged, so dense sessions stay readable and precisely clickable. Combined with the line magnification, the pointer area reads as a smooth wave.
- **Tooltip**: after 220ms a summary card fades in ("回合 N" + the first 200 chars of the turn; compacted turns show a hint).
- **Click**: rAF-eased smooth scroll to the turn's anchor row.
- The cluster is a fixed control, not a minimap: it does not map message positions and stays vertically centered while you scroll.
- Hidden on narrow viewports (<768px) and on conversations with fewer than 2 turns.
- **Graceful degrade**: if the host index is unavailable (missing persistence backend etc.), the rail falls back to showing only loaded turns — existing behavior, no errors.

## How it works

- **Full index**: the node half serves one read-only RPC endpoint (`POST /turn-scrubber/turnIndex`, loopback-only) that reads the session's complete event log — live store first, then the JSONL persistence backend — and builds `[{turn, preview, compacted}]` per turn (`turn/start` is the authority; turn numbers are 1-based; compaction via `compaction/summary.shadowedSeqs`). The client caches the index per `(sessionId, fingerprint)` and verifies the response's sessionId (session-switch race guard).
- **Unloaded navigation**: clicking an unloaded line runs a single-flight `ensureTurnLoaded` loop — pages older history until the turn's key appears in the loaded window (or `hasMore` is false / 40-page cap / session switch), then smooth-scrolls.
- **DOM**: the rail is a sibling of the `[data-conversation-scroll]` scrollport inside its relative parent, sized from layout offsets (`offsetTop`/`offsetHeight`, immune to CSS zoom). Click-jump anchors to DSH's native `[data-chat-anchor-key]` rows.
- **Scroll**: programmatic `scrollIntoView({ behavior: 'smooth' })` is unreliable in some webviews, so jumping uses a hand-rolled rAF cubic ease.
- **Text**: summaries are extracted safely from strings, Anthropic-style content-block arrays, or structured objects (never crashes on images/files); previews are truncated to 120 chars.

## Install

Clone the repository and install the package into a DSH Web profile:

```bash
git clone <repository-url>
cd dsh-plugins
dsh plugin --profile web add "link:$PWD/packages/turn-scrubber"
```

After installation, restart the existing `dsh web` process and refresh its current URL. Do not start a second replacement server.

> After any profile install, verify that `~/.dsh/profiles/web/node_modules/@deepseek-ai` was not created as a physical directory. DSH core packages must resolve through the profile fallback symlinks to preserve Cordis/Tool Symbol identity (see [deepseek-harness discussion #783](https://github.com/deepseek-ai/deepseek-harness/discussions/783)).

## Build

```bash
pnpm install          # from the monorepo root
pnpm build            # pnpm -r build → packages/turn-scrubber/lib/
```

The client bundle is built with the official DSH client-bundle preset shape (`window.__ModuleLoader__.load`), a purity gate that forbids non-platform `@deepseek-ai` value imports, and CSS Modules inlined as `<style data-plugin>` tags. Virtual ids are repo-relative — the built bundle contains no machine paths.

## Known boundaries

- The cluster overlays the message area's right padding (the chat column is centered); on narrow windows it may overlap text.
- Compaction removes anchors of compacted turns, so their markers disappear — expected DSH behavior.
- The rail is a per-conversation overlay for the active session.
