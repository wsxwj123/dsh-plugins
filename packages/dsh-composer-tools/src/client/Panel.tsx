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

/** 拖拽状态：null = 未拖拽；{ dx, dy } = 相对初始位置的偏移（px）。 */
type Drag = { dx: number; dy: number } | null

export function Panel({ cwd, currentDraft, setDraft, onClose }: Props): JSX.Element {
  const [tab, setTab] = useState<Tab>('instructions')
  const [drag, setDrag] = useState<Drag>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  // 拖拽起点（鼠标按下时）与面板当时的定位点
  const dragCtx = useRef<{ startX: number; startY: number; baseLeft: number; baseTop: number } | null>(null)

  // 拖拽期间 document 级监听：mousemove 跟随、mouseup 结束。
  // 常驻监听 + dragCtx 判空（拖拽中每帧 setDrag 重渲染，若按依赖挂摘会丢 mouseup）。
  useEffect(() => {
    const onMove = (e: MouseEvent): void => {
      const c = dragCtx.current
      if (c === null) return
      const dx = e.clientX - c.startX
      const dy = e.clientY - c.startY
      setDrag({ dx, dy })
    }
    const onUp = (): void => {
      dragCtx.current = null
      setDrag((d) => d) // 保留最终偏移（拖拽结束即定位点）
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
  }, []) // 挂载时挂一次，卸载 cleanup

  const startDrag = (e: React.MouseEvent): void => {
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
    setDrag({ dx: 0, dy: 0 })
    e.preventDefault() // 防文本选择
  }

  // 面板样式：未拖拽时用 CSS 默认（贴右下）；拖拽后转 left/top 定位 + 偏移。
  const style: React.CSSProperties = drag === null
    ? {}
    : {
        left: dragCtx.current ? dragCtx.current.baseLeft + drag.dx : undefined,
        top: dragCtx.current ? dragCtx.current.baseTop + drag.dy : undefined,
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
