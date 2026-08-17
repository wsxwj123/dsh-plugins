/**
 * TurnRail — the Codex-style turn cluster.
 *
 * A block of THIN HORIZONTAL lines pinned to the right edge of the
 * conversation window, VERTICALLY CENTERED in the message area (it does not
 * map message positions — it is a fixed control, not a minimap). Each user
 * turn is one line; more turns → more lines, and the block widens gently
 * leftward as it grows. IDLE lines are all the same short length — uniform
 * and unobtrusive while chatting.
 *
 * Hover: the line nearest the pointer magnifies (scaleX) and brightens with
 * a distance falloff, so the cluster ripples like a waveform — the wave
 * variation is hover-only. Click: smooth-scrolls to that turn via the
 * conversation's native `[data-chat-anchor-key]` rows (rAF easing —
 * programmatic smooth scrollIntoView is unreliable in some webviews).
 *
 * Positioning: the rail is a sibling of the `[data-conversation-scroll]`
 * scrollport inside its relative parent, sized from the scrollport's layout
 * offsets (offsetTop/offsetHeight are layout px, immune to CSS zoom).
 *
 * Full-index rendering (this feature): when the host `turnIndex` is available
 * the rail draws ALL turns — loaded (waveform + snapshot tooltip + smooth
 * scroll, unchanged), compacted (gray placeholder line,「已压缩」tooltip, click
 * scrolls near the load-older control), and unloaded (preview tooltip, click
 * runs the single-flight `ensureTurnLoaded` loop, then scrolls). When the
 * index is unavailable the rail degrades to the loaded-only behavior.
 *
 * Key mapping: line index i (0-based, oldest at top) ↔ turn number i+1
 * (spike-verified identity with `locations.turns` keys); the mapping goes
 * through `hostIndex.turns[i].turn` when present so a key divergence would
 * still resolve correctly (重要 5).
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { ChatSnapshot, EnsureLoadedResult, SessionFace, TurnIndexEntry, TurnIndexResult } from './context-types.ts'
import { ensureTurnLoaded } from './ensureTurnLoaded.ts'
import css from './rail.module.css'

/** Visual line thickness (px). */
const GAP = 5
/** Hit-area height per line (px) — thin visuals need a comfortable target. */
const HIT = 10
/** Block width growth: ALL idle lines share one uniform length — short, and
 *  the block widens gently as turns grow (idle stays unobtrusive; the wave
 *  variation only appears on hover). */
const BASE_LEN = 3
const STEP_LEN = 0.75
const MAX_LEN = 17

/**
 * Dock-style magnification by CONTINUOUS pointer distance (Gaussian falloff).
 * The hover position is fractional (line units), so the wave peak glides
 * smoothly across the cluster instead of jumping line to line.
 * @param d - signed distance from the pointer, in line units (fractional).
 */
const PEAK_SCALE = 2.4
const FALLOFF = 1.4
function waveScale(d: number): number {
  return 1 + (PEAK_SCALE - 1) * Math.exp(-(d * d) / FALLOFF)
}
function waveGlow(d: number): number {
  return 0.4 + 0.6 * Math.exp(-(d * d) / FALLOFF)
}

/** Block width for the current turn count (uniform across all lines). */
function blockWidth(count: number): number {
  return Math.min(MAX_LEN, BASE_LEN + Math.max(0, count - 2) * STEP_LEN)
}

/** One rendered rail line. */
interface RailLine {
  /** 1-based turn number the line represents. */
  turn: number
  state: 'loaded' | 'compacted' | 'unloaded'
  /** Loaded: first user/steering node key (scroll target). */
  anchorKey?: string
  /** Tooltip text: snapshot text (loaded) / preview (unloaded); '' for compacted. */
  text: string
}

/**
 * Collect loaded turns from the chat snapshot: turn id → first-user-node key
 * + text. Mirrors the pre-feature `collectTurns` semantics.
 */
