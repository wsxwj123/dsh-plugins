/**
 * 方向键门槛判定（INTERFACE §2.1，纯函数）。
 *
 * document capture keydown 在拦截前调用本函数判定是否放行。只有本 composer 的
 * textarea 目标、无修饰键、非 IME 合成期、菜单未打开、无选区时的跨行边界按键
 * 才会触发历史导航；其余一律返回 null（不拦截，原生行为原样发生）。
 */
export interface ArrowGateInput {
  /** e.target 就是本 composer 的 textarea（焦点前置条件）。 */
  isComposerTarget: boolean
  /** KeyboardEvent.key。 */
  key: string
  /** textarea 当前全文。 */
  text: string
  selectionStart: number
  selectionEnd: number
  /** KeyboardEvent.isComposing（IME 合成期）。 */
  isComposing: boolean
  shiftKey: boolean
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  /** menuOpen：调用方判定（INTERFACE §3，含失败兜底）。 */
  menuOpen: boolean
}

export type ArrowAction = 'older' | 'newer'

export function arrowGateAction(input: ArrowGateInput): ArrowAction | null {
  const {
    isComposerTarget,
    key,
    text,
    selectionStart,
    selectionEnd,
    isComposing,
    shiftKey,
    ctrlKey,
    metaKey,
    altKey,
    menuOpen,
  } = input

  // 0. 焦点前置：目标必须是本 composer 的 textarea 本身。
  if (isComposerTarget !== true) return null
  // 1. 只处理 ↑/↓；←/→ 永不触发。
  if (key !== 'ArrowUp' && key !== 'ArrowDown') return null
  // 2. 任一修饰键按下都放行。
  if (shiftKey || ctrlKey || metaKey || altKey) return null
  // 3. IME 合成期放行。
  if (isComposing === true) return null
  // 4. 命令菜单打开时方向键归菜单。
  if (menuOpen === true) return null
  // 5. 有选区放行。
  if (selectionStart !== selectionEnd) return null

  // 6. 单行：恒触发。
  if (!text.includes('\n')) return key === 'ArrowUp' ? 'older' : 'newer'

  // 7. 多行：光标所在行号（0 基）/ 末行号判定。
  const cursorLine = text.slice(0, selectionStart).split('\n').length - 1
  const lastLine = text.split('\n').length - 1
  if (key === 'ArrowUp' && cursorLine === 0) return 'older'
  if (key === 'ArrowDown' && cursorLine === lastLine) return 'newer'

  // 8. 中间行 → 不拦截。
  return null
}
