/**
 * Panel — 浮层面板壳（在 composer 内渲染，position fixed）。
 *
 * 两个 tab：指令（InstructionsTab）/ 提示词（PromptsTab）；右上关闭按钮；底部
 * 常驻来源 + AGPL-3.0 许可标注条（Cherry Studio agents-zh.json 来源）。
 */
import { useState } from 'react'
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

export function Panel({ cwd, currentDraft, setDraft, onClose }: Props): JSX.Element {
  const [tab, setTab] = useState<Tab>('instructions')

  return (
    <div className="dsh-ct-panel" role="dialog" aria-label="指令与提示词">
      <div className="dsh-ct-panel-header">
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
