/**
 * Path encoding + bounds helpers for the session recycle bin.
 *
 * The node half targets the REAL DSH on-disk session layout, so it uses the
 * actual DSH encoders (dsh-session-persistence-jsonl):
 *
 *     projectDir(root, cwd) = join(root, "_no-cwd")            // cwd undefined/null
 *                           = join(root, projectKey(cwd))       // otherwise
 *     sessionDir(root,cwd,id) = join(projectDir(root,cwd), encodeSegment(id))
 *
 * where `projectKey` folds a cwd path into a `--<readable>--` segment and
 * `encodeSegment` escapes an id into a `~XXXX` segment. The locked acceptance
 * suite (tests/acceptance) deliberately models a SIMPLIFIED literal layout
 * (`join(root, cwd, id)`) as a standalone contract mirror that runs against
 * its own harness backend; the node half here implements the real-encoding
 * semantics, and tests/integration adapts its fixtures to the encoded layout so
 * the same scenarios still pass against the shipped handler.
 */

import path from 'node:path'

// Characters that would change path semantics if they appeared in a segment.
// Mirrors the acceptance harness's assertValidId charset (paths, control chars).
const INVALID_ID_CHARSET = /[\\/\n\r\t\0\u0000-\u001f]/

/** The project-directory segment DSH uses for a session without a cwd. */
export const NO_CWD_DIR = '_no-cwd'

/**
 * Windows reserved DEVICE names (W4). On win32 these never name a file: `NUL`
 * swallows writes and `CON`/`AUX`/`COM1`… are devices; the reservation ignores
 * case AND any extension (`con.txt` is still the console). A session directory
 * can never legitimately be called this, so an id that would resolve to a device
 * is refused at the 400 gate instead of being handed to rename/rm. Checked on
 * every platform: an id minted on Linux must not become dangerous the moment the
 * same sessions tree is opened on Windows.
 */
const WINDOWS_RESERVED_NAMES = new Set([
  'con', 'prn', 'aux', 'nul',
  'com1', 'com2', 'com3', 'com4', 'com5', 'com6', 'com7', 'com8', 'com9',
  'lpt1', 'lpt2', 'lpt3', 'lpt4', 'lpt5', 'lpt6', 'lpt7', 'lpt8', 'lpt9',
])

/** True when `id` would resolve to a Windows device (any case, any extension). */
function isWindowsReservedName(id: string): boolean {
  const dot = id.indexOf('.')
  const stem = dot === -1 ? id : id.slice(0, dot)
  return WINDOWS_RESERVED_NAMES.has(stem.toLowerCase())
}

/**
 * 400-level id validity gate (INTERFACE §3.1 invalid-id). Rejects only the
 * inputs the harness asserts must be a 400:
 *  - non-string / empty
 *  - exact `.` / `..`
 *  - path separator, newline, tab, NUL or other control char
 *  - a Windows reserved device name (`CON`, `nul`, `COM1`, `con.log`, …)
 * NOTE: it does NOT reject `%` — `%` ids pass this gate and are instead
 * rejected one level down as `path-out-of-bounds` (200) by isStableSegment,
 * exactly as the harness separates the two stages.
 */
export function assertValidId(id: unknown): id is string {
  if (typeof id !== 'string' || id.length === 0) return false
  if (id === '.' || id === '..') return false
  // `_metadata` is the recycle-bin's reserved metadata directory name; a
  // session id equal to it would collide with the metadata namespace inside
  // the trash (delete would rename onto a non-empty dir, empty would skip it).
  if (id === '_metadata') return false
  // W4: `CON` / `NUL` / `COM1` … are Windows devices, never directories.
  if (isWindowsReservedName(id)) return false
  if (INVALID_ID_CHARSET.test(id)) return false
  // A single path segment must survive a basename round-trip unchanged.
  if (path.basename(id) !== id) return false
  return true
}

/**
 * 200-level "stable segment" gate, used by /sm/delete before the
 * path-out-of-bounds check. An id that fails this still passed assertValidId
 * (400) but cannot be placed as a single on-disk segment without ambiguity —
 * e.g. it contains `%` which would collide with the `~XXXX` escape encoding.
 */
export function isStableSegment(id: string): boolean {
  if (id.includes('%')) return false
  return path.basename(id) === id
}

