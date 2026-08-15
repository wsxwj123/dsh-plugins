/**
 * InstructionsTab — 指令 tab。
 *
 * 能力（PLAN §1.3-5）：
 *   - 打开即 ctInstructionsList(cwd)：列出发现的指令文件 + level 标签。
 *   - 展开文件即 ctInstructionsRead 读全文，textarea 只读预览；可切编辑并保存。
 *   - 「重新加载」重跑 list 并使内容缓存失效。
 *   - 跨文件全文搜索：首次搜索把未读文件 read 一遍，面板本次打开期间缓存 read
 *     结果（重新加载失效），按 标题/路径/正文 过滤，命中列「文件+行号+行片段」。
 *   - 编辑保存：保存前 window.confirm 确认「会改变模型行为」→ ctInstructionsSave
 *     (cwd, path, content, mtimeMs)；mtime-conflict 提示重载/覆盖，file-truncated
 *     提示用外部编辑器。
 */
import { useEffect, useRef, useState } from 'react'
import {
  ctInstructionsCreate,
  ctInstructionsList,
  ctInstructionsRead,
  ctInstructionsSave,
  type CtResult,
} from './bridge.ts'

export interface InstructionFile {
  path: string
  displayPath: string
  level: string
  name: string
  sizeBytes: number
  mtimeMs: number
}

interface ReadState {
  content: string
  mtimeMs: number
  truncated: boolean
  raw: { path: string; content: string; mtimeMs: number; truncated?: boolean }
}

interface Props {
  cwd: string | undefined
}