function collectLoadedTurns(chat: ChatSnapshot | undefined): Map<number, { key: string; text: string }> {
  const out = new Map<number, { key: string; text: string }>()
  if (!chat) return out
  const turnKeys = chat.locations?.turns
  if (!turnKeys) return out
  for (const [turn, keys] of turnKeys.entries()) {
    if (keys.length === 0) continue
    let nodeKey: string | undefined
    for (const key of keys) {
      const kind = chat.nodes.get(key)?.kind
      if (kind === 'user' || kind === 'steering') {
        nodeKey = key
        break
      }
    }
    if (nodeKey === undefined) nodeKey = keys[0]
    const node = chat.nodes.get(nodeKey)
    out.set(turn, { key: nodeKey, text: textOfContent(node?.data?.content) })
  }
  return out
}

/**
 * Build the rail line list. With a host index the skeleton is the FULL turn
 * list (three states); without it, only the loaded turns (degrade path).
 */
function buildLines(
  hostIndex: TurnIndexResult | null,
  chat: ChatSnapshot | undefined,
  loaded: Map<number, { key: string; text: string }>,
): RailLine[] {
  if (hostIndex !== null) {
    const lines: RailLine[] = []
    for (let i = 0; i < hostIndex.turns.length; i++) {
      const entry: TurnIndexEntry = hostIndex.turns[i]
      // 重要 5: prefer the entry's own turn number; fall back to i+1 so a key
      // divergence resolves through the explicit mapping instead of assuming
      // index identity.
      const turn = typeof entry?.turn === 'number' ? entry.turn : i + 1
      const ld = loaded.get(turn)
      if (ld !== undefined) {
        lines.push({ turn, state: 'loaded', anchorKey: ld.key, text: ld.text })
      } else if (entry?.compacted === true) {
        lines.push({ turn, state: 'compacted', text: '' })
      } else {
        lines.push({ turn, state: 'unloaded', anchorKey: undefined, text: entry?.preview ?? '' })
      }
    }
    return lines
  }
  // Degrade: loaded turns only, ascending turn order.
  return [...loaded.entries()]
    .sort(([a], [b]) => a - b)
    .map(([turn, ld]) => ({ turn, state: 'loaded' as const, anchorKey: ld.key, text: ld.text }))
}

/**
 * Extract plain text from a node's content, which may be a string, an array
 * of Anthropic-style content blocks (`[{type:"text",text:"..."}, ...]`), or a
 * structured object — never render non-string values as React children.
 */
function textOfContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    let out = ''
    for (const block of content) {
      if (typeof block === 'string') {
        out += block
      } else if (block !== null && typeof block === 'object') {
        const b = block as { text?: unknown; content?: unknown }
        if (typeof b.text === 'string') out += b.text
        else if (typeof b.content === 'string') out += b.content
      }
    }
    return out
  }
  if (content !== null && typeof content === 'object') {
    const c = content as { text?: unknown; content?: unknown }
    if (typeof c.text === 'string') return c.text
    if (typeof c.content === 'string') return c.content
  }
  return ''
}

/** Smooth-scroll the scrollport so the anchor row sits near the top. */
function scrollToRow(scrollport: HTMLElement, row: HTMLElement): void {
  const target = Math.max(0, row.offsetTop - 8)
  const start = scrollport.scrollTop
  const dist = target - start
  if (Math.abs(dist) < 2) return
  const dur = 320
  let t0: number | null = null
  const ease = (p: number): number => 1 - Math.pow(1 - p, 3)
  const step = (ts: number): void => {
    if (t0 === null) t0 = ts
    const p = Math.min(1, (ts - t0) / dur)
    scrollport.scrollTop = start + dist * ease(p)
    if (p < 1) requestAnimationFrame(step)
  }
  requestAnimationFrame(step)
}

/** Find the native「加载更早」button inside the scrollport (text-localized). */
function findLoadOlderControl(scrollport: HTMLElement): HTMLElement | null {
  const buttons = scrollport.querySelectorAll<HTMLButtonElement>('button')
  for (const button of buttons) {
    const text = button.textContent?.trim()
    if (text === '加载更早' || text === 'Load earlier') return button
  }
  return null
}

/** Scroll to the very first row of the loaded window (fallback target). */
function scrollToWindowFront(scrollport: HTMLElement): void {
  const first = scrollport.querySelector<HTMLElement>('[data-chat-anchor-key]')
  if (first) scrollToRow(scrollport, first)
}

