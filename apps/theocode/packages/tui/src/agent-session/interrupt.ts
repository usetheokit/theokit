export interface InterruptDeps {
  abort: () => void
  forkSession: () =>
    { newId: string; copied: boolean } | Promise<{ newId: string; copied: boolean }>
  hasActiveTurn: () => boolean
  hasPendingApproval: () => boolean
  onForkFailure: (error: unknown) => void
  /** #948: records which message was cut, so the transcript can say so. */
  onInterrupted: () => void
}

export function makeInterruptTurn(deps: InterruptDeps): () => void {
  // One fork at a time: a second Esc while the copy is pending must not start another.
  let forking = false
  return () => {
    if (deps.hasPendingApproval()) return
    if (!deps.hasActiveTurn()) return
    deps.abort()
    deps.onInterrupted()
    if (forking) return
    forking = true
    void (async () => {
      try {
        await deps.forkSession()
      } catch (e) {
        deps.onForkFailure(e)
      } finally {
        forking = false
      }
    })()
  }
}