/**
 * Production-faithful encodeSegment (dsh-session-persistence-jsonl): escapes
 * every character outside the safe set into `~XXXX` (hex of the code point).
 * Safe chars `[A-Za-z0-9._-]` pass through unchanged, so a stable id (safe
 * charset) yields `encodeSegment(id) === id`.
 */
export function encodeSegment(raw: string): string {
  if (raw.length === 0) throw new Error('cannot encode an empty path segment')
  if (raw === '.') return '~002E'
  if (raw === '..') return '~002E~002E'
  let out = ''
  for (let i = 0; i < raw.length; i++) {
    const code = raw.charCodeAt(i)
    const ch = String.fromCharCode(code)
    if (ch !== '~' && /^[A-Za-z0-9._-]$/.test(ch)) out += ch
    else out += '~' + code.toString(16).toUpperCase().padStart(4, '0')
  }
  return out
}

/**
 * Production-faithful projectKey (dsh-session-persistence-jsonl): folds a cwd
 * path into a single `--<readable>--` directory segment. Separators collapse
 * to `-`, unsafe characters escape to `~XXXX`.
 */
export function projectKey(cwd: string): string {
  if (cwd.length === 0) throw new Error('cannot encode an empty project path')
  let readable = ''
  let separatorRun = false
  for (let i = 0; i < cwd.length; i++) {
    const code = cwd.charCodeAt(i)
    const ch = String.fromCharCode(code)
    if (ch === '/' || ch === '\\' || ch === ':') {
      if (!separatorRun) readable += '-'
      separatorRun = true
    } else if (ch !== '~' && /^[A-Za-z0-9._-]$/.test(ch)) {
      readable += ch
      separatorRun = false
    } else {
      readable += '~' + code.toString(16).toUpperCase().padStart(4, '0')
      separatorRun = false
    }
  }
  return `--${(readable.replace(/^-+/, '') || 'root').slice(0, 251)}--`
}

/**
 * Resolve the project directory for a delete request against the real DSH
 * layout:
 *  - cwd undefined/null → the DSH `_no-cwd` project dir
 *  - cwd '' (empty)     → cannot locate a project (lookup failure)
 *  - cwd non-string     → invalid
 *  - otherwise          → projectDir(root, cwd) = join(root, projectKey(cwd))
 */
export type ProjectLookup =
  | { kind: 'dir'; projectDir: string }
  | { kind: 'not-found' }
  | { kind: 'invalid' }

export function lookupProjectDir(root: string, cwd: unknown): ProjectLookup {
  if (cwd === undefined || cwd === null) return { kind: 'dir', projectDir: path.join(root, NO_CWD_DIR) }
  if (typeof cwd !== 'string') return { kind: 'invalid' }
  if (cwd.length === 0) return { kind: 'not-found' }
  return { kind: 'dir', projectDir: path.join(root, projectKey(cwd)) }
}

/**
 * True when `child` resolves strictly inside `parent` (or equals `parent`).
 * Backs the path-out-of-bounds gate (target must stay under the configured
 * sessions root) and confirms the trash root lives outside the sessions scan.
 *
 * @param impl - path flavor to judge with; defaults to the running platform.
 *   Pass `path.win32` to apply Windows semantics (backslash separator, `C:`/UNC
 *   roots, CASE-INSENSITIVE comparison — NTFS is case-insensitive, so
 *   `c:\windows` and `C:\Windows` are the same directory) from any host, which
 *   is what makes the Windows entries in the trash-root denylist real
 *   protection instead of dead strings (W1).
 */
export function isInsideOrEqual(parent: string, child: string, impl: typeof path = path): boolean {
  const caseInsensitive = impl.sep === '\\'
  const norm = (v: string): string => {
    const r = impl.resolve(v)
    return caseInsensitive ? r.toLowerCase() : r
  }
  const p = norm(parent)
  const c = norm(child)
  return c === p || c.startsWith(p + impl.sep)
}

/**
 * The session directory for a delete: `join(projectDir, encodeSegment(id))`.
 * The id is already validated by assertValidId (no separator, no `.`/`..`), so
 * `encodeSegment` cannot introduce a path separator; a stable id encodes to
 * itself (safe charset).
 */
export function sessionSegment(projectDir: string, id: string): string {
  return path.join(projectDir, encodeSegment(id))
}
