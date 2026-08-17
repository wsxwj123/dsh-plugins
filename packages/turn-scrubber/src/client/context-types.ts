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
  /** Pull one older page (~50 messages) and prepend it into the window. */
  loadOlder(): Promise<void>
}

/** The full session snapshot (subset). */
export interface SessionSnapshot {
  sessionId: string
  chat?: ChatSnapshot
  /** Host-authoritative: whether older history remains outside the window. */
  hasMore: boolean
  /** Whether an older-page load is currently in flight. */
  loadingOlder: boolean
  /** 'open' | 'cold' | 'loading' | 'error' — only 'open' may load older. */
  openState?: string
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

/** Generic connection.rpc client face (dsh-client-connection handle.rpc). */
export interface ConnectionRpc {
  call<T = unknown>(channel: string, endpoint: string, payload?: unknown, signal?: AbortSignal): Promise<T>
}

/** The client runtime `connection` service face (read-only handle). */
export interface ConnectionFace {
  rpc: ConnectionRpc
}

// --- Turn index payload types (INTERFACE §1.3/§1.4) -----------------------

export interface TurnIndexEntry {
  turn: number
  preview: string
  compacted: boolean
}

/** 通用 RPC 成功载荷：业务数据在 `value` 里（client schema 剥掉其他字段）。 */
export interface TurnIndexResult {
  ok: true
  value: {
    sessionId: string
    asOfSeq: number
    total: number
    turns: TurnIndexEntry[]
  }
}

export interface TurnIndexError {
  ok: false
  error: {
    code: 'session-not-found' | 'unavailable'
    message: string
    details: Record<string, unknown>
  }
}

export type TurnIndexResponse = TurnIndexResult | TurnIndexError

/** ensureTurnLoaded outcome (INTERFACE §3 suggestion 1). */
export type EnsureLoadedResult = '达成' | '到最老' | '超限' | '会话切换' | '已加载'

/** Context augmentation for the services this plugin injects. */
export interface Context extends CordisContext {
  sessions: SessionsFace
  slots: unknown
  connection: ConnectionFace
}