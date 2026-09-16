/**
 * The idempotent-delete rule both GC apply phases obey, implemented once.
 *
 * ENOENT during a delete counts as removed — the file is already gone, and gone is what removal
 * means — while any other error is collected as an `id: message` string and the sweep continues.
 * That error shape is a contract: both sweeps report through it and their callers parse it.
 *
 * Extracted from `runSessionGC` (per-session) and `runSessionGCAllProjects` (all projects), which
 * carried the rule as two verbatim loops: a change to either — tolerating another code, changing
 * the message shape — had to be found twice, and the 2026-09-10 architecture review measured that
 * as a DRY violation. One implementation is what makes the semantics one fact.
 */
export async function removeTolerant(
  target: string,
  remove: () => Promise<void>,
  removed: string[],
  errors: string[],
): Promise<void> {
  try {
    await remove()
    removed.push(target)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      removed.push(target)
      return
    }
    errors.push(`${target}: ${(err as Error).message}`)
  }
}
