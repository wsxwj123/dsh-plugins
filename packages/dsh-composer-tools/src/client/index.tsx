/**
 * Client apply — dsh-composer-tools 的 client 半入口。
 *
 * inject：['slots', 'sessions']。把 ComposerEntry 注册进
 * `conversation.input.right` slot。用 `slots.inject` 而非直接 `register`：slot
 * 声明由 conversation 插件完成、加载顺序不保证，inject 等声明出现再跑（R10）。
 *
 * 红线（cordis + R6）：
 *   - callback 必须返回 `ctx.slots.register(...)` 的返回值（disposer）——
 *     runtime 的 slots.inject(key, callback) 语义是 "creates one disposer or an
 *     iterable of disposers"，漏返回会导致卸载/重挂时槽位不摘、面板残留。
 *   - 全部注册进 `ctx.effect` dispose 链（session-manager index.tsx 范本）。
 */
import { createElement } from 'react'
import type { Context } from './context-types.ts'
import { ComposerEntry } from './ComposerEntry.tsx'

export const inject = ['slots', 'sessions']

export const SLOT_ID = 'dsh-composer-tools'

export function apply(ctx: Context): void {
  // slots.inject(key, callback)：回调返回 disposer 或 disposer 的可迭代集合。
  // 这里只注册一个 entry，因此返回 slots.register 的 disposer。
  const offSlot = ctx.slots.inject('conversation.input.right', () =>
    ctx.slots.register(
      { name: 'conversation.input.right', id: SLOT_ID, order: 1000 },
      (props: Record<string, unknown>) =>
        // 透传 slot standard props（含 useInput / inputActions）给 ComposerEntry。
        createElement(ComposerEntry, { ctx, ...props } as never),
    ),
  )

  ctx.effect(() => () => {
    offSlot()
  }, 'dsh-composer-tools: client lifecycle (slot entry)')
}
