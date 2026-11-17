export interface InterruptDeps {
  abort: () => void
  forkSession: () => { newId: string; copied: boolean }
  hasActiveTurn: () => boolean
  hasPendingApproval: () => boolean
  onForkFailure: (error: unknown) => void
  /** #948: records which message was cut, so the transcript can say so. */
  onInterrupted: () => void
}

export function makeInterruptTurn(deps: InterruptDeps): () => void {
  return () => {
    if (deps.hasPendingApproval()) return
    if (!deps.hasActiveTurn()) return
    deps.abort()
    deps.onInterrupted()
    try {
      deps.forkSession()
    } catch (e) {
      deps.onForkFailure(e)
    }
  }
}
