/**
 * client→host bridge: raw fetch over the same-origin `/sm/*` RPC surface.
 *
 * Wiring note (matches the node half's own decision, see src/handler.ts): the
 * `/sm` prefix route is a RAW HTTP JSON surface — it returns `{ ok:true, … }`
 * directly and accepts a raw `{ id, cwd, title }` body, guarded by the node
 * half's loopback trust fence. This file is the client's thin typed caller.
 *
 * Every call is a JSON POST (GET-free), so the browser sends `Sec-Fetch-Site`
 * same-origin and the loopback Host the node fence requires.
 */

/** A successful or failed JSON response from the host. */
export interface SmResult {
  ok: boolean
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any
}

const BASE = '/sm'

async function post(path: string, body: unknown): Promise<SmResult> {
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  })
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

/**
 * Delete a session (recycle-bin move + optional archive-set cleanup). Fired
 * from the pending-delete state machine when the 10s window expires.
 * @param id - session id.
 * @param cwd - cwd label used to locate the project dir on the host.
 * @param title - display title for the trash record (identify-in-trash only).
 */
export function smDelete(id: string, cwd: string, title: string): Promise<SmResult> {
  return post('/delete', { id, cwd, title })
}

/** Restore a session from the recycle bin. */
export function smRestore(id: string): Promise<SmResult> {
  return post('/restore', { id })
}

/** Remove a session id from the archive set (`unarchive`). */
export function smUnarchive(id: string): Promise<SmResult> {
  return post('/unarchive', { id })
}

/** List the confirmed recycle-bin entries (debug/re-read only). */
export function smTrash(): Promise<SmResult> {
  return post('/trash', {})
}

/**
 * Empty the recycle bin. Requires an explicit `confirm:true` payload — the
 * client prompts a dialog before calling this (unrecoverable action).
 */
export function smEmptyTrash(confirm: true): Promise<SmResult> {
  return post('/emptyTrash', { confirm })
}
