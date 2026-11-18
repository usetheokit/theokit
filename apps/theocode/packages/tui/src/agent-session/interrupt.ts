export interface InterruptDeps {
  abort: () => void
  forkSession: () => Promise<{ newId: string; copied: boolean }>
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
    // Fork runs in the background: the abort and the interrupted mark above are already done, and
    // a failure (sync or async) still reaches `onForkFailure`.
    void Promise.resolve()
      .then(() => deps.forkSession())
      .catch((e: unknown) => {
        deps.onForkFailure(e)
      })
  }
}
