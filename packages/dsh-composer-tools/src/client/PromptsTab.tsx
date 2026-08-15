/**
 * PromptsTab — 提示词 tab。
 *
 * 能力（PLAN §1.3-5）：
 *   - 首次切入才 fetch ctPrompts()（按需加载）。
 *   - 按 group[0] 归类折叠浏览（分类头 + 条目数）；搜索按标题/描述/正文过滤（client 侧）。
 *   - 「发送到输入框」= inputActions.setDraft(appendPromptToDraft(current, prompt))
 *     （current 从 useInput 拿当前 draft；不覆盖不自动发送）。
 *   - 「复制」= writeClipboard（platform external）：返回 false → 提示「复制失败」。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ctPrompts, type CtResult } from './bridge.ts'
import { appendPromptToDraft } from './append.ts'
import { writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'

export interface PromptItem {
  id: string
  name: string
  description?: string
  prompt: string
  emoji?: string
  group?: string[]
}

export interface PromptSource {
  name?: string
  url?: string
  license?: string
}

interface Props {
  /** 当前草稿（来自 useInput selector）。 */
  currentDraft: string
  /** setDraft 回填单写路径。 */
  setDraft(text: string): void
}

export function PromptsTab({ currentDraft, setDraft }: Props): JSX.Element {
  const [items, setItems] = useState<PromptItem[] | null>(null)
  const [loading, setLoading] = useState<boolean>(false)
  const [err, setErr] = useState('')
  const [source, setSource] = useState<PromptSource | null>(null)
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const [flash, setFlash] = useState<string>('')
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const load = useCallback(async (): Promise<void> => {
    if (items !== null) return // 已加载则复用（按需一次）
    setLoading(true)
    setErr('')
    const res: CtResult = await ctPrompts()
    setLoading(false)
    if (!res.ok) {
      setErr(`${res.code}: ${res.message}`)
      return
    }
    setItems((res.items as PromptItem[]) ?? [])
    setSource((res.source as PromptSource) ?? null)
  }, [items])

  useEffect(() => {
    void load()
    return () => {
      if (timerRef.current !== undefined) clearTimeout(timerRef.current)
    }
  }, [load])

  const flashMsg = (msg: string): void => {
    setFlash(msg)
    if (timerRef.current !== undefined) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setFlash(''), 1600)
  }

  const filtered = useMemo(() => {
    if (items === null) return []
    const q = query.trim().toLowerCase()
    if (!q) return items
    return items.filter(
      (it) =>
        it.name.toLowerCase().includes(q) ||
        (it.description ?? '').toLowerCase().includes(q) ||
        (it.prompt ?? '').toLowerCase().includes(q),
    )
  }, [items, query])

  const groups = useMemo(() => {
    const map = new Map<string, PromptItem[]>()
    for (const it of filtered) {
      const key = it.group && it.group.length > 0 ? it.group[0] : '未分类'
      const arr = map.get(key)
      if (arr) arr.push(it)
      else map.set(key, [it])
    }
    return Array.from(map.entries())
  }, [filtered])

  const send = (it: PromptItem): void => {
    setDraft(appendPromptToDraft(currentDraft, it.prompt))
    flashMsg('已追加到输入框（未自动发送）')
  }

  const copy = async (it: PromptItem): Promise<void> => {
    const ok = await writeClipboard(it.prompt)
    if (!ok) {
      flashMsg('复制失败')
      return
    }
    flashMsg('已复制')
  }

  return (
    <div className="dsh-ct-prompts">
      {items === null && loading && <div className="dsh-ct-hint">加载提示词库…</div>}
      {err !== '' && <div className="dsh-ct-err">{err}</div>}
      {items !== null && (
        <>
          <div className="dsh-ct-search">
            <input
              placeholder="搜索标题 / 描述 / 正文"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          {flash !== '' && <div className="dsh-ct-hint">{flash}</div>}
          {groups.length === 0 && <div className="dsh-ct-empty">无匹配提示词</div>}
          {groups.map(([cat, list]) => {
            const isOpen = open[cat] ?? true
            return (
              <div key={cat} className="dsh-ct-cat">
                <div
                  className="dsh-ct-cat-header"
                  onClick={() => setOpen((o) => ({ ...o, [cat]: !(o[cat] ?? true) }))}
                >
                  <span className="dsh-ct-cat-arrow">{isOpen ? '▾' : '▸'}</span>
                  <span>{cat}</span>
                  <span className="dsh-ct-cat-count">{list.length}</span>
                </div>
                {isOpen && (
                  <div className="dsh-ct-cat-items">
                    {list.map((it) => (
                      <div key={it.id} className="dsh-ct-prompt-item">
                        <span className="dsh-ct-prompt-emoji">{it.emoji ?? ''}</span>
                        <div className="dsh-ct-prompt-main">
                          <div className="dsh-ct-prompt-name">{it.name}</div>
                          {it.description && (
                            <div className="dsh-ct-prompt-desc">{it.description}</div>
                          )}
                          <div className="dsh-ct-actions">
                            <button
                              className="dsh-ct-btn-primary"
                              onClick={() => send(it)}
                            >
                              发送到输入框
                            </button>
                            <button className="dsh-ct-icon-btn" onClick={() => void copy(it)}>
                              复制
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </>
      )}
    </div>
  )
}
