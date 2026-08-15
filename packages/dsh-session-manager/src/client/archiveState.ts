/**
 * archiveState — a tiny module-scope observable for the archive overlay's open
 * flag. The entry button (inside the sidebar.footer.action slot) and the
 * overlay (a body-append root) are different React roots; sharing one module
 * store lets the button toggle the overlay without threading props across
 * several mount points.
 */
const listeners = new Set<() => void>()
let open = false

function notify(): void {
  for (const l of listeners) l()
}

export function getArchiveOpen(): boolean {
  return open
}

export function setArchiveOpen(v: boolean): void {
  if (open === v) return
  open = v
  notify()
}

export function subscribeArchive(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}
