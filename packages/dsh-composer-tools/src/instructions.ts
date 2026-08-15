/**
 * Instruction-file discovery (host side, pure functions).
 *
 * Pure, synchronous discovery of AGENTS.md / CLAUDE.md instruction files for a
 * session cwd, mirroring dsh-agent-instructions discovery order. Contract
 * lives in .devflow/INTERFACE.md §2.4 and §1.1. All existence/metadata probing
 * uses `lstat` and rejects symbolic links (see §2.4 rationale).
 */

import { lstatSync } from 'node:fs'
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

  const seen = new Set<string>()
  const files: DiscoveredInstruction[] = []

  const regularNames: (string & (typeof INSTRUCTION_CANDIDATES)[number])[] = [
    ...INSTRUCTION_CANDIDATES,
  ]
  const localNames: (string & (typeof LOCAL_INSTRUCTION_CANDIDATES)[number])[] = [
    ...LOCAL_INSTRUCTION_CANDIDATES,
  ]

  // Global candidate first.
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

  return { dshHome, projectRoot, files }
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
