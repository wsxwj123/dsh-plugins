/**
 * 0.2.2+ 发送采集（会话事件流）：从 SessionEventStream 的 `user/message` 事件提取
 * 人类用户输入。
 *
 * 为什么新增这条路径（真机 + 0.2.2 源码取证）：
 *   - 0.1.5–0.2.0：`sessions.binding(id).session.getSnapshot().nodes` 里有
 *     `kind:'user'` 节点，session-history.ts 的水位线 diff 就是主采集路径。
 *   - 0.2.2-rc.5：Session.buildSnapshot() 只返回 running/promptError/... 等
 *     生命周期字段，**不再有 nodes**（源码位置：dsh-api-session-controller
 *     lib/types/client/sessions/session.js buildSnapshot）。旧节点路径在 0.2.2
 *     恒空 → 发送采集静默失效。
 *   - 0.2.2 的会话事件流仍在 SessionBinding 上：`binding.eventSource`
 *     （MutableSessionEventSource，同步发布 change）。事件流 append 的
 *     `user/message` 事件里，`data.source.kind === 'user'` 才是真人输入；
 *     同类型的其它 source（system-reminder / time-context / retry /
 *     compact-checkpoint…）是宿主注入的 user-role 上下文，必须过滤。
 *
 * 水位线按 `event.seq`：attach 首帧只建水位线不回补；replace（历史重载）重置
 * 水位线不补录；prepend（翻页）放行；append 只采 seq > 水位线的新事件。
 */
import { userMessageText } from './session-history.ts'
import type { SessionEventFeedLike } from './context-types.ts'

export type { SessionEventFeedLike }

/** 事件流条目：`{ event }`（transient 条目也带 event）。 */
function eventOfEntry(entry: unknown): unknown {
  if (entry === null || typeof entry !== 'object') return null
  return (entry as { event?: unknown }).event ?? null
}

/** 条目的 `event.seq`；非有限数 → -Infinity（不推进水位线）。 */
function seqOfEntry(entry: unknown): number {
  const event = eventOfEntry(entry)
  if (event === null || typeof event !== 'object') return -Infinity
  const seq = (event as { seq?: unknown }).seq
  return typeof seq === 'number' && Number.isFinite(seq) ? seq : -Infinity
}

/**
 * 从一条会话事件提取"人类用户消息"文本。
 * 非 `user/message`、非对象、`source.kind !== 'user'`（宿主注入的 user-role
 * 上下文/命令/重试事件）→ null。
 * @param event - 事件流里的 SessionEvent。
 * @returns 用户输入全文（content 只拼 text 块）；非人类消息 → null。
 */
export function userTextFromEvent(event: unknown): string | null {
  if (event === null || typeof event !== 'object') return null
  const candidate = event as { type?: unknown; data?: unknown }
  if (candidate.type !== 'user/message') return null
  if (candidate.data === null || typeof candidate.data !== 'object') return null
  const data = candidate.data as { source?: unknown; content?: unknown }
  const source = data.source
  if (source === null || typeof source !== 'object') return null
  if ((source as { kind?: unknown }).kind !== 'user') return null
  return userMessageText(data.content)
}

export interface EventFeedCapture {
  /** 喂一帧事件流快照；append 的新人类消息逐条回调 record。 */
  onSnapshot(feed: SessionEventFeedLike | undefined): void
}

/**
 * 采集控制器：持有本次订阅的 seq 水位线。首帧只初始化水位线、不回补。
 * @param record - 收到一条已受理的人类用户输入时回调。
 * @returns 事件流采集控制器。
 */
export function createEventFeedCapture(record: (text: string) => void): EventFeedCapture {
  let lastSeq = -Infinity
  let primed = false
  const maxSeq = (entries: readonly unknown[]): number => {
    let max = -Infinity
    for (const entry of entries) {
      const seq = seqOfEntry(entry)
      if (seq > max) max = seq
    }
    return max
  }
  return {
    onSnapshot(feed: SessionEventFeedLike | undefined): void {
      if (feed === undefined || feed === null || typeof feed.getSnapshot !== 'function') return
      const snapshot = feed.getSnapshot()
      if (snapshot === undefined || snapshot === null) return
      const entries = Array.isArray(snapshot.entries) ? snapshot.entries : []
      if (!primed) {
        primed = true
        lastSeq = maxSeq(entries)
        return
      }
      const change = snapshot.change
      const changed = Array.isArray(change?.entries) ? (change?.entries as readonly unknown[]) : []
      if (change?.kind === 'replace') {
        // 完整窗口替换（重连/历史重载）：水位线跟窗口走，不补录；seq 若回退也
        // 以新窗口为准，避免重载后的新事件被旧水位线永久挡住。
        lastSeq = maxSeq(entries)
        return
      }
      if (change?.kind !== 'append') return
      // 同步 append：entries 就是新事件；seq 水位线兜底防重复。
      for (const entry of changed) {
        const seq = seqOfEntry(entry)
        if (!(seq > lastSeq)) continue
        const text = userTextFromEvent(eventOfEntry(entry))
        if (text !== null) record(text)
      }
      lastSeq = Math.max(lastSeq, maxSeq(changed))
    },
  }
}
