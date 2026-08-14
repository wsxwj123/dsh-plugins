/**
 * Structural types for the cordis services this client plugin consumes,
 * plus the Context augmentation. A third-party plugin resolves outside the
 * DSH monorepo's single cordis instance, so the upstream `declare module
 * 'cordis'` augmentations do not reach this Context. The members below
 * mirror the actual runtime shapes this plugin touches (read-only faces).
 */
import type { Context as CordisContext } from 'cordis'

/** One chat node (a row in the conversation flow). */
export interface ChatNode {
  key: string
  kind: string
  seq: number
  data?: {
    content?: string
    time?: number
  }
}

/** The assembled `chat` view snapshot (subset this plugin reads). */
export interface ChatSnapshot {
  /** Visible node keys in flow order. */
  order: string[]
  /** Keyed node store. */
  nodes: { get(key: string): ChatNode | undefined }
  /** Turn index: turn id → node keys (first key starts the turn). Absent on the empty snapshot. */
  locations: { turns?: Map<number, string[]> }
}

/** The runtime Session face this plugin reads (client side). */
export interface SessionFace {
  subscribe(listener: () => void): () => void
  snapshotCache: SessionSnapshot
}

/** The full session snapshot (subset). */
export interface SessionSnapshot {
  sessionId: string
  chat?: ChatSnapshot
}

/** The sessions service list feed (current session tracking). */
export interface SessionListFeed {
  getSnapshot(): { current?: string; byId: Record<string, unknown> }
  subscribe(callback: () => void): () => void
}

/** The client runtime `sessions` service face. */
export interface SessionsFace {
  list: SessionListFeed
  binding(id: string): { session: SessionFace } | undefined
}

/** Context augmentation for the services this plugin injects. */
export interface Context extends CordisContext {
  sessions: SessionsFace
  slots: unknown
  connection: unknown
}
