/**
 * Constants shared by the node half and the browser bundle. Kept in ONE module
 * so the two ends cannot drift (CODE-REVIEW S-4 / S-5) — the host enforces and
 * the client mirrors the same limits/names.
 */

/** Title length limit for /sm/delete (INTERFACE §3.1 invalid-title). */
export const MAX_TITLE_LEN = 256

/**
 * Storage-domain name that holds the workspace global object with the
 * `archivedSessionIds` archive set (INTERFACE §3.1/§3.4).
 */
export const WORKSPACE_DOMAIN = 'workspace'

/**
 * Marker code on a SUCCESSFUL /sm/delete whose session had nothing on disk to
 * move (live-but-never-persisted): the delete is effective, but the recycle bin
 * holds no entry for it. The client must remember such an id permanently —
 * reconciling the hidden-rows set against /sm/trash would otherwise un-hide it
 * and the row would come back (M5 ghost row).
 */
export const NO_TRASH_ARTIFACT = 'no-trash-artifact'
