/**
 * Handler-level environment builder: a real temp sessions tree + a real
 * TrashStore + the /sm handler wired to the realistic workspace-domain stub
 * (see _harness.mjs for why the stub is async).
 *
 * Every env is independent (own temp dir, own domain state) so tests can run in
 * any order and in parallel.
 */
import fs from 'node:fs'
import path from 'node:path'
import { loadSrc, tmpdir, rmrf, makeWorkspaceDomain } from './_harness.mjs'

const { TrashStore, SESSION_MARKER } = await loadSrc('src/trash.ts')
const { createSmHandler } = await loadSrc('src/handler.ts')
const { projectKey, encodeSegment, NO_CWD_DIR } = await loadSrc('src/paths.ts')

export { SESSION_MARKER, TrashStore, createSmHandler, projectKey, encodeSegment, NO_CWD_DIR }

/**
 * @param opts.archivedSessionIds - initial archive set in the workspace global.
 * @param opts.failWrite - the durable archive write rejects.
 * @param opts.closed - the workspace domain is closing (set rejects, get throws).
 * @param opts.domainUnavailable - `storageDomain.get('workspace')` returns null.
 * @param opts.live - session ids the (optional) live SessionStore knows.
 * @param opts.liveCwds - authoritative `header.cwd` per live id.
 */
export function makeEnv(opts = {}) {
  const base = tmpdir('env')
  const sessionsRoot = path.join(base, 'sessions')
  const trashRoot = path.join(base, 'trash')
  fs.mkdirSync(sessionsRoot, { recursive: true })

  const ws = makeWorkspaceDomain(opts)
  const liveIds = new Set(opts.live ?? [])
  const liveCwds = { ...(opts.liveCwds ?? {}) }
  const warnings = []
  const trash = new TrashStore(trashRoot)

  const handler = createSmHandler({
    sessionsRoot,
    trash,
    sessions: {
      get: (id) =>
        liveIds.has(id) ? { id, ...(liveCwds[id] ? { header: { cwd: liveCwds[id] } } : {}) } : undefined,
    },
    storageDomain: { get: (name) => (name !== 'workspace' || opts.domainUnavailable === true ? null : ws.domain) },
    readWorkspaceGlobal: () => ws.readGlobal(),
    log: { warn: (m) => warnings.push(String(m)) },
  })

  return {
    base,
    sessionsRoot,
    trashRoot,
    trash,
    ws,
    warnings,
    handler,
    /** Dispatch and await the response (works whether handle is sync or async). */
    call: async (method, body) => handler.handle(method, {}, body),
    /** Dispatch WITHOUT awaiting — for the concurrent-write reproduction. */
    dispatch: (method, body) => handler.handle(method, {}, body),
    /**
     * Create a session dir on the real encoded DSH layout.
     * @param cwd - project cwd (undefined → the `_no-cwd` project dir).
     * @param id - session id.
     * @param marker - marker filename; defaults to the compressed one.
     */
    newSession(cwd, id, marker = SESSION_MARKER) {
      const projectDir = cwd ? path.join(sessionsRoot, projectKey(cwd)) : path.join(sessionsRoot, NO_CWD_DIR)
      const dir = path.join(projectDir, encodeSegment(id))
      fs.mkdirSync(dir, { recursive: true })
      if (marker !== null) fs.writeFileSync(path.join(dir, marker), 'DUMMY')
      return dir
    },
    cleanup() {
      rmrf(base)
    },
  }
}
