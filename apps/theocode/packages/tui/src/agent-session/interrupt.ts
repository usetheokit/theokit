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

export interface ForkGate {
  running: boolean
  /** An interrupt arrived while a fork was copying: run one more fork once it settles. */
  queued: boolean
}

export const newForkGate = (): ForkGate => ({ running: false, queued: false })

/**
 * `gate` is owned by the caller so it outlives this closure: the TUI rebuilds the handler on every
 * render. An interrupt during a running fork is queued, not dropped: that fork may be rejected as
 * stale by the very turn being interrupted, and the later turn still deserves its own fork.
 */
export function makeInterruptTurn(deps: InterruptDeps, gate: ForkGate = newForkGate()): () => void {
  const drain = async (): Promise<void> => {
    gate.running = true
    try {
      do {
        gate.queued = false
        try {
          await deps.forkSession()
        } catch (e) {
          deps.onForkFailure(e)
        }
      } while (gate.queued)
    } finally {
      gate.running = false
    }
  }
  return () => {
    if (deps.hasPendingApproval()) return
    if (!deps.hasActiveTurn()) return
    deps.abort()
    deps.onInterrupted()
    if (gate.running) {
      gate.queued = true
      return
    }
    void drain()
  }
}
