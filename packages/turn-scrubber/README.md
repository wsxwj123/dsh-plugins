# dsh-turn-scrubber

A Codex-style **turn cluster** for the DeepSeek Harness Web GUI: a block of thin horizontal lines pinned to the right edge of the conversation, vertically centered. Each user turn is one line — idle lines are uniform, short and unobtrusive; hovering ripples them like a waveform; clicking a line smooth-scrolls to that turn.

Ported from [claude-gui](https://github.com/wsxwj123/claude-gui)'s TurnScrubber idea, re-styled as a linear waveform per user preference.

## Preview

<img src="../../assets/screenshots/turn-scrubber.png" alt="Turn scrubber real preview" width="620">

## Behavior

- **Idle**: a cluster of equal-length short ticks (3–17px, growing gently with turn count), 6px off the window edge, faint — invisible while chatting.
- **Hover**: a continuous Gaussian-falloff wave — the line nearest the pointer magnifies to 2.4× and brightens; neighbors taper 1.7× → 1.1× → 1×. The peak glides smoothly (fractional position, not per-line jumps).
- **Tooltip**: after 220ms a summary card fades in ("回合 N" + the first 200 chars of the turn).
- **Click**: rAF-eased smooth scroll to the turn's anchor row.
- The cluster is a fixed control, not a minimap: it does not map message positions and stays vertically centered while you scroll.
- Hidden on narrow viewports (<768px) and on conversations with fewer than 2 turns.

## How it works

- **Data**: reads the runtime session store — `ctx.sessions.list` tracks the active session; `ctx.sessions.binding(id).session` subscribes to the live chat snapshot. Turns come from `snapshot.chat.locations.turns` (turn → node keys); the summary is the first user/steering node's text, extracted safely from strings, Anthropic-style content-block arrays, or structured objects (never crashes on images/files).
- **DOM**: the rail is a sibling of the `[data-conversation-scroll]` scrollport inside its relative parent, sized from layout offsets (`offsetTop`/`offsetHeight`, immune to CSS zoom). Click-jump anchors to DSH's native `[data-chat-anchor-key]` rows.
- **Scroll**: programmatic `scrollIntoView({ behavior: 'smooth' })` is unreliable in some webviews, so jumping uses a hand-rolled rAF cubic ease.
- **Client-only**: the node half is a deliberate no-op stub; everything happens in the browser bundle.

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
