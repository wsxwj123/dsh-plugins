/**
 * Client wrapper around the host `turnIndex` RPC: types the payload, caches
 * the full index per `(sessionId, snapshot fingerprint)`, and guards against
 * the session-switch race (重要 3) by verifying the response's sessionId.
 *
 * The fingerprint tracks the loaded snapshot's turn count / visible order
 * length. Loading older history grows the loaded window, so the fingerprint
 * changes and the cache re-fetches — that is harmless: the host index is
 * authoritative and stable (only new turns advance `total`), so a re-fetch
 * returns the same result and the rail never flickers.
 *
 * Failures (session-not-found / unavailable / transport / sessionId mismatch)
 * surface as `null` so callers degrade to the "loaded-only" rail (INTERFACE
 * §2.5) instead of blanking or throwing.
 */
import type { ConnectionFace, ChatSnapshot, TurnIndexResponse, TurnIndexResult } from './context-types.ts'

/** Channel + endpoint registered by the node half (INTERFACE §1.1). */
export const TURN_INDEX_CHANNEL = '/turn-scrubber'
export const TURN_INDEX_ENDPOINT = 'turnIndex'

interface CacheEntry {
  fingerprint: string
  result: TurnIndexResult | null
}

const cache = new Map<string, CacheEntry>()

/** Snapshot fingerprint: loaded turn count + visible order length. */
export function indexFingerprint(chat: ChatSnapshot | undefined): string {
  if (chat === undefined) return 'e:0'
  const turnsSize = chat.locations?.turns?.size ?? 0
  return `${turnsSize}:${chat.order.length}`
}

/**
 * Fetch (or return cached) turn index for a session.
 * @param connection - injected client connection service face.
 * @param sessionId - the session the caller is bound to.
 * @param chat - current chat snapshot used for the cache fingerprint.
 * @returns the index, or null when unavailable (degrade path).
 */
export async function loadTurnIndex(
  connection: ConnectionFace,
  sessionId: string,
  chat: ChatSnapshot | undefined,
): Promise<TurnIndexResult | null> {
  const fingerprint = indexFingerprint(chat)
  const cached = cache.get(sessionId)
  if (cached !== undefined && cached.fingerprint === fingerprint) return cached.result

  let result: TurnIndexResult | null = null
  try {
    const response = await connection.rpc.call<TurnIndexResponse>(TURN_INDEX_CHANNEL, TURN_INDEX_ENDPOINT, { sessionId })
    // 重要 3: the response names the session it was built from — discard any
    // index that does not match the session we asked about (stale cross-session
    // data must never paint the current rail).
    if (response.ok === true) {
      if (response.value.sessionId === sessionId) {
        result = response
        console.log(`[dsh-turn-scrubber] turnIndex loaded: session=${sessionId} total=${response.value.total}`)
      } else {
        // Silent path: ok but sessionId mismatch — must never happen; log it.
        console.warn('[dsh-turn-scrubber] turnIndex sessionId mismatch:', JSON.stringify(response).slice(0, 300))
      }
    } else {
      // Business failure (session-not-found / unavailable) — degrade silently.
      console.warn(`[dsh-turn-scrubber] turnIndex failed for session: ${response.error.code}`)
    }
  } catch (error) {
    // Transport failure / HTTP non-2xx (connection.rpc.call throws) — degrade.
    console.warn('[dsh-turn-scrubber] turnIndex unavailable:', error instanceof Error ? error.message : String(error))
  }

  cache.set(sessionId, { fingerprint, result })
  return result
}

/** Drop this session's cached index (call on teardown / session switch). */
export function clearTurnIndexCache(sessionId: string): void {
  cache.delete(sessionId)
}

/** Drop every cached index (plugin dispose). */
export function resetTurnIndexCache(): void {
  cache.clear()
}