/**
 * bridgeCore — 纯、可注入 fetch 的 client→host HTTP 核心（无浏览器全局，除默认 fetch）。
 *
 * 与本仓库 dsh-session-manager/src/client/bridgeCore.ts 同模式。运输层失败绝不作为
 * unhandled rejection 上抛：一切失败统一映射为结构化 `{ ok:false, code, message }`，
 * 供桥接调用方分支反馈，不静默。
 */
/** 一个成功或失败的 JSON 结果（host 返回面）。 */
export interface CtResult {
  ok: boolean
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any
}

/** 本核心需要的 fetch-like 结构（Response 的结构子集）。 */
export interface HttpLike {
  ok: boolean
  status: number
  json(): Promise<unknown>
}

export type FetchLike = (
  input: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<HttpLike>

/**
 * POST 一个 JSON RPC 并归一所有失败模式为结构化 `CtResult`。永不 reject：
 *   - 运输/网络错误    → { ok:false, code:'network-error', message }
 *   - HTTP 错误状态    → { ok:false, code:'http-<status>', message }
 *   - 非 JSON 成功体   → { ok:false, code:'invalid-response', message }
 *   - 200 JSON 体      → 原样透传。
 * @param path - 完整请求路径（如 '/ct/instructions.list'）。
 * @param body - JSON 可序列化载荷（缺省 {}）。
 * @param fetchImpl - 平台 fetch 默认；测试注入替身。
 */
export async function postJson(path: string, body: unknown, fetchImpl: FetchLike = fetch): Promise<CtResult> {
  let res: HttpLike
  try {
    res = await fetchImpl(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, code: 'network-error', message }
  }
  if (!res.ok) {
    return { ok: false, code: `http-${res.status}`, message: `request failed with status ${res.status}` }
  }
  let json: unknown
  try {
    json = await res.json()
  } catch {
    return { ok: false, code: 'invalid-response', message: 'host returned a non-JSON body' }
  }
  return json as CtResult
}
