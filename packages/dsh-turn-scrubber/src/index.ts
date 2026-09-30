/**
 * Node half of dsh-turn-scrubber: serves the full turn index for any session
 * on a loopback connection.rpc channel.
 *
 * The rail needs per-turn facts that only exist on the host (total turn count,
 * compaction markers, previews of not-yet-loaded turns). This half answers
 * one read-only endpoint:
 *
 *   POST {origin}/turn-scrubber/turnIndex   {type:'client-request',rpcId,method:'turnIndex',payload:{sessionId}}
 *
 * Data source (live first, then persistence cold read):
 *   1. `ctx.sessions.get(sessionId)` exists → its append-only `events`;
 *   2. otherwise `sessionPersistence.inspect(sessionId)` → `{meta, events}`;
 *   3. neither → `session-not-found`.
 *
 * Response contract (INTERFACE §1.3/§1.4): business errors are ALWAYS HTTP 200
 * with `result.ok === false`; the envelope layer alone decides non-200 codes.
 */
import { buildTurnIndex, type TurnIndexBuildResult, type TurnIndexEvent } from './turn-index.ts'

/**
 * Services required on the host before this plugin may apply.
 *
 * `webServer` is not read here, but `connection.rpc.handle` registers the route
 * on the OWNER context's web server: 0.2 resolves `owner.webServer`
 * unconditionally while 0.1.5 falls back to its own `webCtx`. Declaring the
 * service keeps the 0.2 RPC channel registrable (and is harmless on 0.1.5).
 */
export const inject = ['connection', 'sessionPersistence', 'sessions', 'webServer']

/** Business error codes this endpoint can return (INTERFACE §1.4). */
type ErrorCode = 'session-not-found' | 'unavailable' | 'bad-request'

interface RpcError {
  code: ErrorCode
  message: string
  details: Record<string, unknown>
}

interface TurnIndexOk {
  ok: true
  /** 通用 RPC 成功契约：业务数据必须放在 `value`（client schema 会剥掉其他字段）。 */
  value: {
    sessionId: string
    asOfSeq: number
    total: number
    turns: TurnIndexBuildResult['turns']
  }
}

interface TurnIndexFail {
  ok: false
  error: RpcError
}

type TurnIndexResponse = TurnIndexOk | TurnIndexFail

/** Structural face of the host services this half reads (no value imports). */
interface NodeContext {
  connection: {
    rpc: {
      handle(
        channel: string,
        handler: (endpoint: string, payload: unknown, signal?: AbortSignal) => unknown,
      ): unknown
    }
  }
  sessionPersistence: {
    inspect(id: string, signal?: AbortSignal): Promise<{ meta: { origin?: string }; events: TurnIndexEvent[] }>
  }
  sessions: {
    get(id: string): { header: { origin?: string }; events: TurnIndexEvent[] } | undefined
  }
}

/** Stable, content-free failure messages (INTERFACE §1.4: message 不含会话内容). */
const MESSAGE = {
  notFound: 'session not found',
  unavailable: 'session history unavailable',
  badRequest: 'sessionId is required',
} as const

const okResponse = (sessionId: string, built: TurnIndexBuildResult): TurnIndexOk => ({
  ok: true,
  value: {
    sessionId,
    asOfSeq: built.asOfSeq,
    total: built.total,
    turns: built.turns,
  },
})

/**
 * Build the index for one session from live store first, persistence cold read
 * as fallback. Subagent-owned identities are refused as `session-not-found`
 * (PLAN risk 4: subagent lifecycle belongs to its own routing).
 */
async function resolveIndex(ctx: NodeContext, sessionId: string, signal?: AbortSignal): Promise<TurnIndexResponse> {
  try {
    const live = ctx.sessions.get(sessionId)
    if (live !== undefined) {
      if (live.header.origin === 'subagent') {
        return { ok: false, error: { code: 'session-not-found', message: MESSAGE.notFound, details: { sessionId } } }
      }
      // Defensive copy: the live log keeps appending (host-apiproxy spreads too).
      return okResponse(sessionId, buildTurnIndex([...live.events]))
    }

    const persistence = ctx.sessionPersistence
    if (persistence === undefined) {
      // Neither live store nor a persistence backend can serve the identity.
      return { ok: false, error: { code: 'session-not-found', message: MESSAGE.notFound, details: { sessionId } } }
    }
    const inspected = await persistence.inspect(sessionId, signal)
    if (inspected.meta.origin === 'subagent') {
      return { ok: false, error: { code: 'session-not-found', message: MESSAGE.notFound, details: { sessionId } } }
    }
    return okResponse(sessionId, buildTurnIndex(inspected.events))
  } catch (error) {
    // Covers "session \"id\" not found" from inspect and any backend read
    // failure — both map to the business contract, never a raw throw. Errors
    // are not logged with content: only the stable message travels.
    const message = error instanceof Error ? error.message : String(error)
    const code: ErrorCode = message.includes('not found') ? 'session-not-found' : 'unavailable'
    return { ok: false, error: { code, message: message.includes('not found') ? MESSAGE.notFound : MESSAGE.unavailable, details: { sessionId } } }
  }
}

/** The single endpoint handler for the `/turn-scrubber` channel. */
function turnIndexHandler(ctx: NodeContext) {
  return async (endpoint: string, payload: unknown, signal?: AbortSignal): Promise<TurnIndexResponse> => {
    if (endpoint !== 'turnIndex') {
      return { ok: false, error: { code: 'bad-request', message: MESSAGE.badRequest, details: {} } }
    }
    const sessionId = (payload as { sessionId?: unknown } | undefined)?.sessionId
    if (typeof sessionId !== 'string' || sessionId === '') {
      // Caller bug (INTERFACE修订2a). The generic rpc channel fixes all
      // handler results at HTTP 200 (only non-JSON bodies get 400), so this is
      // reported as a business bad-request exactly like method mismatches.
      return { ok: false, error: { code: 'bad-request', message: MESSAGE.badRequest, details: {} } }
    }
    return resolveIndex(ctx, sessionId, signal)
  }
}

export function apply(ctx: NodeContext): void {
  // Two-arg form: `handle` never accepted a third options argument on either
  // 0.1.5 or 0.2 (it was silently ignored), and loopback-only isolation comes
  // from the host RPC channel boundary, not from a caller-supplied flag.
  ctx.connection.rpc.handle('/turn-scrubber', turnIndexHandler(ctx))
}