/**
 * Recycle-bin store: durable on-disk layout + the four file primitives the
 * /sm endpoints are built on.
 *
 * Layout (mirrors the executable contract, helpers.js):
 *   <trashRoot>/<id>/            the moved session directory
 *   <trashRoot>/_metadata/<id>.json   a durable record { id, originalDir, title,
 *                                     deletedAt, projectKey }
 *
 * originalDir is kept ONLY in the on-disk record (for restore). It is never
 * returned by /sm/trash (path-leak guard, INTERFACE §3.5 / F-1).
 *
 * The store never opens/reads/writes the session log body — it moves whole
 * directories. Every primitive is idempotent-guarded by its caller (the
 * handler decides "already done" via record/target existence); the store just
 * performs the single, atomic rename/remove.
 */

import fs from 'node:fs'
import path from 'node:path'
import { assertValidId, isStableSegment } from './paths.js'

/**
 * Marker file that makes a directory a recognizable session directory. The
 * /sm/delete gate refuses to move a dir lacking it (INTERFACE §3.1 step 3,
 * S-3); the acceptance harness mirrors the same name with its own copy.
 */
export const SESSION_MARKER = 'session.jsonl.zstd'

/**
 * Every KNOWN session-log filename — the fast path only, NOT the gate itself.
 *
 * Three independent axes produce the names:
 *  - compression: zstd writes `session.jsonl.zstd`, `compression:'none'` writes
 *    the plaintext `session.jsonl`. Only accepting the compressed name made
 *    every delete on a plaintext deployment fail with `not-a-session` (M3).
 *  - session format: DSH >= 0.1.5 migrates a session to format V3 and writes
 *    `session.v3.jsonl.zstd` (or `session.v3.jsonl` plaintext). The V3 name is
 *    NOT covered by the V2 entries, so before this list carried it every
 *    migrated session failed the /sm/delete gate with `not-a-session`: its row
 *    never reached the recycle bin while an un-migrated V2 session in the same
 *    list deleted normally. That asymmetry is the reported "列表里删的不进回收站"
 *    bug — a session silently stopped being deletable the moment it was
 *    resumed under 0.1.5.
 *  - the same story AGAIN at V4: DSH 0.2.1 writes `session.v4.jsonl.zstd`, and
 *    the v3-only list refused every 0.2.1 session (92 of them on this machine)
 *    with `not-a-session` — the delete button reappeared but nothing deleted.
 *
 * That is why `hasSessionMarker` does not trust this list alone: it falls back
 * to the anchored SESSION_LOG_RE below, so the NEXT format bump (v5, v6, …)
 * cannot silently re-break deletion. The list stays because it is the cheap
 * fast path and because handler.ts uses it in the `not-a-session` error copy.
 * Order: current format first, then the version-less V2 names, then V3.
 */
export const SESSION_MARKERS: readonly string[] = [
  'session.v4.jsonl.zstd',
  'session.v4.jsonl',
  SESSION_MARKER,
  'session.jsonl',
  'session.v3.jsonl.zstd',
  'session.v3.jsonl',
]

/**
 * Anchored session-log filename shape, the version-agnostic fallback marker.
 *
 * Covers `session.jsonl` (V0-ish), `session.v1.jsonl`, `session.v3.jsonl.zstd`,
 * `session.v4.jsonl.zstd`, and a future `session.v5.jsonl.zstd` — every format
 * version, compressed or plaintext — while rejecting near-misses:
 * `session.jsonl.bak`, `xsession.jsonl`, `session.v4.jsonl.zstd.part`.
 * The anchors plus the optional groups are what make that discrimination work;
 * do not relax them into a `includes`/`startsWith` check.
 */
const SESSION_LOG_RE = /^session(\.v\d+)?\.jsonl(\.zstd)?$/

/**
 * True when `dir` carries a session log under any supported marker name.
 *
 * Contract: SYNCHRONOUS — handler.ts gates /sm/delete on it synchronously.
 * Two stages:
 *  1. fast path: `existsSync` on every known SESSION_MARKERS name (the common
 *     case; a handful of syscalls, no directory scan);
 *  2. fallback: read the directory and accept any entry matching
 *     SESSION_LOG_RE, so a format-version bump cannot silently make every new
 *     session undeletable again (the V4 regression was exactly that).
 * A missing/unreadable dir carries no session → false.
 */
export function hasSessionMarker(dir: string): boolean {
  if (SESSION_MARKERS.some((name) => fs.existsSync(path.join(dir, name)))) return true
  let entries: string[]
  try {
    entries = fs.readdirSync(dir)
  } catch {
    return false
  }
  return entries.some((name) => SESSION_LOG_RE.test(name))
}

/** The metadata sub-directory inside the trash root. */
export const METADATA_DIR = '_metadata'

export interface TrashRecord {
  id: string
  originalDir: string
  title: string | null
  deletedAt: number
  projectKey: string | null
}

