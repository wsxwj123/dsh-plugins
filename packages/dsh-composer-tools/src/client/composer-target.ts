/**
 * composer 适配层（纯 DOM 工具）：把 DSH 0.2.1 的 `<textarea data-phase>` 与
 * 0.2.2 的 Lexical `<div contenteditable="true" data-phase>` 收敛成同一套读取面。
 *
 * 为什么需要（根因，2026-11 真机取证）：
 *   - 0.2.2 把输入框换成 Lexical 富文本：`[data-input-scroll]` 下的
 *     `<div contenteditable="true" data-composer-input data-phase>`；
 *     旧的 `tagName === 'TEXTAREA'` 判据恒 false，document capture keydown 的
 *     gate 永不命中，方向键历史整体失效。
 *   - contenteditable 没有 `.value/.selectionStart/.setSelectionRange`，历史回填
 *     依赖的读文本/读光标/落光标都要换成 Selection/Range。
 *
 * DOM 锚点（class 会变，只认 data 属性，真机 0.2.2-rc.5 实测）：
 *   - 可编辑节点：`[contenteditable="true"][data-phase]`（实测还带
 *     data-composer-input / data-lexical-editor）；外层 composer root 也有
 *     data-phase（'hero'/'active' 等），所以必须从事件 target 向上找可编辑点，
 *     不能全文档 query。
 *   - 命令菜单：菜单打开时 editable 的 data-phase 仍是 'plain'（实测），不能再用
 *     phase 判菜单；可靠的 DOM 标记是 `[data-trigger-menu]`（MenuView 打开才渲染）。
 *
 * 文本口径（与 textarea 行号语义对齐，真机 DOM 实测）：
 *   - Lexical 根的直接子元素是块（普通段落 `<p>`）；块间以 `'\n'` 连接。
 *   - 块内 `<br>`（Shift+Enter 的 LineBreakNode）计 `'\n'`；空段落的占位
 *     `<br data-lexical-managed-linebreak>` 不计（否则空行会多算一个换行）。
 *   - 光标偏移复用同一套 walk：把 [根起点, 光标点) 的范围 cloneContents 后按同一
 *     规则数文本长度，保证"读全文"与"读光标"永远同一口径。
 *
 * 纯 DOM、无 React/无 cordis 依赖；只有被浏览器 bundle 或真实 DOM 测试调用时才
 * 触碰 document/Selection。
 */

/** 光标/选区的字符偏移（与 {@link ComposerAdapter.getText} 同一口径）。 */
export interface ComposerSelection {
  start: number
  end: number
}

/** 一个 composer 可编辑点的统一读写面。 */
export interface ComposerAdapter {
  /** 真实 DOM 元素（textarea 或 contenteditable 根）。 */
  readonly element: HTMLElement
  readonly kind: 'textarea' | 'contenteditable'
  /** 当前全文（textarea.value / contenteditable 按块换行还原）。 */
  getText(): string
  /** 当前选区偏移；选区不在本元素内或环境拿不到 Selection → null。 */
  getSelection(): ComposerSelection | null
  /** 把光标放到文本末尾；焦点已不在本元素内时不动焦点并返回 false。 */
  setCaretToEnd(): boolean
}

const TEXT_NODE = 3
const ELEMENT_NODE = 1

/** 可编辑 composer 节点选择器（data-phase 是 0.2.1/0.2.2 共同的锚点）。 */
const COMPOSER_EDITABLE_SELECTOR = '[contenteditable="true"][data-phase]'

/** textarea 版 composer 选择器（0.2.1 及更早）。 */
const COMPOSER_TEXTAREA_SELECTOR = 'textarea[data-phase]'

/** 命令/引用触发菜单的稳定 DOM 标记（0.2.2 input-trigger 的 MenuView 根）。 */
const TRIGGER_MENU_SELECTOR = '[data-trigger-menu]'

function isElement(node: Node | null | undefined): node is HTMLElement {
  return node !== null && node !== undefined && node.nodeType === ELEMENT_NODE
}

