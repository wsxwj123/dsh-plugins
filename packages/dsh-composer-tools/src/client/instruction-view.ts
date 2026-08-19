/**
 * instruction-view — InstructionsTab 的视图状态机（INTERFACE §2.6，增量 2）。
 *
 * 把原来的 phase + expanded 组合收敛为显式视图状态机：list / create(scope) /
 * edit(path)。状态迁移逻辑是纯 reducer——无 DOM/React 依赖，node --test 直接
 * 驱动（构建进 node ESM 产物 lib/instruction-view.js）。组件只负责「把事件喂给
 * reducer、把结果渲染」；取消确认（"放弃未保存的修改？"）等交互在调用层完成，
 * reducer 只做状态迁移。
 *
 * 判定规则逐条对应 INTERFACE §2.6（自上而下命中；纯函数、不改入参）：
 *   1. open-list        → { kind:'list' }（任何状态都可回列表）
 *   2. start-create     → { kind:'create', scope, pending:true }；
 *                         已在同 scope 的 create 态 → 原样返回（防重复点击）
 *   3. create-pending   → 保持当前 create 态、pending:true
 *   4. create-succeeded → 当前为 create 态时 { kind:'create', scope, pending:false, path }
 *                         （dirty 不置位）；否则原样返回
 *   5. create-failed    → { kind:'list' }（错误已在调用层提示）
 *   6. open-edit        → { kind:'edit', path, dirty:false }
 *   7. mark-dirty       → 当前为 edit / create（已成功拿到 path）时置 dirty:true
 *   8. saved            → path 匹配当前编辑目标 → { kind:'list' }；否则原样返回
 *   9. cancel-edit      → { kind:'list' }（未保存确认由调用层先做完再发本事件）
 */

export type InstructionScope = 'project' | 'global'

export type InstructionView =
  | { kind: 'list' }
  | { kind: 'create'; scope: InstructionScope; pending?: boolean; path?: string; dirty?: boolean }
  | { kind: 'edit'; path: string; dirty?: boolean }

export type InstructionViewEvent =
  | { type: 'open-list' }
  | { type: 'start-create'; scope: InstructionScope }
  | { type: 'create-pending' }
  | { type: 'create-succeeded'; path: string }
  | { type: 'create-failed' }
  | { type: 'open-edit'; path: string }
  | { type: 'mark-dirty' }
  | { type: 'saved'; path: string }
  | { type: 'cancel-edit' }

export function instructionViewReducer(
  view: InstructionView,
  event: InstructionViewEvent,
): InstructionView {
  switch (event.type) {
    case 'open-list':
      return { kind: 'list' }
    case 'start-create':
      // 同 scope 重复点击 → 原样返回（同一引用），防重复发请求
      if (view.kind === 'create' && view.scope === event.scope) return view
      return { kind: 'create', scope: event.scope, pending: true }
    case 'create-pending':
      if (view.kind === 'create') return { ...view, pending: true }
      return view
    case 'create-succeeded':
      // 文件已落盘，停留 create 态载入编辑器；未保存前 dirty 不置位
      if (view.kind === 'create') {
        return { kind: 'create', scope: view.scope, pending: false, path: event.path }
      }
      return view
    case 'create-failed':
      return { kind: 'list' }
    case 'open-edit':
      return { kind: 'edit', path: event.path, dirty: false }
    case 'mark-dirty':
      if (view.kind === 'edit' || (view.kind === 'create' && view.pending === false && view.path !== undefined)) {
        return { ...view, dirty: true }
      }
      return view
    case 'saved':
      if ((view.kind === 'edit' || view.kind === 'create') && view.path === event.path) {
        return { kind: 'list' }
      }
      return view
    case 'cancel-edit':
      return { kind: 'list' }
    default:
      return view
  }
}