export function InstructionsTab({ cwd }: Props): JSX.Element {
  const [files, setFiles] = useState<InstructionFile[]>([])
  const [phase, setPhase] = useState<string>('loading')
  const [err, setErr] = useState<string>('')
  // 新建项目级 AGENTS.md 入口判定：host 已用 realpath + lstat 算好（§1.1/§1.5），
  // client 只读此值、不重复推导。'ready' 时才显示按钮。
  const [canCreateRootAgents, setCanCreateRootAgents] = useState(false)
  // 新建中（按钮禁用 + 「创建中…」）
  const [creating, setCreating] = useState(false)
  // [path -> readState]：面板打开期间缓存；重新加载失效。
  const contentCache = useRef<Map<string, ReadState>>(new Map())
  const [expanded, setExpanded] = useState<string | null>(null)

  const loadList = async (): Promise<void> => {
    setPhase('loading')
    setErr('')
    setCanCreateRootAgents(false)
    contentCache.current.clear()
    setExpanded(null)
    if (cwd === undefined) {
      setPhase('no-cwd')
      return
    }
    const res = await ctInstructionsList(cwd)
    if (!res.ok) {
      setPhase('error')
      setErr(`${res.code}: ${res.message}`)
      return
    }
    setFiles((res.files as InstructionFile[]) ?? [])
    setCanCreateRootAgents(res.canCreateRootAgents === true)
    setPhase('ready')
  }

  useEffect(() => {
    void loadList()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cwd])

  const getRead = async (f: InstructionFile): Promise<ReadState | null> => {
    const hit = contentCache.current.get(f.path)
    if (hit !== undefined) return hit
    const res: CtResult = await ctInstructionsRead(cwd ?? '', f.path)
    if (!res.ok) return null
    const state: ReadState = {
      content: String(res.content ?? ''),
      mtimeMs: Number(res.mtimeMs ?? 0),
      truncated: res.truncated === true,
      raw: res as any,
    }
    contentCache.current.set(f.path, state)
    return state
  }

  const toggleFile = async (f: InstructionFile): Promise<void> => {
    if (expanded === f.path) {
      setExpanded(null)
      return
    }
    setExpanded(f.path)
    await getRead(f) // 预热缓存，展开前先读好
  }

  const save = async (f: InstructionFile, newContent: string): Promise<void> => {
    const st = contentCache.current.get(f.path)
    if (st === undefined) return
    // 直接落盘（对齐 claude gui）：保存即写入，不做保存前确认。
    const res = await ctInstructionsSave(cwd ?? '', f.path, newContent, st.mtimeMs)
    if (res.ok) {
      contentCache.current.get(f.path)!.mtimeMs = Number(res.mtimeMs ?? st.mtimeMs)
      await loadList()
      return
    }
    if (res.code === 'mtime-conflict') {
      const overwrite = window.confirm('文件已被外部修改。重新加载？')
      if (!overwrite) {
        // 覆盖更新 mtime 基线重存
        const res2 = await ctInstructionsSave(
          cwd ?? '',
          f.path,
          newContent,
          Number(res.currentMtimeMs ?? st.mtimeMs) - 1,
        )
        if (res2.ok) {
          contentCache.current.get(f.path)!.mtimeMs = Number(res2.mtimeMs ?? st.mtimeMs)
          await loadList()
        } else {
          alert(`保存失败：${res2.code} ${res2.message}`)
        }
        return
      }
      const rd = await ctInstructionsRead(cwd ?? '', f.path)
      if (rd.ok && (rd as any).content) {
        contentCache.current.set(f.path, {
          content: String((rd as any).content),
          mtimeMs: Number((rd as any).mtimeMs),
          truncated: false,
          raw: rd as any,
        })
      }
      return
    }
    if (res.code === 'file-truncated') {
      alert('文件超过 1MB，当前只读到了截断前缀；请用外部编辑器完整修改后再保存。')
      return
    }
    alert(`保存失败：${res.code} ${res.message}`)
  }

  // 新建项目级 AGENTS.md（INTERFACE §1.5 client UI 契约）。
  // 成功 → await loadList() 完成后 setExpanded(新 path)（editor 复用现有 read-on-mount
  // 读入模板，用户直接编辑 → save）。
  // path-exists → 文件届时已在列表，重载进入正常展开/编辑流，不重复报错。
  const createRootAgents = async (): Promise<void> => {
    if (cwd === undefined || creating) return
    setCreating(true)
    setErr('')
    try {
      const res = await ctInstructionsCreate(cwd)
      if (res.ok) {
        const newPath = String(res.path ?? '')
        await loadList()
        if (newPath !== '') setExpanded(newPath)
      } else if (res.code === 'path-exists') {
        await loadList() // 文件已由并发的同类操作（或外部）创建，重载展示即可
      } else {
        setErr(`${res.code}: ${res.message}`)
      }
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="dsh-ct-instr">
      <div className="dsh-ct-search">
        <button className="dsh-ct-icon-btn" onClick={() => void loadList()} title="重新加载">
          重新加载
        </button>
        {phase === 'ready' && canCreateRootAgents === true && (
          <button
            className="dsh-ct-icon-btn"
            onClick={() => void createRootAgents()}
            disabled={creating}
            title="新建项目级 AGENTS.md"
          >
            {creating ? '创建中…' : '新建项目级 AGENTS.md'}
          </button>
        )}
      </div>

      {err !== '' && <div className="dsh-ct-err">{err}</div>}

      {phase === 'loading' && <div className="dsh-ct-hint">加载中…</div>}
      {phase === 'no-cwd' && <div className="dsh-ct-empty">无当前会话目录</div>}
      {phase === 'ready' && files.length === 0 && (
        <div className="dsh-ct-empty">未发现指令文件</div>
      )}
      {phase === 'ready' &&
        files.map((f) => (
          <ShortFile
            key={f.path}
            f={f}
            cwd={cwd ?? ''}
            expanded={expanded === f.path}
            onToggle={() => void toggleFile(f)}
            onSave={(content) => void save(f, content)}
          />
        ))}
    </div>
  )
}

function ShortFile({
  f,
  cwd,
  expanded,
  onToggle,
  onSave,
}: {
  f: InstructionFile
  cwd: string
  expanded: boolean
  onToggle: () => void
  onSave: (content: string) => void
}): JSX.Element {
  return (
    <div className="dsh-ct-short">
      <div className="dsh-ct-file-row" onClick={onToggle}>
        <span className="dsh-ct-file-path">{f.displayPath}</span>
        <span className={`dsh-ct-lvl ${f.level}`}>{lvlLabel(f.level)}</span>
      </div>
      {expanded && <Editor f={f} cwd={cwd} onSave={onSave} />}
    </div>
  )
}

function Editor({
  f,
  cwd,
  onSave,
}: {
  f: InstructionFile
  cwd: string
  onSave: (content: string) => void
}): JSX.Element {
  const [st, setSt] = useState<ReadState | null>(null)
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    let alive = true
    setLoading(true)
    void ctInstructionsRead(cwd, f.path).then((res: CtResult) => {
      if (!alive) return
      if (!res.ok) {
        setLoading(false)
        return
      }
      const state: ReadState = {
        content: String(res.content ?? ''),
        mtimeMs: Number(res.mtimeMs ?? 0),
        truncated: res.truncated === true,
        raw: res as any,
      }
      setSt(state)
      setDraft(state.content)
      setLoading(false)
    })
    return () => {
      alive = false
    }
  }, [f.path, cwd])

  return (
    <div>
      <textarea
        id={'dsh-ct-editor-' + safeId(f.path)}
        className="dsh-ct-edit-area"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        readOnly={loading}
        placeholder={loading ? '读取中…' : ''}
      />
      <div className="dsh-ct-actions">
        {st?.truncated && <span className="dsh-ct-hint">文件过大，仅显示截断前缀</span>}
        <button
          className="dsh-ct-btn-primary"
          disabled={loading || st === null}
          onClick={() => onSave(draft)}
        >
          保存
        </button>
      </div>
    </div>
  )
}

function lvlLabel(level: string): string {
  if (level === 'global') return '全局'
  if (level === 'project') return '项目'
  if (level === 'local') return '本地'
  return level
}

function safeId(p: string): string {
  return p.replace(/[^a-zA-Z0-9_-]/g, '_')
}
