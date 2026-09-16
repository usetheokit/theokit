/**
 * B-013 — run a background write to completion, reporting failure instead of crashing.
 *
 * B-031 — this said "the two persistence calls" and there were FIVE; see `session-store.ts` for
 * why the guarantee moved to the exported function rather than to its call sites.
 *
 * The persistence calls that use this were fired with a bare `void`. `enqueue` attaches its
 * `catch` to the tail it stores, not to the promise it returns, so a rejection arrived at the `void`
 * with no handler at all. `atomicWriteText` does reject (ENOSPC, EACCES, EROFS, EXDEV) and the
 * declared engine is `node >=22`, where the default is `--unhandled-rejections=throw`: a failed
 * pointer write would have terminated the TUI.
 *
 * Both extremes are wrong. Killing the session because a pointer could not be written is
 * disproportionate — the session still works, it just will not be resumable. Swallowing it is
 * Unbreakable Rule 8. So the write degrades, and says so on the diagnostic channel the TUI already
 * routes to `.theokit/tui-stderr.log`.
 */
export function fireAndForget(
  work: Promise<unknown>,
  what: string,
  report: (message: string) => void = (message) => process.stderr.write(`${message}\n`),
): Promise<void> {
  return work.then(
    () => undefined,
    (err: unknown) => {
      const detail = err instanceof Error ? err.message : String(err)
      report(`[theocode] could not persist ${what}: ${detail}`)
    },
  )
}