export interface TrashStoreOptions {
  /**
   * Override how a single trash item is removed during emptyTrash. Used by
   * tests to inject a partial failure (system-error) without touching real
   * files; defaults to fs.rmSync.
   */
  rmItem?: (id: string, trashRoot: string) => boolean | void
  /**
   * Optional warn logger (a plain function — never the cordis callable).
   * Used to leave a trace when a metadata record is corrupt (S-6) so a broken
   * record cannot vanish silently; defaults to a no-op.
   */
  log?: { warn(msg: string): void }
}

/**
 * A store bound to one trash root. All paths are computed from the root, so
 * the store is trivially safe as long as the root itself is trusted (the
 * handler asserts the trash root is outside the sessions scan).
 */
export class TrashStore {
  readonly root: string
  private readonly metaDir: string
  private readonly rmItem: (id: string, trashRoot: string) => boolean | void
  private readonly log: { warn(msg: string): void }

  constructor(root: string, opts: TrashStoreOptions = {}) {
    this.root = root
    this.metaDir = path.join(root, METADATA_DIR)
    this.rmItem = opts.rmItem ?? defaultRmItem
    this.log = opts.log ?? { warn: () => {} }
    // Ensure the trash root and its metadata dir exist up-front so the first
    // delete can rename directly into a home directory.
    fs.mkdirSync(this.metaDir, { recursive: true })
  }

  /** The absolute metadata record path for an id. */
  recordPath(id: string): string {
    return path.join(this.metaDir, `${id}.json`)
  }

  /** The moved-directory location for an id. */
  itemPath(id: string): string {
    return path.join(this.root, id)
  }

  recordIdForRecordFile(filename: string): string | null {
    if (!filename.endsWith('.json')) return null
    return filename.slice(0, -'.json'.length)
  }

  readRecord(id: string): TrashRecord | null {
    const p = this.recordPath(id)
    if (!fs.existsSync(p)) return null
    try {
      return JSON.parse(fs.readFileSync(p, 'utf8')) as TrashRecord
    } catch (err) {
      // S-6: a corrupt/half-written record must not vanish silently — it hides
      // the trash item from /sm/trash and makes restore report not-in-trash.
      // Leave a warn trace so the operator can find the broken file.
      this.log.warn(`trash record ${p} is corrupt; treated as missing (${String(err)})`)
      return null
    }
  }

