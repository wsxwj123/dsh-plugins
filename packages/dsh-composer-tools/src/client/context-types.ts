/**
 * Structural types for the cordis client services this plugin consumes, plus
 * the Context augmentation. A third-party plugin resolves outside the DSH
 * monorepo's single cordis instance, so the upstream `declare module 'cordis'`
 * augmentations do not reach this Context. The members below mirror the actual
 * runtime shapes this plugin touches (read-only faces), taken from the
 * dsh-client-runtime sources (see BUILD notes in PLAN/INTERFACE).
 *
 * This file intentionally does NOT import any value from `@deepseek-ai/*`:
 * per the client-bundle purity gate, those are type-only / structural here.
 */
import type { Context as CordisContext } from 'cordis'

/** One entry in `sessions.list.byId` — a host session's metadata summary. */
export interface SessionSummary {
  id: string
  /** Raw stored title. Prefer `title ?? displayTitle` for the visible label. */
  title?: string
  /** Derived display title, present on every session (title } cwd-derived } id). */
  displayTitle: string
  /** Working directory label; used to resolve the instruction cwd on the host. */
  cwd: string
  /** A blank (New Session) row has no underlying session file. */
  blank?: boolean
  /** Whether the host agent for this session is actively running a turn. */
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
  clear(): void
}

/**
 * The client `slots` service face (SlotRegistry). Both surfaces used by this
 * plugin are declared here structurally to avoid depending on the installed
 * types of @deepseek-ai/dsh-client-runtime (which is a platform external).
 */
export interface SlotsFace {
  inject(
    key: string,
    cb: () => (() => void) | Iterable<() => void>,
  ): () => void
  register(
    options: {
      name: string
      id: string
      order?: number
    } & Record<string, unknown>,
    component: (props: any) => unknown,
  ): () => void
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
}

/**
 * The input state phase reported by the conversation composer's InputState
 * (`'plain' | 'adjudicating' | 'claimed' | 'submitting'`,
 * types/client/input/contract.d.ts). Only phase transitions drive the history
 * capture; `claimed` is the menu-arbitration intermediate and is ignored.
 */
export type InputPhase = 'plain' | 'adjudicating' | 'claimed' | 'submitting' | string

/**
 * The minimal conversation input state shape a `useInput` selector hook
 * returns for the members this plugin reads (draft + phase).
 */
export interface InputSelection {
  draft?: string
  currDraft?: string
  phase?: InputPhase
  [key: string]: unknown
}

/**
 * The conversation `inputActions` surface (the subset this plugin writes).
 * `setDraft(text)` is the single public draft write path
 * (types/client/input/contract.d.ts); the optional `EditRange` second arg is
 * accepted but never used here.
 */
export interface InputActions {
  setDraft(text: string): void
  [key: string]: unknown
}

/** Context augmentation for the services this plugin injects. */
export interface Context extends CordisContext {
  sessions: SessionsFace
  slots: SlotsFace
}
