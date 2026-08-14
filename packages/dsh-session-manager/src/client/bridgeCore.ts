/**
 * bridgeCore — the pure, dependency-injected client→host HTTP core (no browser
 * globals beyond the default `fetch`). Kept in its own module so a node unit
 * test can import the compiled `lib/bridge-core.js` and drive every transport
 * failure mode with a stubbed fetch — the browser wiring itself (bridge.ts) is
 * a thin caller on top.
 *
 * Review I-5: a network-level rejection (host restart, momentary disconnect,
 * abort) must NEVER surface as an unhandled rejection at a call site. Every
 * transport failure is mapped to a structured `{ ok:false, code:'network-error' }`
 * result so smTrash/smEmptyTrash/smUnarchive callers branch on it and show
 * visible feedback instead of dying silently.
 */

/** A successful or failed JSON response from the host. */
export interface SmResult {
  ok: boolean
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any
}

/** The fetch-like surface this core needs (a structural subset of Response). */
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
 * POST one JSON RPC call and normalize every failure mode into a structured
 * `SmResult`. This function NEVER rejects:
 *   - transport/network errors  → `{ ok:false, code:'network-error' }` (I-5)
 *   - HTTP error status         → `{ ok:false, code:'http-<status>' }`
 *   - non-JSON success body     → `{ ok:false, code:'invalid-response' }`
 *   - 200 JSON body             → passed through untouched.
 * @param path - the full request path (e.g. `/sm/delete`).
 * @param body - JSON-serializable payload (`{}` when absent).
 * @param fetchImpl - platform fetch by default; tests inject a stub.
 */
export async function postJson(path: string, body: unknown, fetchImpl: FetchLike = fetch): Promise<SmResult> {
  let res: HttpLike
  try {
    res = await fetchImpl(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    })
  } catch (err) {
    // I-5: the single place every network rejection is caught. Callers receive
    // a structured failure and surface it; no unhandled rejection, no silence.
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, code: 'network-error', message }
  }
  // 4xx/5xx are contract violations (bad-input / untrusted-origin); surface
  // them as a structured failure so the caller can branch without swallowing.
  if (!res.ok) {
    return { ok: false, code: `http-${res.status}`, message: `request failed with status ${res.status}` }
  }
  let json: unknown
  try {
    json = await res.json()
  } catch {
    return { ok: false, code: 'invalid-response', message: 'host returned a non-JSON body' }
  }
  return json as SmResult
}
