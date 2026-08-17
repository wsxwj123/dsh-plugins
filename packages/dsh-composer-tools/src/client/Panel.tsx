/**
 * Panel — 浮层面板壳（Portal 到 body，position fixed，可拖拽移动）。
 *
 * 两个 tab：指令（InstructionsTab）/ 提示词（PromptsTab）；右上关闭按钮；底部
 * 常驻来源 + AGPL-3.0 许可标注条（Cherry Studio agents-zh.json 来源）。
 *
 * 拖拽：header 为拖拽手柄，按下开始、document 上 mousemove/mouseup 跟随。
 * 面板初始贴右下（CSS inset），拖拽后切换为 left/top 定位并记录偏移，
 * 会话内可自由移动（不持久化）。
 */
import { useEffect, useRef, useState } from 'react'
import { InstructionsTab } from './InstructionsTab.tsx'
import { PromptsTab } from './PromptsTab.tsx'

interface Props {
  cwd: string | undefined
  /** 当前草稿（来自 useInput selector），传给 PromptsTab 做追加拼接。 */
  currentDraft: string
  /** setDraft 回填单写路径。 */
  setDraft(text: string): void
  /** 关闭面板。 */
  onClose: () => void
}

type Tab = 'instructions' | 'prompts'

/**
 * 拖拽落点：null = 未拖拽过（走 CSS 默认右下定位）；{ left, top } = 已固化的
 * 面板定位点（px）。落点提升为 React state（§8.6 修复②）：mouseup 清 dragCtx
 * 不影响已固化的 left/top，避免"从 CSS 右下定位切到 left/top 后 left/top 短暂
 * 为 undefined → 面板塌陷消失"。
 */
type DragPos = { left: number; top: number } | null

export function Panel({ cwd, currentDraft, setDraft, onClose }: Props): JSX.Element {
  const [tab, setTab] = useState<Tab>('instructions')
  const [dragPos, setDragPos] = useState<DragPos>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  // 拖拽起点（鼠标按下时）与面板当时的定位点；仅拖拽进行期间非 null
  const dragCtx = useRef<{ startX: number; startY: number; baseLeft: number; baseTop: number } | null>(null)

  // 拖拽期间 document 级监听：mousemove 跟随、mouseup 结束。
  // 常驻监听 + dragCtx 判空（拖拽中每帧 setDragPos 重渲染，若按依赖挂摘会丢 mouseup）。
  useEffect(() => {
    const onMove = (e: MouseEvent): void => {
      const c = dragCtx.current
      if (c === null) return
      // 每次移动直接把落点 commit 进 state：拖拽结束时无需再从 dragCtx 回填
      setDragPos({ left: c.baseLeft + (e.clientX - c.startX), top: c.baseTop + (e.clientY - c.startY) })
    }
    const onUp = (): void => {
      dragCtx.current = null // dragPos 已固化在 state，清空 dragCtx 不影响定位
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
  }, []) // 挂载时挂一次，卸载 cleanup

  const startDrag = (e: React.MouseEvent): void => {
    // §8.6 修复①：交互目标（tab/关闭按钮、链接、输入框等）上的 mousedown 不启动
    // 拖拽——否则点击 tab 会冒泡进 startDrag 把面板切到 left/top 定位（吞点击 bug）。
    const t = e.target as HTMLElement
    if (t.closest('button, a, input, textarea, [data-stop-drag]')) return
    const el = panelRef.current
    if (el === null) return
    // 拖拽手柄只响应鼠标左键
    if (e.button !== 0) return
    const r = el.getBoundingClientRect()
    dragCtx.current = {
      startX: e.clientX,
      startY: e.clientY,
      baseLeft: r.left,
      baseTop: r.top,
    }
    setDragPos({ left: r.left, top: r.top })
    e.preventDefault() // 防文本选择
  }

  // 面板样式：未拖拽过时用 CSS 默认（贴右下）；拖拽后 left/top 由 state 派生，
  // insetInlineEnd/bottom 显式置 auto（不依赖会被清空的 dragCtx）。
  const style: React.CSSProperties = dragPos === null
    ? {}
    : {
        left: dragPos.left,
        top: dragPos.top,
        insetInlineEnd: 'auto',
        bottom: 'auto',
      }

  return (
    <div className="dsh-ct-panel" role="dialog" aria-label="指令与提示词" ref={panelRef} style={style}>
      <div className="dsh-ct-panel-header" onMouseDown={startDrag} style={{ cursor: 'grab' }}>
        <span className="dsh-ct-header-title">指令 / 提示词</span>
        <button
          className={`dsh-ct-tab ${tab === 'instructions' ? 'active' : ''}`}
          onClick={() => setTab('instructions')}
        >
          指令
        </button>
        <button
          className={`dsh-ct-tab ${tab === 'prompts' ? 'active' : ''}`}
          onClick={() => setTab('prompts')}
        >
          提示词
        </button>
        <button className="dsh-ct-close" onClick={onClose} aria-label="关闭" title="关闭">
          ✕
        </button>
      </div>

      <div className="dsh-ct-panel-body">
        {tab === 'instructions' && <InstructionsTab cwd={cwd} />}
        {tab === 'prompts' && (
          <PromptsTab currentDraft={currentDraft} setDraft={setDraft} />
        )}
      </div>

      <div className="dsh-ct-panel-footer">
        <span>提示词数据：Cherry Studio agents-zh</span>
        <span>·</span>
        <span>AGPL-3.0</span>
        <a href="https://github.com/CherryHQ/cherry-studio" target="_blank" rel="noreferrer">
          github.com/CherryHQ/cherry-studio
        </a>
      </div>
    </div>
  )
}
