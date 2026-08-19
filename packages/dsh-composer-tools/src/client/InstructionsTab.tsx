/**
 * InstructionsTab — 指令 tab（增量 2：显式视图状态机 + 全局新建 + 删除 + 返回流程）。
 *
 * 能力（PLAN §1.3-5 / §8.2）：
 *   - 打开即 ctInstructionsList(cwd)：列出发现的指令文件 + level 标签。
 *   - 视图状态机（src/client/instruction-view.ts 纯 reducer，INTERFACE §2.6）：
 *     list（列表）/ create(scope)（新建→新文件编辑态）/ edit(path)（已有文件编辑态）。
 *     组件只负责「事件→reducer→渲染」，状态迁移正确性由 reducer 单测兜底。
 *   - 工具栏两个新建入口：项目级（canCreateRootAgents）/ 全局（canCreateGlobalAgents），
 *     显隐各自只读 list 响应字段（host 已用 realpath + lstat 算好，client 不重复推导）。
 *     全局新建发起请求前 window.confirm（指令对所有会话生效）；项目级不确认。
 *   - 编辑态两个出口：「保存」（ctInstructionsSave，mtime 乐观锁冲突给重载/覆盖选择）
 *     与「返回列表」（未保存内容先 confirm 放弃）。保存成功 → saved → 回列表初始态。
 *   - 每行文件提供「删除」：window.confirm（全局文件追加"影响模型行为"）→
 *     ctInstructionsDelete → 成功重载 list；失败面板内提示 {code}: {message}。
 */
import { useEffect, useReducer, useRef, useState } from 'react'
import {
  ctInstructionsCreate,
  ctInstructionsDelete,
  ctInstructionsList,
  ctInstructionsRead,
  ctInstructionsSave,
  type CtResult,
} from './bridge.ts'
import {
  instructionViewReducer,
  type InstructionScope,
  type InstructionView,
} from './instruction-view.ts'

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
}

/** 编辑器种子：新建成功（create 响应模板）或冲突重载后直接注入，免再次 read。 */
interface EditorSeed {
  path: string
  content: string
  mtimeMs: number
  truncated: boolean
  nonce: number // 变化即强制 Editor 重挂载
}

interface Props {
  cwd: string | undefined
}

