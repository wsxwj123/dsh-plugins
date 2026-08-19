/**
 * Instruction-file discovery (host side, pure functions).
 *
 * Pure, synchronous discovery of AGENTS.md / CLAUDE.md instruction files for a
 * session cwd, mirroring dsh-agent-instructions discovery order. Contract
 * lives in .devflow/INTERFACE.md §2.4 and §1.1. All existence/metadata probing
 * uses `lstat` and rejects symbolic links (see §2.4 rationale).
 */

import { lstatSync, realpathSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const INSTRUCTION_CANDIDATES = ['AGENTS.md', 'CLAUDE.md'] as const
export const LOCAL_INSTRUCTION_CANDIDATES = ['AGENTS.local.md', 'CLAUDE.local.md'] as const
export const PROJECT_ROOT_MARKERS = ['.git'] as const
export const MAX_SOURCE_BYTES = 1048576

export type InstructionLevel = 'global' | 'project' | 'local'

export interface DiscoveredInstruction {
  path: string
  displayPath: string
  level: InstructionLevel
  name: string
  sizeBytes: number
  mtimeMs: number
}

export interface DiscoveryResult {
  dshHome: string
  projectRoot: string
  projectRootFound: boolean   // true ⇔ cwd 到文件系统根链上存在 '.git' 标记（真项目根）；
                              // false ⇔ findProjectRootSync 回退到 resolve(cwd) 本身。
  canCreateRootAgents: boolean // host 计算的 "新建项目级 AGENTS.md" 显示信号（见 §2.4）。
  canCreateGlobalAgents: boolean // host 计算的 "新建全局 AGENTS.md" 显示信号（§2.4，增量 2）。
  files: DiscoveredInstruction[]
}

/**
 * resolveDshHomeLocal: configured / env DSH_HOME / ~/.dsh, then path.resolve.
 * Blank values (whitespace-only or empty) count as unset.
 */
export function resolveDshHomeLocal(configured?: string, env?: NodeJS.ProcessEnv): string {
  const fromConfigured = configured?.trim()
  if (fromConfigured) return path.resolve(fromConfigured)
  const fromEnv = env?.DSH_HOME?.trim()
  if (fromEnv) return path.resolve(fromEnv)
  return path.resolve(os.homedir(), '.dsh')
}

/**
 * findProjectRootSync: climb from path.resolve(cwd) upward, first directory
 * containing '.git' (file or dir) is the project root; reaching fs root with
 * none found returns path.resolve(cwd). Missing/unreadable dirs count as "no
 * marker".
 */
export function findProjectRootSync(cwd: string): string {
  let current = path.resolve(cwd)
  for (;;) {
    if (PROJECT_ROOT_MARKERS.some((marker) => pathExists(path.join(current, marker)))) {
      return current
    }
    const parent = path.dirname(current)
    if (parent === current) return path.resolve(cwd)
    current = parent
  }
}

/**
 * ancestorChain: inclusive directory chain [root, ..., cwd], broadest first.
 */
export function ancestorChain(root: string, cwd: string): string[] {
  const resolvedRoot = path.resolve(root)
  const resolvedCwd = path.resolve(cwd)
  const chain: string[] = []
  let current = resolvedCwd
  for (;;) {
    chain.unshift(current)
    if (current === resolvedRoot) break
    const parent = path.dirname(current)
    if (parent === current) break
    current = parent
  }
  return chain
}

/**
 * discoverInstructions: synchronous discovery for a session cwd. Global
 * {dshHome}/AGENTS.md goes first when present, then project root → cwd chain
 * (broadest first), within a directory regular candidates before .local
 * candidates; deduped by absolute path. Symbolic links rejected (via lstat).
 * stat failures skip the file, never throw.
 */
export function discoverInstructions(opts: { cwd: string; dshHome?: string }): DiscoveryResult {
  const dshHome = opts.dshHome ? path.resolve(opts.dshHome) : resolveDshHomeLocal()
  const cwd = path.resolve(opts.cwd)
  const projectRoot = findProjectRootSync(cwd)
  const projectRootFound = hasGitMarkerOnChain(cwd)
  const canCreateRootAgents = projectRootFound && canCreateProjectRootAgents(projectRoot)
  const canCreateGlobal = canCreateGlobalAgents(dshHome)

  const seen = new Set<string>()
  const files: DiscoveredInstruction[] = []

  const regularNames: (string & (typeof INSTRUCTION_CANDIDATES)[number])[] = [
    ...INSTRUCTION_CANDIDATES,
  ]
  const localNames: (string & (typeof LOCAL_INSTRUCTION_CANDIDATES)[number])[] = [
    ...LOCAL_INSTRUCTION_CANDIDATES,
  ]

  // Global candidate first: {dshHome}/AGENTS.md（DSH 官方全局指令）。
  addCandidate(files, seen, path.join(dshHome, 'AGENTS.md'), 'global', projectRoot, dshHome)

  // Project root → cwd chain (broadest first), regular then local per dir.
  for (const dir of ancestorChain(projectRoot, cwd)) {
    for (const name of regularNames) {
      addCandidate(files, seen, path.join(dir, name), 'project', projectRoot, dshHome)
    }
    for (const name of localNames) {
      addCandidate(files, seen, path.join(dir, name), 'local', projectRoot, dshHome)
    }
  }

  return { dshHome, projectRoot, projectRootFound, canCreateRootAgents, canCreateGlobalAgents: canCreateGlobal, files }
}

/**
 * hasGitMarkerOnChain: true ⇔ some directory on the chain from path.resolve(cwd)
 * up to the fs root contains a '.git' marker (file or dir). Mirrors
 * findProjectRootSync's walk so `projectRootFound` reports whether the returned
 * projectRoot is a real project root (marker hit) or the resolve(cwd) fallback.
 */
function hasGitMarkerOnChain(cwd: string): boolean {
  let current = path.resolve(cwd)
  for (;;) {
    if (PROJECT_ROOT_MARKERS.some((marker) => pathExists(path.join(current, marker)))) {
      return true
    }
    const parent = path.dirname(current)
    if (parent === current) return false
    current = parent
  }
}

/**
 * createProjectAgentsTemplate: the 2-line UTF-8 template written by
 * /ct/instructions.create (INTERFACE §1.5) — a level-1 heading plus a Chinese
 * comment. No user/secret content; version-controlled with the plugin.
 */
export function createProjectAgentsTemplate(): string {
  return (
    '# 项目指令（AGENTS.md）\n' +
    '\n' +
    '<!-- 记录本项目的团队约定、编码规范、任务要求与常用命令。此文件会被 DSH 作为本项目的指令自动加载。 -->\n'
  )
}

/**
 * canCreateProjectRootAgents: authoritative "is there a create entry" signal
 * (INTERFACE §2.4). Returns true ⇔ the realpath-resolved project root contains
 * a '.git' marker AND `realpath(projectRoot)/AGENTS.md` does not currently
 * exist (lstat probe; a symlink/dir occupying the name counts as "exists").
 * Any IO failure → false. `projectRoot` may go through symlinks; it is resolved
 * to its true physical directory before the marker/existence checks.
 */
export function canCreateProjectRootAgents(projectRoot: string): boolean {
  let realRoot: string
  try {
    realRoot = realpathSync(projectRoot)
  } catch {
    return false // realpath failure (missing/unreadable dir) → no entry
  }
  if (!PROJECT_ROOT_MARKERS.some((marker) => pathExists(path.join(realRoot, marker)))) {
    return false // real location has no .git marker → not a real project root
  }
  const target = path.join(realRoot, 'AGENTS.md')
  try {
    lstatSync(target)
    return false // occupier exists (file/dir/symlink) → treat as already present
  } catch {
    return true // name is free → entry may be shown
  }
}

/**
 * projectRootAgentsTarget: create's write destination —
 * `path.join(fs.realpathSync(projectRoot), 'AGENTS.md')` (INTERFACE §2.4).
 * realpathSync unwinds any symlink components on the directory chain so the
 * target lands inside the project's true physical directory (§1.5 判定 4).
 * A realpath failure (deleted dir, etc.) throws; the caller maps it to
 * system-error.
 */
export function projectRootAgentsTarget(projectRoot: string): string {
  return path.join(realpathSync(projectRoot), 'AGENTS.md')
}

/**
 * createGlobalAgentsTemplate: the 2-line UTF-8 template written by
 * /ct/instructions.create with scope='global' (INTERFACE §1.5 模板段，增量 2) —
 * a level-1 heading plus a Chinese comment. Distinct single source from the
 * project template (R-E7): each scope's create response `content` is exactly
 * the template written for that scope.
 */
export function createGlobalAgentsTemplate(): string {
  return (
    '# 全局指令（AGENTS.md）\n' +
    '\n' +
    '<!-- 记录所有会话通用的全局约定、编码规范与常用命令。此文件会被 DSH 作为全局指令自动加载。 -->\n'
  )
}

/**
 * canCreateGlobalAgents: authoritative "show the global create entry" signal
 * (INTERFACE §2.4，增量 2). true ⇔ `realpath(dshHome)/AGENTS.md` does not
 * currently exist (lstat probe; a symlink/dir occupying the name counts as
 * "exists"). A realpath failure (dshHome missing/unreadable) → false.
 * Independent of whether the cwd has a project root (.git marker).
 */
export function canCreateGlobalAgents(dshHome: string): boolean {
  let realHome: string
  try {
    realHome = realpathSync(dshHome)
  } catch {
    return false // dshHome 不可解析（不存在/不可读）→ 按不可新建处理
  }
  const target = path.join(realHome, 'AGENTS.md')
  try {
    lstatSync(target)
    return false // occupier exists (file/dir/symlink) → treat as already present
  } catch {
    return true // name is free → entry may be shown
  }
}

/**
 * dshHomeAgentsTarget: scope='global' create's write destination —
 * `path.join(fs.realpathSync(dshHome), 'AGENTS.md')` (INTERFACE §2.4，增量 2).
 * realpathSync unwinds any symlink components on the ~/dshHome directory chain
 * so the file lands inside the real physical directory DSH actually loads
 * (§1.5 判定 5 global 分支). A realpath failure throws; the caller maps it to
 * system-error.
 */
export function dshHomeAgentsTarget(dshHome: string): string {
  return path.join(realpathSync(dshHome), 'AGENTS.md')
}

function addCandidate(
  files: DiscoveredInstruction[],
  seen: Set<string>,
  candidatePath: string,
  level: InstructionLevel,
  projectRoot: string,
  dshHome: string,
): void {
  const abs = path.resolve(candidatePath)
  if (seen.has(abs)) return

  let st
  try {
    st = lstatSync(abs)
  } catch {
    return // stat failure: skip, never throw
  }
  if (st.isSymbolicLink()) return // symbolic links rejected

  seen.add(abs)
  files.push({
    path: abs,
    displayPath: displayPathFor(abs, level, projectRoot, dshHome),
    level,
    name: path.basename(abs),
    sizeBytes: st.size,
    mtimeMs: st.mtimeMs,
  })
}

/**
 * displayPathFor: project/local files are project-root-relative; the global
 * file shows `~/.dsh/AGENTS.md` for the default home, `$DSH_HOME/AGENTS.md`
 * when the home is non-default (INTERFACE §1.1).
 */
function displayPathFor(abs: string, level: InstructionLevel, projectRoot: string, dshHome: string): string {
  if (level === 'global') {
    const isDefault = dshHome === path.resolve(os.homedir(), '.dsh')
    return isDefault ? `~/.dsh/${path.basename(abs)}` : `$DSH_HOME/${path.basename(abs)}`
  }
  return path.relative(projectRoot, abs)
}

/**
 * isDiscoveredPath: path.resolve(inputPath) is among the discovered absolute
 * paths. Because discovery already rejects symlinks, membership alone also
 * satisfies the "not a symlink" constraint.
 */
export function isDiscoveredPath(inputPath: string, discovery: DiscoveryResult): boolean {
  const resolved = path.resolve(inputPath)
  return discovery.files.some((f) => f.path === resolved)
}

function pathExists(p: string): boolean {
  try {
    lstatSync(p)
    return true
  } catch {
    return false
  }
}