/** Scroll to one loaded turn's anchor row by key; fallback to window front. */
function scrollToTurn(scrollport: HTMLElement, key: string): void {
  const row = scrollport.querySelector<HTMLElement>(`[data-chat-anchor-key="${CSS.escape(key)}"]`)
  if (row) scrollToRow(scrollport, row)
  else scrollToWindowFront(scrollport)
}

export function TurnRail({
  session,
  scrollport,
  hostIndex,
  token,
}: {
  session: SessionFace
  scrollport: HTMLElement
  hostIndex: TurnIndexResult | null
  /** Opaque per-session token handed to ensureTurnLoaded (session switch guard). */
  token: unknown
}) {
  const snap = useSyncExternalStore(
    useCallback((cb: () => void) => session.subscribe(cb), [session]),
    useCallback(() => session.snapshotCache, [session]),
  )
  const loaded = useMemo(() => collectLoadedTurns(snap?.chat), [snap])
  const lines = useMemo(() => buildLines(hostIndex, snap?.chat, loaded), [hostIndex, snap, loaded])
  // Which turn is mid-load (light「加载中…」hint, never blocks other lines).
  const [loadingTurn, setLoadingTurn] = useState<number | null>(null)
  // Continuous fractional hover position in line units (e.g. 3.4 = between
  // line 3 and 4) — drives the gliding waveform; null = idle.
  const [hoverPos, setHoverPos] = useState<number | null>(null)
  const [tip, setTip] = useState<number | null>(null)
  const [box, setBox] = useState<{ top: number; height: number; seat: number } | null>(null)
  const showTimer = useRef(0)
  const hideTimer = useRef(0)
  const hoverTimer = useRef(0)
  const groupRef = useRef<HTMLDivElement>(null)

  // Measure the rail box: the scrollport's layout position/size minus the
  // composer seat (the cluster centers in the MESSAGE area, not the input).
  const measure = useCallback(() => {
    const sp = scrollport
    const parent = sp.parentElement
    if (!parent) return
    const seat = sp.querySelector<HTMLElement>('[data-composer-seat]')
    setBox({
      top: sp.offsetTop - parent.offsetTop,
      height: sp.offsetHeight,
      seat: seat?.offsetHeight ?? 0,
    })
  }, [scrollport])

  useLayoutEffect(() => {
    measure()
  }, [measure])

  useEffect(() => {
    const ro = new ResizeObserver(measure)
    ro.observe(scrollport)
    const seat = scrollport.querySelector<HTMLElement>('[data-composer-seat]')
    if (seat) ro.observe(seat)
    window.addEventListener('resize', measure)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [scrollport, measure])

  useEffect(() => () => {
    clearTimeout(showTimer.current)
    clearTimeout(hideTimer.current)
    clearTimeout(hoverTimer.current)
  }, [])

  if (!box || lines.length < 2) return null

  const count = lines.length
  const width = blockWidth(count)
  // The rail covers the MESSAGE area only (excludes the composer seat).
  const areaH = Math.max(0, box.height - box.seat)
  if (areaH < 40) return null
  const groupH = count * HIT + (count - 1) * GAP
  // Compress the gap when the cluster would overflow the message area.
  const gap = groupH > areaH ? Math.max(2, Math.round((GAP * areaH) / groupH)) : GAP
  const realGroupH = count * HIT + (count - 1) * gap
  // Center vertically in the message area (relative to the rail box).
  const groupTop = Math.max(4, areaH / 2 - realGroupH / 2)

  /** Fractional line-unit position from a viewport Y. */
  const hoverFromPointer = (clientY: number): number => {
    const top = groupRef.current?.getBoundingClientRect().top
    if (top === undefined) return 0
    const rel = clientY - top - HIT / 2
    return rel / (HIT + gap)
  }

  const enter = (frac: number): void => {
    // A move over the rail keeps the wave alive (cancel any pending collapse).
    clearTimeout(hoverTimer.current)
    setHoverPos(frac)
    const idx = Math.max(0, Math.min(count - 1, Math.round(frac)))
    clearTimeout(hideTimer.current)
    clearTimeout(showTimer.current)
    showTimer.current = window.setTimeout(() => setTip(idx), 220)
  }
  /** Pointer left the rail/tip: hide the tooltip soon, collapse the wave late
   *  (generous grace so scrubbing or reading the tooltip never snaps it). */
  const park = (): void => {
    clearTimeout(showTimer.current)
    clearTimeout(hoverTimer.current)
    hoverTimer.current = window.setTimeout(() => setHoverPos(null), 600)
    clearTimeout(hideTimer.current)
    hideTimer.current = window.setTimeout(() => setTip(null), 120)
  }
  /** Pointer is back on the rail or the sticky tooltip: cancel any pending park. */
  const keepAlive = (): void => {
    clearTimeout(hoverTimer.current)
    clearTimeout(showTimer.current)
    clearTimeout(hideTimer.current)
  }

  /** Click on an unloaded line: page older until the turn appears, then scroll. */
  const handleUnloadedClick = (turn: number): void => {
    if (loadingTurn !== null) return // single-flight: one loop at a time
    setLoadingTurn(turn)
    ensureTurnLoaded({ session, turnId: turn, token }).then((result: EnsureLoadedResult) => {
      setLoadingTurn(null)
      if (result === '达成' || result === '已加载') {
        const key = collectLoadedTurns(session.snapshotCache.chat).get(turn)?.key
        if (key !== undefined) scrollToTurn(scrollport, key)
        else scrollToWindowFront(scrollport)
      } else {
        // 到最老 / 超限 / 会话切换 — settle at the loaded window top.
        scrollToWindowFront(scrollport)
      }
    })
  }

  /** Click on a compacted line: head toward the「加载更早」control. */
  const handleCompactedClick = (): void => {
    const control = findLoadOlderControl(scrollport)
    if (control) scrollToRow(scrollport, control)
    else scrollToWindowFront(scrollport)
  }

  const handleLineClick = (line: RailLine): void => {
    if (line.state === 'loaded' && line.anchorKey !== undefined) scrollToTurn(scrollport, line.anchorKey)
    else if (line.state === 'compacted') handleCompactedClick()
    else handleUnloadedClick(line.turn)
  }

  return (
    <div
      className={css.rail}
      style={{ top: box.top, height: areaH }}
      onMouseMove={(e) => enter(hoverFromPointer(e.clientY))}
      onMouseLeave={park}
    >
      <div ref={groupRef} className={css.group} style={{ top: groupTop, gap }}>
        {lines.map((line, i) => {
          const d = hoverPos === null ? Infinity : i - hoverPos
          const className = line.state === 'compacted' ? `${css.line} ${css.compacted}` : css.line
          return (
            <button
              key={line.turn}
              type="button"
              className={className}
              style={{ height: HIT }}
              onClick={() => handleLineClick(line)}
              aria-label={`跳到第 ${line.turn} 个回合${line.state === 'compacted' ? '（已压缩）' : ''}`}
            >
              <span
                className={css.bar}
                style={{
                  width: Math.round(width),
                  transform: `scaleX(${waveScale(d)})`,
                  opacity: waveGlow(d),
                  background:
                    line.state === 'compacted'
                      ? 'var(--dsw-alias-label-tertiary)'
                      : d < 0.5 && d > -0.5
                        ? 'var(--dsw-alias-label-primary)'
                        : 'var(--dsw-alias-label-secondary)',
                }}
              />
            </button>
          )
        })}
      </div>
      {loadingTurn !== null && (
        <div className={css.loading} style={{ top: Math.max(4, groupTop - 14), right: 2 }}>
          加载中…
        </div>
      )}
      {tip !== null && lines[tip] && (
        <div
          className={css.tip}
          style={{ top: groupTop + tip * (HIT + gap) + HIT / 2, right: width + 12 }}
          onMouseEnter={keepAlive}
          onMouseLeave={park}
        >
          <div className={css.tipTitle}>
            回合 {lines[tip].turn}
            {lines[tip].state === 'compacted' ? ' · 已压缩' : lines[tip].state === 'unloaded' ? ' · 未加载' : ''}
          </div>
          <div className={css.tipText}>
            {lines[tip].state === 'compacted'
              ? '该回合已被压缩，点击可跳转到「加载更早」'
              : (lines[tip].text || '(空消息)').slice(0, 200)}
          </div>
        </div>
      )}
    </div>
  )
}