export function InstructionsTab({ cwd }: Props): JSX.Element {
  const [files, setFiles] = useState<InstructionFile[]>([])
  const [phase, setPhase] = useState<string>('loading')
  const [err, setErr] = useState<string>('')
  // 新建入口显隐：只读 list 响应字段（§1.1 契约），不重复推导。
  const [canCreateRootAgents, setCanCreateRootAgents] = useState(false)
  const [canCreateGlobalAgents, setCanCreateGlobalAgents] = useState(false)
  // 视图状态机：list / create(scope) / edit(path)（§2.6 纯 reducer）
  const [view, dispatch] = useReducer(instructionViewReducer, { kind: 'list' } as InstructionView)
  // 新建中（按钮禁用 + 「创建中…」）
  const [creating, setCreating] = useState(false)
  // 编辑器种子（新建模板 / 冲突重载注入）
  const [seed, setSeed] = useState<EditorSeed | null>(null)
  // 当前编辑器草稿是否脏（Editor onDirtyChange 上报；返回确认用）
  const dirtyRef = useRef(false)

  // 重载列表数据（不触碰视图状态机；视图回列表由 saved/cancel-edit/open-list 事件负责）
  const loadList = async (): Promise<void> => {
    setPhase('loading')
    setErr('')
    if (cwd === undefined) {
      setFiles([])
      setCanCreateRootAgents(false)
      setCanCreateGlobalAgents(false)
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
    setCanCreateGlobalAgents(res.canCreateGlobalAgents === true)
    setPhase('ready')
  }

  useEffect(() => {
    dirtyRef.current = false
    setSeed(null)
    dispatch({ type: 'open-list' })
    void loadList()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cwd])

  // —— 新建（§1.5 client UI 契约）——
  // 全局新建先 window.confirm（指令对所有会话生效）；项目级不确认。
  // 成功 → create-succeeded：停留 create 态，编辑器直接注入 create 响应的模板
  // （content/mtimeMs 即 save 基线），随后重载列表。path-exists → 重载列表回列表态，
  // 不重复报错（文件届时已在列表，进入正常展开/编辑流）。
  const startCreate = async (scope: InstructionScope): Promise<void> => {
    if (cwd === undefined || creating) return
    if (scope === 'global' && !window.confirm('将创建全局指令文件，该指令对所有会话生效。是否继续？')) return
    dispatch({ type: 'start-create', scope })
    setCreating(true)
    setErr('')
    try {
      const res = await ctInstructionsCreate(cwd, scope)
      if (res.ok) {
        const p = String(res.path ?? '')
        dirtyRef.current = false
        setSeed({
          path: p,
          content: String(res.content ?? ''),
          mtimeMs: Number(res.mtimeMs ?? 0),
          truncated: false,
          nonce: Date.now(),
        })
        dispatch({ type: 'create-succeeded', path: p })
        await loadList()
      } else if (res.code === 'path-exists') {
        await loadList()
        dispatch({ type: 'create-failed' })
      } else {
        setErr(`${res.code}: ${res.message}`)
        dispatch({ type: 'create-failed' })
      }
    } finally {
      setCreating(false)
    }
  }

  // —— 打开已有文件 → 编辑态 ——
  const openFile = (f: InstructionFile): void => {
    dirtyRef.current = false
    setSeed(null) // 无种子：Editor read-on-mount
    dispatch({ type: 'open-edit', path: f.path })
  }

  // —— 保存（两个编辑态共用；保存成功 → saved → 回列表初始态并重载）——
  const save = async (path: string, content: string, mtimeMs: number): Promise<void> => {
    const res = await ctInstructionsSave(cwd ?? '', path, content, mtimeMs)
    if (res.ok) {
      dirtyRef.current = false
      dispatch({ type: 'saved', path })
      await loadList()
      return
    }
    if (res.code === 'mtime-conflict') {
      const reload = window.confirm('文件已被外部修改。重新加载？')
      if (reload) {
        // 重新读入最新内容，停留编辑态（注入种子强制 Editor 重挂载）
        const rd: CtResult = await ctInstructionsRead(cwd ?? '', path)
        if (rd.ok) {
          dirtyRef.current = false
          setSeed({
            path,
            content: String(rd.content ?? ''),
            mtimeMs: Number(rd.mtimeMs ?? 0),
            truncated: rd.truncated === true,
            nonce: Date.now(),
          })
        }
        return
      }
      // 强制覆盖：以当前磁盘 mtime 为基线重存
      const res2 = await ctInstructionsSave(cwd ?? '', path, content, Number(res.currentMtimeMs ?? mtimeMs))
      if (res2.ok) {
        dirtyRef.current = false
        dispatch({ type: 'saved', path })
        await loadList()
      } else {
        alert(`保存失败：${res2.code} ${res2.message}`)
      }
      return
    }
    if (res.code === 'file-truncated') {
      alert('文件超过 1MB，当前只读到了截断前缀；请用外部编辑器完整修改后再保存。')
      return
    }
    alert(`保存失败：${res.code} ${res.message}`)
  }

  // —— 返回列表（§8.2 步骤 5：未保存内容先确认放弃）——
  const backToList = (): void => {
    const needsConfirm =
      view.kind === 'create'
        ? view.path !== undefined // create 已成功未保存（文件已落盘，草稿未保存）
        : view.kind === 'edit' && dirtyRef.current
    if (needsConfirm && !window.confirm('放弃未保存的修改？')) return
    dirtyRef.current = false
    setSeed(null)
    dispatch({ type: 'cancel-edit' })
  }

  // —— 删除（§1.6 client UI 契约：确认 → delete → 成功重载 / 失败面板内提示）——
  const removeFile = async (f: InstructionFile): Promise<void> => {
    const msg =
      f.level === 'global'
        ? '删除全局指令文件？将移除 DSH 加载的全局指令，影响模型行为。此操作不可恢复。'
        : '删除该指令文件？此操作不可恢复。'
    if (!window.confirm(msg)) return
    const res = await ctInstructionsDelete(cwd ?? '', f.path)
    if (res.ok) {
      await loadList()
    } else {
      setErr(`${res.code}: ${res.message}`) // 失败：文件行保持原状，不静默消失
    }
  }

  const editingPath =
    view.kind === 'edit' ? view.path : view.kind === 'create' ? view.path : undefined
  const editingFile = editingPath !== undefined ? files.find((f) => f.path === editingPath) : undefined

  return (
    <div className="dsh-ct-instr">
      {view.kind === 'list' && (
        <div className="dsh-ct-search">
          <button className="dsh-ct-icon-btn" onClick={() => void loadList()} title="重新加载">
            重新加载
          </button>
          {phase === 'ready' && canCreateRootAgents === true && (
            <button
              className="dsh-ct-icon-btn"
              onClick={() => void startCreate('project')}
              disabled={creating}
              title="新建项目级 AGENTS.md"
            >
              {creating ? '创建中…' : '新建项目级 AGENTS.md'}
            </button>
          )}
          {phase === 'ready' && canCreateGlobalAgents === true && (
            <button
              className="dsh-ct-icon-btn"
              onClick={() => void startCreate('global')}
              disabled={creating}
              title="新建全局 AGENTS.md（对所有会话生效）"
            >
              {creating ? '创建中…' : '新建全局 AGENTS.md'}
            </button>
          )}
        </div>
      )}

      {err !== '' && <div className="dsh-ct-err">{err}</div>}

      {view.kind === 'list' && (
        <>
          {phase === 'loading' && <div className="dsh-ct-hint">加载中…</div>}
          {phase === 'no-cwd' && <div className="dsh-ct-empty">无当前会话目录</div>}
          {phase === 'ready' && files.length === 0 && <div className="dsh-ct-empty">未发现指令文件</div>}
          {phase === 'ready' &&
            files.map((f) => (
              <div className="dsh-ct-short" key={f.path}>
                <div className="dsh-ct-file-row" onClick={() => openFile(f)}>
                  <span className="dsh-ct-file-path">{f.displayPath}</span>
                  <span className={`dsh-ct-lvl ${f.level}`}>{lvlLabel(f.level)}</span>
                  <button
                    className="dsh-ct-icon-btn"
                    title="删除"
                    onClick={(e) => {
                      e.stopPropagation() // 删除不触发行展开
                      void removeFile(f)
                    }}
                  >
                    删除
                  </button>
                </div>
              </div>
            ))}
        </>
      )}

      {view.kind === 'create' && view.path === undefined && (
        <div className="dsh-ct-hint">创建中…</div>
      )}

      {editingPath !== undefined && (
        <Editor
          key={`${view.kind}:${editingPath}:${seed?.nonce ?? 0}`}
          cwd={cwd ?? ''}
          path={editingPath}
          displayPath={editingFile?.displayPath ?? editingPath}
          initial={seed !== null && seed.path === editingPath ? seed : null}
          onSave={(content, mtimeMs) => void save(editingPath, content, mtimeMs)}
          onBack={backToList}
          onDirtyChange={(d) => {
            dirtyRef.current = d
            if (d) dispatch({ type: 'mark-dirty' })
          }}
        />
      )}
    </div>
  )
}

function Editor({
  cwd,
  path,
  displayPath,
  initial,
  onSave,
  onBack,
  onDirtyChange,
}: {
  cwd: string
  path: string
  displayPath: string
  /** 新建模板/冲突重载注入的种子；null → read-on-mount。 */
  initial: ReadState | null
  onSave: (content: string, mtimeMs: number) => void
  onBack: () => void
  onDirtyChange: (dirty: boolean) => void
}): JSX.Element {
  const [st, setSt] = useState<ReadState | null>(initial)
  const [draft, setDraft] = useState(initial?.content ?? '')
  const [loading, setLoading] = useState(initial === null)

  useEffect(() => {
    if (initial !== null) return // 有种子：无需再读
    let alive = true
    setLoading(true)
    void ctInstructionsRead(cwd, path).then((res: CtResult) => {
      if (!alive) return
      if (!res.ok) {
        setLoading(false)
        return
      }
      const state: ReadState = {
        content: String(res.content ?? ''),
        mtimeMs: Number(res.mtimeMs ?? 0),
        truncated: res.truncated === true,
      }
      setSt(state)
      setDraft(state.content)
      setLoading(false)
    })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, cwd])

  return (
    <div>
      <div className="dsh-ct-actions">
        <button className="dsh-ct-icon-btn" onClick={onBack} title="返回列表">
          ← 返回列表
        </button>
        <span className="dsh-ct-file-path">{displayPath}</span>
      </div>
      <textarea
        id={'dsh-ct-editor-' + safeId(path)}
        className="dsh-ct-edit-area"
        value={draft}
        onChange={(e) => {
          const v = e.target.value
          setDraft(v)
          onDirtyChange(st !== null && v !== st.content)
        }}
        readOnly={loading}
        placeholder={loading ? '读取中…' : ''}
      />
      <div className="dsh-ct-actions">
        {st?.truncated && <span className="dsh-ct-hint">文件过大，仅显示截断前缀</span>}
        <button
          className="dsh-ct-btn-primary"
          disabled={loading || st === null}
          onClick={() => st !== null && onSave(draft, st.mtimeMs)}
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
