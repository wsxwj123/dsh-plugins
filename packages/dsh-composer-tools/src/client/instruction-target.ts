/**
 * instruction-target — 指令面板两个"新建/编辑 AGENTS.md"入口的纯决策层。
 *
 * 为什么单独抽出（task-10）：旧实现把按钮显隐绑定在 host 的 canCreate* 信号上
 * （canCreate* 只在"目标文件不存在"时为 true），用户全局文件已存在、项目根也常有
 * AGENTS.md，于是两个入口都看不到，被误认为功能缺失。现在两个入口**始终显示**，
 * 文案与点击语义按"目标是否存在"自适应：
 *   不存在 → 「新建…」→ 走 /ct/instructions.create（保留原子创建/mtime 契约）；
 *   已存在 → 「编辑…」→ 直接进已有文件编辑态（复用 read/edit 视图），不报 path-exists；
 *   项目根找不到（projectRootFound !== true）→ 项目级按钮禁用并说明"当前会话不在项目内"。
 *
 * 这里是纯函数（无 React/DOM/IO），红-绿由 node 测试直接驱动；InstructionsTab 只做渲染。
 */

/** 两个入口的作用域（与 host /ct/instructions.create 的 scope 同名）。 */
export type InstructionTargetScope = 'project' | 'global'

/** /ct/instructions.list 响应里本模块用到的字段子集。 */
export interface InstructionListMeta {
  /** host 解析出的全局指令目录（如 ~/.dsh）。 */
  dshHome?: string
  /** host 解析出的项目根（无 .git 时等于 cwd）。 */
  projectRoot?: string
  /** true ⇔ cwd 到文件系统根链上存在 .git 标记。 */
  projectRootFound?: boolean
  /** host 信号：true ⇔ 项目根 AGENTS.md 不存在且可创建。 */
  canCreateRootAgents?: boolean
  /** host 信号：true ⇔ dshHome/AGENTS.md 不存在且可创建。 */
  canCreateGlobalAgents?: boolean
  /** 已发现的文件列表（用 path 判断目标是否已被列出）。 */
  files?: readonly { path?: string }[]
}

/** 渲染上下文：列表是否就绪、当前会话目录。 */
export interface InstructionTargetContext {
  /** 列表已成功加载（phase === 'ready'）。 */
  ready: boolean
  /** 当前会话 cwd（无会话时 undefined）。 */
  cwd?: string
}

/** 一个入口按钮的完整渲染/行为模型。 */
export interface InstructionTargetModel {
  scope: InstructionTargetScope
  /** 按钮文案：目标存在 → 编辑，目标不存在 → 新建。 */
  label: string
  /** tooltip：作用范围；禁用时为禁用原因。 */
  title: string
  /** 是否禁用（列表未就绪/无 cwd/项目根缺失/全局目录未知）。 */
  disabled: boolean
  /** 点击语义（disabled 时无意义，固定给 'create' 便于测试断言）。 */
  action: 'create' | 'edit'
  /** 目标文件绝对路径（无法确定时 undefined）。 */
  targetPath?: string
  /** 目标文件是否已存在（由 list 的 files 或 host canCreate=false 判定）。 */
  exists: boolean
}

const SCOPE_NAME: Record<InstructionTargetScope, string> = { project: '项目级', global: '全局' }
const SCOPE_EFFECT: Record<InstructionTargetScope, string> = {
  project: '仅作用于当前项目',
  global: '对所有会话生效',
}

/** 拼接目标路径：用 '/'，Node（含 Windows）都接受；去掉目录末尾多余分隔符。 */
export function joinTargetPath(dir: string, name: string): string {
  const trimmed = dir.replace(/[\\/]+$/u, '')
  return `${trimmed}/${name}`
}

/** 项目根 AGENTS.md 的词法路径（projectRoot 未知 → undefined）。 */
export function projectRootAgentsPath(projectRoot: string | undefined): string | undefined {
  return projectRoot === undefined || projectRoot === '' ? undefined : joinTargetPath(projectRoot, 'AGENTS.md')
}