/**
 * 从事件 target / activeElement 解析出当前 composer 的可编辑元素。
 * 先找 contenteditable（0.2.2），再退回 textarea（0.2.1）；都不是 → null
 * （例如焦点在插件面板的输入框里，方向键必须放行）。
 * @param target - keydown/input 事件的 target 或 document.activeElement。
 * @returns composer 可编辑元素；非 composer 目标返回 null。
 */
export function resolveComposerElement(target: EventTarget | null | undefined): HTMLElement | null {
  const node = target as Node | null
  if (node === null || node === undefined) return null
  const element = isElement(node) ? node : node.parentElement
  if (element === null || element === undefined) return null
  if (typeof element.closest !== 'function') return null
  const editable = element.closest(COMPOSER_EDITABLE_SELECTOR)
  if (editable !== null) return editable as HTMLElement
  const textarea = element.closest(COMPOSER_TEXTAREA_SELECTOR)
  if (textarea !== null) return textarea as HTMLElement
  return null
}

/** 按 contenteditable 口径从事件 target / activeElement 解析适配器。 */
export function resolveComposerAdapter(target: EventTarget | null | undefined): ComposerAdapter | null {
  const element = resolveComposerElement(target)
  return element === null ? null : createComposerAdapter(element)
}

/** 空段落占位 `<br>` 判定：Lexical 渲染空块时会插入它。 */
function isPlaceholderBreak(br: HTMLElement): boolean {
  if (br.hasAttribute('data-lexical-managed-linebreak')) return true
  // 兼容没有 managed 标记的 Lexical 版本：块内只有它、且块无文本 → 仍是空块占位。
  const parent = br.parentElement
  if (parent === null) return false
  if ((parent.textContent ?? '') !== '') return false
  let meaningful = 0
  for (const child of Array.from(parent.childNodes)) {
    if (isElement(child)) meaningful += 1
    else if (child.nodeType === TEXT_NODE && (child.textContent ?? '') !== '') meaningful += 1
  }
  return meaningful === 1
}

/**
 * 原子节点（chip/quote 的 contenteditable=false 宿主）的可见文本：跳过内部按钮
 * （QuoteNode 的删除按钮文案不属于草稿），保留正文。
 */
function atomicText(element: HTMLElement): string {
  let out = ''
  for (const child of Array.from(element.childNodes)) {
    if (child.nodeType === TEXT_NODE) {
      out += child.textContent ?? ''
      continue
    }
    if (!isElement(child)) continue
    const tag = child.tagName
    if (tag === 'BUTTON' || tag === 'INPUT' || child.getAttribute('role') === 'button') continue
    out += atomicText(child)
  }
  return out
}

/** 块内行内文本：text 原样、`<br>` 计换行、原子节点取可见文本。 */
function inlineText(node: Node): string {
  let out = ''
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === TEXT_NODE) {
      out += child.textContent ?? ''
      continue
    }
    if (!isElement(child)) continue
    if (child.tagName === 'BR') {
      if (!isPlaceholderBreak(child)) out += '\n'
      continue
    }
    if (child.getAttribute('contenteditable') === 'false') {
      out += atomicText(child)
      continue
    }
    out += inlineText(child)
  }
  return out
}

/** 通用节点位置文本（根/文档片段）：每个直接子块一段，块间 '\n'。 */
function containerText(node: Node): string {
  const blocks: string[] = []
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === TEXT_NODE) {
      blocks.push(child.textContent ?? '')
      continue
    }
    if (!isElement(child)) continue
    blocks.push(child.tagName === 'BR' ? (isPlaceholderBreak(child) ? '' : '\n') : inlineText(child))
  }
  return blocks.join('\n')
}

/**
 * 读取 contenteditable composer 全文（块间 '\n'，块内 `<br>` → '\n'）。
 * @param root - composer 可编辑根。
 * @returns 与光标偏移同口径的全文。
 */
export function readComposerText(root: HTMLElement): string {
  return containerText(root)
}