  writeRecord(rec: TrashRecord): void {
    fs.mkdirSync(this.metaDir, { recursive: true })
    // S-6: atomic record write — serialize to a temp file in the SAME
    // directory, then rename over the target. A crash mid-write leaves either
    // the old record or a stray .tmp file, never a half-written record.json
    // that readRecord would mis-parse as corruption.
    const target = this.recordPath(rec.id)
    const tmp = `${target}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(rec))
    fs.renameSync(tmp, target)
  }

  deleteRecord(id: string): void {
    fs.rmSync(this.recordPath(id), { force: true })
  }

  /** Every stored record (for /sm/trash and restore lookups). */
  records(): TrashRecord[] {
    if (!fs.existsSync(this.metaDir)) return []
    const out: TrashRecord[] = []
    for (const f of fs.readdirSync(this.metaDir)) {
      const id = this.recordIdForRecordFile(f)
      if (id === null) continue
      const rec = this.readRecord(id)
      if (rec !== null) out.push(rec)
    }
    return out
  }

  /**
   * Move a whole session directory into the trash and write its durable
   * record. Throws on IO failure (caller maps to system-error); on success the
   * idempotent truth "the directory is no longer at originalDir" is real.
   *
   * Ordering (I-2): the durable record is written FIRST and is the commit
   * point; the rename comes second. A rename failure rolls the record back, so
   * system-error keeps its contract meaning "host changed no committed
   * persistent state". (The old rename-then-record order could leave a MOVED
   * directory with NO record: invisible in /sm/trash, unreachable by restore,
   * and permanently deleted by emptyTrash — an unrecoverable orphan.) The crash
   * window between record write and rename is self-healing: a re-delete
   * overwrites the record, and a restore refuses with restore-target-exists
   * because the dir is still at its original location.
   */
  moveToTrash(fromDir: string, rec: Omit<TrashRecord, 'deletedAt'>): void {
    const dest = this.itemPath(rec.id)
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    // L1 + W4: refuse BEFORE touching the record when the destination is already
    // taken. The rename would fail anyway (it never overwrites a non-empty dir),
    // but the rollback then deleted the record of whatever already sat there,
    // turning that older entry into an unrecoverable orphan. On a
    // case-INSENSITIVE volume (APFS/NTFS default) the collision does not even
    // need the same id: deleting `foo` while `Foo` is in the trash hits the same
    // paths for both the item dir and `_metadata/<id>.json`.
    if (fs.existsSync(dest)) {
      throw new Error(`trash dest already exists for id ${rec.id}; refusing to overwrite or clobber its record`)
    }
    this.writeRecord({ ...rec, deletedAt: Date.now() })
    try {
      // renameSync is atomic on the same volume; it never overwrites a
      // non-empty target dir, so a restored-then-recreated scenario cannot
      // silently clobber.
      fs.renameSync(fromDir, dest)
    } catch (err) {
      // Roll the record back so a failed move leaves NO trace of a move. If the
      // rollback itself fails, the leftover record is the recoverable trace
      // (listed by /sm/trash, purged by emptyTrash) — never the invisible
      // orphan, so keep the record rather than lose the trace.
      try {
        this.deleteRecord(rec.id)
      } catch {
        /* record rollback is best-effort; a leftover record is safer than an orphan */
      }
      throw err
    }
  }

  /**
   * Item directory exists under the trash root.
   */
  hasItem(id: string): boolean {
    return fs.existsSync(this.itemPath(id))
  }

  /**
   * A record exists for the id.
   */
  hasRecord(id: string): boolean {
    return fs.existsSync(this.recordPath(id))
  }

  /**
   * Restore a trash item back to its recorded original directory. The caller
   * has already decided (order matters, INTERFACE §3.2) whether the record
   * exists, whether the original dir is free, and that the item dir exists.
   * This just performs the move and clears the record.
   *
   * Record cleanup is best-effort AFTER the restore rename (I-2): the restore
   * itself is the committed truth, so a record-removal failure must not turn a
   * successful restore into a contract-violating system-error ("host changed no
   * persistent state" — the dir already moved back). A leftover record is
   * harmless and self-healing: emptyTrash purges records whose item dir is gone.
   */
  restoreItem(rec: TrashRecord): void {
    const from = this.itemPath(rec.id)
    fs.mkdirSync(path.dirname(rec.originalDir), { recursive: true })
    fs.renameSync(from, rec.originalDir)
    try {
      this.deleteRecord(rec.id)
    } catch {
      /* restore succeeded; a leftover record self-heals via emptyTrash's record purge */
    }
  }

  /**
   * Empty every real trash item (skips the metadata dir), removing records
   * after a successful (or partial) rm. Returns the list of ids that could NOT
   * be removed, so the caller can surface a system-error while keeping the
   * still-present items restorable. Any rm failure leaves that item's record
   * intact.
   *
   * SECURITY-REPORT S1 + H3: only entries that are recognizable trash items may
   * be removed. "Recognizable" is a SUBSTANTIVE judgment, not just a name shape:
   * either the entry has a durable record, or (orphan whose record was lost) it
   * is a directory that actually carries a session marker. The name gates alone
   * let every ordinary filename through (`.DS_Store`, `notes.txt`, any user
   * directory), so a misconfigured trash root turned "empty trash" into a blind
   * rm -rf of unrelated content.
   */
  empty(): string[] {
    if (!fs.existsSync(this.root)) return []
    const failed: string[] = []
    for (const entry of fs.readdirSync(this.root)) {
      if (entry === METADATA_DIR) continue
      if (!this.isTrashItem(entry)) continue
      try {
        const removed = this.rmItem(entry, this.root)
        if (removed === false) {
          failed.push(entry)
          continue
        }
      } catch {
        failed.push(entry)
        continue
      }
    }
    // Purge records only for ids that are actually gone, so a partial failure
    // leaves the surviving items (still present under the trash root) with
    // their record intact and therefore restorable.
    for (const rec of this.records()) {
      if (!this.hasItem(rec.id)) this.deleteRecord(rec.id)
    }
    return failed
  }

  /**
   * Whether a trash-root entry is really one of OUR items, i.e. safe for
   * empty() to remove recursively (H3). Two ways to qualify:
   *  1. a durable record exists for the name → we put it there;
   *  2. no record (lost in a crash between the record write and the rename), but
   *     the name passes the delete-side id gates AND the entry is a directory
   *     that carries a session marker → a moved session dir, i.e. our orphan.
   * Everything else — dotfiles, user documents, unrelated directories — is left
   * alone. `empty()` is the only recursive removal in this plugin, so this is
   * the gate that keeps a misconfigured root from becoming data loss.
   */
  private isTrashItem(name: string): boolean {
    if (this.hasRecord(name)) return true
    if (!assertValidId(name) || !isStableSegment(name)) return false
    const p = this.itemPath(name)
    try {
      if (!fs.statSync(p).isDirectory()) return false
    } catch {
      return false // vanished / unreadable: not ours to delete
    }
    return hasSessionMarker(p)
  }
}

/** Default removal: recursive, force, absent-safe. */
function defaultRmItem(id: string, trashRoot: string): void {
  fs.rmSync(path.join(trashRoot, id), { recursive: true, force: true })
}
