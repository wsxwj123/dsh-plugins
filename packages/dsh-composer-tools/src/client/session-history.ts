/**
 * 会话快照 user 消息提取（INTERFACE §2.7，纯函数）+ 采集控制器。
 *
 * 采集为什么走快照而不是 phase：DSH `InputState.onEnter` 对普通消息（非 `/`
 * 命令、非菜单 claim）直接 `return [{ type:'default-sink', draft, mode }]`，
 * **phase 全程保持 plain**（实测 data-phase 恒为 plain，见
 * dsh-client-ui-conversation/lib/client.js onEnter）。而且发送还可以来自「发送
 * 按钮点击」（`inputActions.submit()`），根本没有 keydown。所以"发送了什么"的
 * 唯一可靠信号是**会话快照里新落地的 user 节点**。
 *
 * 水位线（sawSeq）只记"已看到的最大 user seq"：翻页 loadOlder() 回填的低 seq
 * 旧消息被过滤；跨重连/会话重建导致 seq 回退（discontinuity）时冷重启水位线，
 * 宁可当前窗口不采，也不让新消息被旧水位线永久挡住。
 */

/** ContentBlock 中 type='text' 块的类型子集。 */
export interface TextBlockLike {
  type: 'text'
  text: string
}

/** 已受理的 user 消息节点（快照 `kind` 判别联合的一支）。 */
export interface UserNodeLike {
  kind: 'user'
  seq: number
  content: readonly unknown[]
}

export interface NewUserTexts {
  /** 本次应采的文本，按 seq 升序（空文本占位保留，交给 recordSend 判空）。 */
  texts: string[]
  /** 新水位线 = 本次快照所有 user 节点的最大 seq。 */
  sawSeq: number
  /** 新快照 max seq < 旧水位线（seq 回退）→ 调用方须冷重启水位线且不补录。 */
  discontinuity: boolean
}

/**
 * 只拼 `type === 'text'` 块的 `text`，块间以 '\n' 连接（多段落 prompt 还原换行）；
 * content 非数组 / 无 text 块 → ''。此处不 trim，空白由 recordSend 收口。
 */
export function userMessageText(content: unknown): string {
  if (!Array.isArray(content)) return ''
  const out: string[] = []
  for (const block of content) {
    if (block === null || typeof block !== 'object') continue
    const b = block as Partial<TextBlockLike>
    if (b.type !== 'text' || typeof b.text !== 'string') continue
    out.push(b.text)
  }
  return out.join('\n')
}

/** kind === 'user' 判别（assistant/command/steering/context 及非对象一律 false）。 */
export function isUserMessageNode(node: unknown): node is UserNodeLike {
  if (node === null || typeof node !== 'object') return false
  return (node as { kind?: unknown }).kind === 'user'
}

/**
 * 快照 diff：取 seq > sawSeq 的 user 消息文本（按 seq 升序）。
 * 无新消息且无断裂 → null。nodes 非数组 → 按空处理（水位线不动）。
 * sawSeq 负数/NaN/非数 → 视为 -Infinity（首个快照全采）。
 */
export function newUserTexts(nodes: unknown, sawSeq: number): NewUserTexts | null {
  if (!Array.isArray(nodes)) return { texts: [], sawSeq, discontinuity: false }
  // seq 非有限数的畸形节点直接丢弃：否则 max 会变 NaN 把水位线永久毒化。
  const users = nodes.filter(
    (n): n is UserNodeLike => isUserMessageNode(n) && Number.isFinite(n.seq),
  )
  if (users.length === 0) return null
  const base = typeof sawSeq === 'number' && Number.isFinite(sawSeq) && sawSeq >= 0 ? sawSeq : -Infinity
  let max = -Infinity
  for (const n of users) if (n.seq > max) max = n.seq
  if (max < base) return { texts: [], sawSeq: max, discontinuity: true }
  const fresh = users.filter((n) => n.seq > base).sort((a, b) => a.seq - b.seq)
  if (fresh.length === 0) return null
  return { texts: fresh.map((n) => userMessageText(n.content)), sawSeq: max, discontinuity: false }
}

export interface SnapshotCapture {
  /** 喂一帧快照的 nodes；新增 user 消息文本逐条回调 record。 */
  onSnapshot(nodes: unknown): void
}

/**
 * 采集控制器：持有本次订阅的水位线。
 * **首帧只初始化水位线、不回补**（会话里已有的旧消息不算"本次发送"）；断裂帧同样
 * 只重置水位线不补录。ComposerEntry 每次（重新）订阅一个会话就新建一个实例。
 */
export function createSnapshotCapture(record: (text: string) => void): SnapshotCapture {
  let sawSeq = -Infinity
  let primed = false
  return {
    onSnapshot(nodes: unknown): void {
      const first = !primed
      primed = true
      const r = newUserTexts(nodes, sawSeq)
      if (r === null) return
      sawSeq = r.sawSeq
      if (first || r.discontinuity) return
      for (const text of r.texts) record(text)
    },
  }
}
