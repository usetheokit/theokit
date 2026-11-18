export interface InterruptDeps {
  abort: () => void
  forkSession: () =>
    | { newId: string; copied: boolean }
    | Promise<{ newId: string; copied: boolean }>
  hasActiveTurn: () => boolean
  hasPendingApproval: () => boolean
  onForkFailure: (error: unknown) => void
  /** #948: records which message was cut, so the transcript can say so. */
  onInterrupted: () => void
}

/**
 * `inFlight` is owned by the caller so it outlives this closure: the TUI rebuilds the handler on
 * every render, and a per-closure flag would reset while a fork is still copying.
 */
export function makeInterruptTurn(
  deps: InterruptDeps,
  inFlight: { current: boolean } = { current: false },
): () => void {
  return () => {
    if (deps.hasPendingApproval()) return
    if (!deps.hasActiveTurn()) return
    deps.abort()
    deps.onInterrupted()
    if (inFlight.current) return
    inFlight.current = true
    void (async () => {
      try {
        await deps.forkSession()
      } catch (e) {
        deps.onForkFailure(e)
      } finally {
        inFlight.current = false
      }
    })()
  }
}