/** 把 DOM 边界点折算成 {@link readComposerText} 口径的字符偏移。 */
function offsetOfPoint(root: HTMLElement, container: Node, offset: number): number {
  const range = root.ownerDocument.createRange()
  range.setStart(root, 0)
  range.setEnd(container, offset)
  // cloneContents 得到 [根起点, 点) 的片段：片段直接子块就是被切开的块，
  // 用同一 containerText 口径数长度，天然复用块/换行规则。
  return containerText(range.cloneContents()).length
}

/**
 * 读取 contenteditable 选区偏移（锚点/焦点按文档顺序归一）。
 * @param root - composer 可编辑根。
 * @returns 偏移；选区不在根内/无 Selection → null。
 */
export function readComposerSelection(root: HTMLElement): ComposerSelection | null {
  const doc = root.ownerDocument
  const selection = typeof doc.getSelection === 'function' ? doc.getSelection() : null
  if (selection === null || selection.rangeCount === 0) return null
  const range = selection.getRangeAt(0)
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null
  const a = offsetOfPoint(root, range.startContainer, range.startOffset)
  const b = offsetOfPoint(root, range.endContainer, range.endOffset)
  return { start: Math.min(a, b), end: Math.max(a, b) }
}

/** 只有焦点仍落在 composer 内才动光标，避免从面板/按钮抢焦点。 */
function hasComposerFocus(root: HTMLElement): boolean {
  const active = root.ownerDocument.activeElement
  return active === root || (active !== null && root.contains(active))
}

/**
 * 把 contenteditable 光标放到末尾（回填后复位用）。
 * @param root - composer 可编辑根。
 * @returns 是否已放置（焦点不在 composer 内 → false）。
 */
export function setComposerCaretToEnd(root: HTMLElement): boolean {
  if (!hasComposerFocus(root)) return false
  const doc = root.ownerDocument
  const selection = typeof doc.getSelection === 'function' ? doc.getSelection() : null
  if (selection === null) return false
  const range = doc.createRange()
  range.selectNodeContents(root)
  range.collapse(false)
  selection.removeAllRanges()
  selection.addRange(range)
  return true
}

/**
 * 菜单是否打开（fail-safe：判定不了按打开处理，宁可历史不触发也不抢菜单方向键。
 * 0.2.2 实测：输入 '/' 打开命令菜单时 editable 的 data-phase 仍是 'plain'，所以
 * 以 `[data-trigger-menu]` DOM 为准；data-phase !== 'plain'（submitting/
 * adjudicating/claimed/inert）继续按"方向键归宿主"放行。
 * @param root - composer 可编辑根。
 * @returns 菜单/非 plain 输入态 → true。
 */
export function isComposerMenuOpen(root: HTMLElement): boolean {
  const phase = root.getAttribute('data-phase')
  if (phase === null || phase === '') return true
  if (phase !== 'plain') return true
  return root.ownerDocument.querySelector(TRIGGER_MENU_SELECTOR) !== null
}

/**
 * 为一个 composer 可编辑元素创建适配器；同一元素多次创建互不共享状态。
 * @param element - textarea 或 contenteditable 根。
 * @returns 统一读写面。
 */
export function createComposerAdapter(element: HTMLElement): ComposerAdapter {
  const textarea = element.tagName === 'TEXTAREA' ? (element as HTMLTextAreaElement) : null
  if (textarea !== null) {
    return {
      element,
      kind: 'textarea',
      getText: () => textarea.value,
      getSelection: () => ({ start: textarea.selectionStart, end: textarea.selectionEnd }),
      setCaretToEnd: () => {
        if (!hasComposerFocus(textarea)) return false
        const length = textarea.value.length
        textarea.setSelectionRange(length, length)
        return true
      },
    }
  }
  return {
    element,
    kind: 'contenteditable',
    getText: () => readComposerText(element),
    getSelection: () => readComposerSelection(element),
    setCaretToEnd: () => setComposerCaretToEnd(element),
  }
}
