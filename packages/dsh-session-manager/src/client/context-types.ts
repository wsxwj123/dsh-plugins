/**
 * Structural types for the cordis client services this plugin consumes, plus
 * the Context augmentation. A third-party plugin resolves outside the DSH
 * monorepo's single cordis instance, so the upstream `declare module 'cordis'`
 * augmentations do not reach this Context. The members below mirror the actual
 * runtime shapes this plugin touches (read-only faces), taken verbatim from
 * the dsh-client-runtime sources (see BUILD notes in PLAN/INTERFACE).
 */
import type { Context as CordisContext } from 'cordis'

/** One entry in `sessions.list.byId` — a host session's metadata summary. */
export interface SessionSummary {
  id: string
  /** Raw stored title (matches the row's `.title` text for non-blank sessions). */
  displayTitle: string
  /** Working directory label; used to locate the session dir on the host. */
  cwd: string
  /** A blank (New Session) row has no underlying session file. */
  blank?: boolean
  /** Whether the session has a live host Session instance. */
  running?: boolean
  updatedAt?: number
  completed?: boolean
  origin?: string
}

/** The `sessions.list` SnapshotStore snapshot (the subset this plugin reads). */
export interface SessionListSnapshot {
  ids: string[]
  byId: Record<string, SessionSummary | undefined>
  current?: string
  phase: string
}

/** The sorted-observable face of `sessions.list`. */
export interface SessionListFeed {
  getSnapshot(): SessionListSnapshot
  subscribe(listener: () => void): () => void
}

/** The client `sessions` service face. */
export interface SessionsFace {
  list: SessionListFeed
  /** Clear the current selection → the no-session state (A-5). */
  clear(): void
}

/** The `workspaces.list` SnapshotStore snapshot (the subset this plugin reads). */
export interface WorkspacesListSnapshot {
  archivedSessionIds: string[]
  items: unknown[]
}

/** The sorted-observable face of `workspaces.list`. */
export interface WorkspacesListFeed {
  getSnapshot(): WorkspacesListSnapshot
  subscribe(listener: () => void): () => void
}

/** The client `workspaces` service face. */
export interface WorkspacesFace {
  list: WorkspacesListFeed
  /** Re-pull the host workspace list (archive-set fallback when the host
   *  broadcast is missed) — PLAN §5.1 risk 4 sub-state B. */
  refresh(): Promise<unknown>
}

/**
 * The client `slots` service face (SlotRegistry). Only the register surface is
 * touched; full typing lives in @deepseek-ai/dsh-client-runtime's client
 * augmentation and is intentionally kept structural here to avoid depending on
 * that package's installed types.
 */
export interface SlotsFace {
  register: (
    options: {
      name: string
      id: string
      order?: number
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } & Record<string, any>,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    component: (props: any) => unknown,
  ) => () => void
}

/** Context augmentation for the services this plugin injects. */
export interface Context extends CordisContext {
  sessions: SessionsFace
  workspaces: WorkspacesFace
  slots: SlotsFace
}