/** 全局 AGENTS.md 的词法路径（dshHome 未知 → undefined）。 */
export function globalAgentsPath(dshHome: string | undefined): string | undefined {
  return dshHome === undefined || dshHome === '' ? undefined : joinTargetPath(dshHome, 'AGENTS.md')
}

/** 目标是否已存在：优先看发现列表（path 精确匹配），否则用 host canCreate=false 信号。 */
function targetExists(
  meta: InstructionListMeta,
  scope: InstructionTargetScope,
  targetPath: string | undefined,
): boolean {
  if (targetPath !== undefined
    && Array.isArray(meta.files)
    && meta.files.some((file) => file?.path === targetPath)) {
    return true
  }
  const canCreate = scope === 'project' ? meta.canCreateRootAgents : meta.canCreateGlobalAgents
  // host 的 canCreate*：true ⇔ 不存在且可创建；false ⇔ 已存在（或被 symlink/目录占用等）。
  return canCreate === false
}

/** 禁用的共享原因（列表未就绪 / 无 cwd）。 */
function readinessDisabledReason(context: InstructionTargetContext): string | null {
  if (context.cwd === undefined || context.cwd === '') return '无当前会话目录，无法操作指令文件'
  if (!context.ready) return '指令列表加载完成后可用'
  return null
}

/**
 * 计算一个入口按钮的模型（纯函数）。
 * @param scope - 'project' | 'global'。
 * @param meta - /ct/instructions.list 响应子集（未加载 → null）。
 * @param context - 渲染上下文（ready / cwd）。
 * @returns 按钮文案、tooltip、禁用、动作与目标路径。
 */
export function describeInstructionTarget(
  scope: InstructionTargetScope,
  meta: InstructionListMeta | null,
  context: InstructionTargetContext,
): InstructionTargetModel {
  const targetPath = scope === 'project'
    ? projectRootAgentsPath(meta?.projectRoot)
    : globalAgentsPath(meta?.dshHome)
  const disabledWith = (reason: string): InstructionTargetModel => ({
    scope,
    label: `新建${SCOPE_NAME[scope]} AGENTS.md`,
    title: reason,
    disabled: true,
    action: 'create',
    exists: false,
    ...(targetPath === undefined ? {} : { targetPath }),
  })

  const notReady = readinessDisabledReason(context)
  if (notReady !== null) return disabledWith(notReady)
  if (meta === null) return disabledWith('指令列表加载完成后可用')
  if (scope === 'project' && meta.projectRootFound !== true) {
    return disabledWith('当前会话不在项目内，无法新建或编辑项目级 AGENTS.md')
  }
  if (targetPath === undefined) {
    return disabledWith(scope === 'project' ? '无法定位项目根目录' : '无法定位全局指令目录')
  }

  const exists = targetExists(meta, scope, targetPath)
  const action: 'create' | 'edit' = exists ? 'edit' : 'create'
  const verb = exists ? '编辑' : '新建'
  return {
    scope,
    label: `${verb}${SCOPE_NAME[scope]} AGENTS.md`,
    title: exists
      ? `编辑${SCOPE_NAME[scope]} AGENTS.md（${SCOPE_EFFECT[scope]}）`
      : `新建${SCOPE_NAME[scope]} AGENTS.md（${SCOPE_EFFECT[scope]}${scope === 'global' ? '，创建前会二次确认' : ''}）`,
    disabled: false,
    action,
    targetPath,
    exists,
  }
}

/** 同时计算两个入口（顺序固定：项目级、全局）。 */
export function describeInstructionTargets(
  meta: InstructionListMeta | null,
  context: InstructionTargetContext,
): { project: InstructionTargetModel; global: InstructionTargetModel } {
  return {
    project: describeInstructionTarget('project', meta, context),
    global: describeInstructionTarget('global', meta, context),
  }
}
