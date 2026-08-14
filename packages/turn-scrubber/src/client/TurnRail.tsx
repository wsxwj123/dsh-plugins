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
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { ChatSnapshot, SessionFace } from './context-types.ts'
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

/** Collect user turns from the chat snapshot: turn id, first-user-node key, text. */
function collectTurns(chat: ChatSnapshot | undefined): { key: string; text: string }[] {
  if (!chat) return []
  // The empty conversation snapshot has no `turns` Map (only getTurn/getStep).
  const turnKeys = chat.locations?.turns
  if (!turnKeys) return []
  const turns: { key: string; text: string }[] = []
  for (const keys of turnKeys.values()) {
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
    turns.push({ key: nodeKey, text: textOfContent(node?.data?.content) })
  }
  return turns
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

export function TurnRail({ session, scrollport }: { session: SessionFace; scrollport: HTMLElement }) {
  const snap = useSyncExternalStore(
    useCallback((cb: () => void) => session.subscribe(cb), [session]),
    useCallback(() => session.snapshotCache, [session]),
  )
  const turns = useMemo(() => collectTurns(snap?.chat), [snap])
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

  if (!box || turns.length < 2) return null

  const count = turns.length
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

  return (
    <div
      className={css.rail}
      style={{ top: box.top, height: areaH }}
      onMouseMove={(e) => enter(hoverFromPointer(e.clientY))}
      onMouseLeave={park}
    >
      <div ref={groupRef} className={css.group} style={{ top: groupTop, gap }}>
        {turns.map((t, i) => {
          const d = hoverPos === null ? Infinity : i - hoverPos
          return (
            <button
              key={t.key}
              type="button"
              className={css.line}
              style={{ height: HIT }}
              onClick={() => {
                const row = scrollport.querySelector<HTMLElement>(`[data-chat-anchor-key="${CSS.escape(t.key)}"]`)
                if (row) scrollToRow(scrollport, row)
              }}
              aria-label={`跳到第 ${i + 1} 个回合`}
            >
              <span
                className={css.bar}
                style={{
                  width: Math.round(width),
                  transform: `scaleX(${waveScale(d)})`,
                  opacity: waveGlow(d),
                  background: d < 0.5 && d > -0.5 ? 'var(--dsw-alias-label-primary)' : 'var(--dsw-alias-label-secondary)',
                }}
              />
            </button>
          )
        })}
      </div>
      {tip !== null && turns[tip] && (
        <div
          className={css.tip}
          style={{ top: groupTop + tip * (HIT + gap) + HIT / 2, right: width + 12 }}
          onMouseEnter={keepAlive}
          onMouseLeave={park}
        >
          <div className={css.tipTitle}>回合 {tip + 1}</div>
          <div className={css.tipText}>{(turns[tip].text || '(空消息)').slice(0, 200)}</div>
        </div>
      )}
    </div>
  )
}
