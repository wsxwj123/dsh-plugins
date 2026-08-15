/**
 * localStorage 读写（INTERFACE §2.3，纯函数）。
 *
 * 历史按 sessionId 隔离，key 恰为 'dsh-composer-tools:history:' + sessionId。
 * loadHistory 全容错：key 不存在/坏 JSON/非数组 → []; 过滤非 string 项; 裁到上限。
 * saveHistory 写前 100 条；setItem 抛错（配额满）返回 false 不抛出。
 */
import { HISTORY_LIMIT } from './history-core.ts'

export interface KeyValueStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

/** 恰为 'dsh-composer-tools:history:' + sessionId。 */
export function historyStorageKey(sessionId: string): string {
  return 'dsh-composer-tools:history:' + sessionId
}

/**
 * key 不存在 / JSON 解析失败 / 解析结果非数组 → []。
 * 数组中非 string 项被过滤；结果裁到 HISTORY_LIMIT 条。
 */
export function loadHistory(storage: KeyValueStorage, sessionId: string): string[] {
  const raw = storage.getItem(historyStorageKey(sessionId))
  if (raw === null) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  const strings = parsed.filter((x): x is string => typeof x === 'string')
  return strings.slice(0, HISTORY_LIMIT)
}

/**
 * 写入 JSON.stringify(entries.slice(0, HISTORY_LIMIT))；setItem 抛错（配额满等）
 * → 返回 false，不抛出。
 */
export function saveHistory(storage: KeyValueStorage, sessionId: string, entries: string[]): boolean {
  try {
    storage.setItem(historyStorageKey(sessionId), JSON.stringify(entries.slice(0, HISTORY_LIMIT)))
    return true
  } catch {
    return false
  }
}
