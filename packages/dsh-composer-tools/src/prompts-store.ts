/**
 * Prompt library backend (host side, PLAN §1.2 module 3, INTERFACE §1.4).
 *
 * Reads `data/prompt-templates.json` (780 entries, copied from the Claude GUI,
 * Cherry HQ/cherry-studio, AGPL-3.0 — do NOT re-license). The file is read ONCE
 * on first use and cached in-process for the lifetime of the host (subsequent
 * /ct/prompts requests do not re-read the disk; a restart picks up edits).
 *
 * Normalisation: every item's `prompt` / `description` is emitted with `\r\n`
 * collapsed to `\n`. The `source` field carries the origin + AGPL-3.0 licence
 * so the client panel can always attribute the data (PLAN R4).
 *
 * The only error path: the data file is unreadable or fails to parse → the
 * caller (handler) maps it to HTTP 200 `{ ok:false, code:'system-error',
 * message:'prompt library unavailable: '+String(err) }`.
 */

import { readFile } from 'node:fs/promises'

/** Data file location, relative to this module (source `src/` or build `lib/`). */
export const PROMPTS_DATA_URL = new URL('../data/prompt-templates.json', import.meta.url)

export interface PromptItem {
  id: string
  name: string
  description: string
  prompt: string
  emoji: string
  group: string[]
}

export type PromptsOutput =
  | { ok: true; json: { ok: true; source: { name: string; url: string; license: string }; items: PromptItem[] } }
  | { ok: false; json: { ok: false; code: 'system-error'; message: string } }

const SOURCE = {
  name: 'Cherry Studio agents-zh.json',
  url: 'https://github.com/CherryHQ/cherry-studio',
  license: 'AGPL-3.0',
}

/** In-process cache: the parsed+normalised item array, or the failure sentinel. */
let cached: { ok: true; items: PromptItem[] } | { ok: false; error: string } | undefined

/**
 * Load the prompt library once and return either the full 200 response object
 * or a domain error object (both `ok` keyed). Never rejects.
 *
 * @param overrideItems - optional injected item list (test harness). When
 *   provided, the disk data file and cache are bypassed entirely; the items
 *   are normalised (\r\n → \n) exactly like disk data. Production callers
 *   omit it and get the real 780-item library.
 * @param overrideError - optional injected failure (test harness). When set,
 *   loadPrompts behaves exactly as if the disk read had failed with this
 *   message — the response is the same `prompt library unavailable: <msg>`
 *   system-error shape the real failure path produces.
 */
export async function loadPrompts(overrideItems?: PromptItem[], overrideError?: string): Promise<PromptsOutput> {
  try {
    let ready: { ok: true; items: PromptItem[] } | { ok: false; error: string }
    if (overrideError !== undefined) {
      ready = { ok: false, error: overrideError }
    } else if (overrideItems !== undefined) {
      ready = { ok: true, items: normalizeItems(overrideItems) }
    } else {
      ready = cached ?? (cached = await loadFromDisk())
    }
    if (!ready.ok) {
      return { ok: false, json: { ok: false, code: 'system-error', message: `prompt library unavailable: ${ready.error}` } }
    }
    return { ok: true, json: { ok: true, source: SOURCE, items: ready.items } }
  } catch (err) {
    // Residual synchronous/async failure (cache assignment racing, etc.).
    cached = { ok: false, error: String(err) }
    return { ok: false, json: { ok: false, code: 'system-error', message: `prompt library unavailable: ${String(err)}` } }
  }
}

/** For tests/edge cases: drop the in-process cache so the next call re-reads. */
export function resetPromptsCache(): void {
  cached = undefined
}

async function loadFromDisk(): Promise<{ ok: true; items: PromptItem[] } | { ok: false; error: string }> {
  let raw: Buffer
  try {
    raw = await readFile(PROMPTS_DATA_URL)
  } catch (err) {
    return { ok: false, error: String(err) }
  }

  let data: unknown
  try {
    data = JSON.parse(raw.toString('utf8'))
  } catch (err) {
    return { ok: false, error: String(err) }
  }

  if (!Array.isArray(data)) {
    return { ok: false, error: 'prompt data is not an array' }
  }

  const normalize = (value: unknown, key: string): string => {
    if (typeof value !== 'string') return '' // tolerate optional/absent fields
    return value.includes('\r\n') ? value.replace(/\r\n/g, '\n') : value
  }

  const items: PromptItem[] = normalizeItems(data as unknown[])

  return { ok: true, items }
}

/** Normalise raw records into PromptItem[] (tolerate missing fields, \r\n → \n). */
function normalizeItems(raw: unknown[]): PromptItem[] {
  const normalize = (value: unknown, key: string): string => {
    if (typeof value !== 'string') return '' // tolerate optional/absent fields
    return value.includes('\r\n') ? value.replace(/\r\n/g, '\n') : value
  }
  return raw.map((rawItem) => {
    const it = (rawItem && typeof rawItem === 'object' ? rawItem : {}) as Record<string, unknown>
    return {
      id: typeof it.id === 'string' ? it.id : '',
      name: typeof it.name === 'string' ? it.name : '',
      description: normalize(it.description, 'description'),
      prompt: normalize(it.prompt, 'prompt'),
      emoji: typeof it.emoji === 'string' ? it.emoji : '',
      group: Array.isArray(it.group) ? (it.group.filter((g) => typeof g === 'string') as string[]) : [],
    }
  })
}
