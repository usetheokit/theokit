/**
 * M39 (ADR-0048) — the in-process thread→run registry.
 *
 * A thread is the existing `sessionId` (the SDK conversation key). This registry
 * tracks, per thread, the single ACTIVE run, a FIFO queue of follow-ups to
 * dispatch as continuations, and one-shot "next run" waiters (so a client can
 * subscribe to a thread before posting a message and attach when the run starts).
 *
 * Pure state only — it never starts a run or touches the transport. The route
 * layer owns dispatch: on `endRun` it receives the next queued follow-up (if any)
 * and starts the continuation over the M37 durable transport.
 *
 * Single-process contract (ADR-0048 D2): a multi-instance deploy needs a shared
 * registry + leasing — that is infra (TheoCloud), explicitly out of M39. The
 * interface is injectable so a durable impl slots in later without touching the
 * routes. We do NOT build a distributed store now (YAGNI).
 */

/** A follow-up message queued on an active thread, dispatched as a continuation. */
export interface FollowUp {
  readonly message: string
}

export interface ThreadRunRegistry {
  /** The active runId for a thread, or `null` when the thread is idle. */
  getActive(sessionId: string): string | null
  /** Mark a run started for a thread (sets it active; fires + clears one-shot waiters). */
  startRun(sessionId: string, runId: string): void
  /**
   * Mark `runId` ended for a thread. A no-op unless `runId` is the current active
   * run (a stale terminal never clears a newer run). Clears the active run and
   * returns the next FIFO follow-up to dispatch as a continuation, or `undefined`.
   */
  endRun(sessionId: string, runId: string): FollowUp | undefined
  /** FIFO-enqueue a follow-up on a thread (dispatched when the active run ends). */
  queue(sessionId: string, followUp: FollowUp): void
  /**
   * Register a ONE-SHOT waiter fired with the runId of the NEXT run started on
   * this thread. Returns an unsubscribe fn. Used by subscribe-by-thread on an
   * idle thread (attach when the next run starts).
   */
  onNextRun(sessionId: string, cb: (runId: string) => void): () => void
}

interface ThreadState {
  activeRunId: string | null
  readonly queue: FollowUp[]
  readonly waiters: Set<(runId: string) => void>
}

export function createInProcessThreadRunRegistry(): ThreadRunRegistry {
  const threads = new Map<string, ThreadState>()
  const ensure = (sessionId: string): ThreadState => {
    let s = threads.get(sessionId)
    if (s === undefined) {
      s = { activeRunId: null, queue: [], waiters: new Set() }
      threads.set(sessionId, s)
    }
    return s
  }

  return {
    getActive(sessionId) {
      return threads.get(sessionId)?.activeRunId ?? null
    },
    startRun(sessionId, runId) {
      const s = ensure(sessionId)
      s.activeRunId = runId
      // Fire one-shot waiters, then clear them (single-threaded → no re-entrancy race).
      const waiters = [...s.waiters]
      s.waiters.clear()
      for (const cb of waiters) cb(runId)
    },
    endRun(sessionId, runId) {
      const s = threads.get(sessionId)
      if (s?.activeRunId !== runId) return undefined
      s.activeRunId = null
      return s.queue.shift()
    },
    queue(sessionId, followUp) {
      ensure(sessionId).queue.push(followUp)
    },
    onNextRun(sessionId, cb) {
      const s = ensure(sessionId)
      s.waiters.add(cb)
      return () => {
        s.waiters.delete(cb)
      }
    },
  }
}

let serverRegistry: ThreadRunRegistry | undefined

/** Process-wide singleton (mirrors `getRunEventCache` / `getApprovalRegistry`). */
export function getThreadRunRegistry(): ThreadRunRegistry {
  serverRegistry ??= createInProcessThreadRunRegistry()
  return serverRegistry
}
