export interface InterruptDeps {
  abort: () => void
  forkSession: () => { newId: string; copied: boolean }
  hasActiveTurn: () => boolean
  hasPendingApproval: () => boolean
  onForkFailure: (error: unknown) => void
}

export function makeInterruptTurn(deps: InterruptDeps): () => void {
  return () => {
    if (deps.hasPendingApproval()) return
    if (!deps.hasActiveTurn()) return
    deps.abort()
    try {
      deps.forkSession()
    } catch (e) {
      deps.onForkFailure(e)
    }
  }
}
