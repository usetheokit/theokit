/**
 * M4 (theokit-ai-first) — the in-process HITL approval registry.
 *
 * The HITL plugin's `awaitApproval` calls `register(approvalId)` and awaits the returned Promise
 * (this is what genuinely PAUSES the SDK run — the SDK `pre_tool_call` hook is awaited). The
 * approve route calls `resolve(approvalId, approved)` to settle it. A per-approval timeout settles
 * the Promise deterministically per the `@HumanInTheLoop` `onTimeout` policy so a hung approval
 * never leaks the paused stream.
 *
 * Single-process contract (ADR 0038 / plan Drawback 2): a multi-instance deploy needs a shared
 * registry — the interface is injectable so a durable impl (Redis, etc.) slots in without touching
 * the harness. We do NOT build a durable store now (YAGNI).
 */
export type TimeoutAction = 'abort' | 'proceed' | 'retry'

export interface RegisterOptions {
  /** Milliseconds before the approval auto-settles per `onTimeout`. */
  timeoutMs: number
  /** What a timeout means: 'abort'/'retry' → deny (false); 'proceed' → approve (true). */
  onTimeout: TimeoutAction
}

export interface ApprovalRegistry {
  /** Register a pending approval; the returned Promise settles on `resolve` or timeout. */
  register(approvalId: string, opts: RegisterOptions): Promise<boolean>
  /** Settle a pending approval. Returns false if the id is unknown or already settled. */
  resolve(approvalId: string, approved: boolean): boolean
}

interface Pending {
  settle: (approved: boolean) => void
  timer: ReturnType<typeof setTimeout>
}

/**
 * The one process-wide registry the stream mount (`mountAgent`) and the approve route share.
 *
 * The in-process impl holds LIVE Promise resolvers in memory — the approval a request awaits and
 * the approval the route resolves MUST be the same object, so a single instance per process is not
 * a convenience but a correctness requirement. Lazily created; a durable/multi-instance deploy
 * swaps this accessor for a shared-store impl (ADR 0038 / plan Drawback 2) without touching callers.
 * Tests use {@link createInProcessApprovalRegistry} directly — never this singleton.
 */
let serverRegistry: ApprovalRegistry | undefined
export function getApprovalRegistry(): ApprovalRegistry {
  serverRegistry ??= createInProcessApprovalRegistry()
  return serverRegistry
}

export function createInProcessApprovalRegistry(): ApprovalRegistry {
  const pending = new Map<string, Pending>()

  return {
    register(approvalId, opts) {
      return new Promise<boolean>((resolve) => {
        const settle = (approved: boolean): void => {
          const entry = pending.get(approvalId)
          if (!entry) return
          clearTimeout(entry.timer)
          pending.delete(approvalId)
          resolve(approved)
        }
        // 'proceed' → allow on timeout; 'abort'/'retry' → deny on timeout.
        const timer = setTimeout(() => {
          settle(opts.onTimeout === 'proceed')
        }, opts.timeoutMs)
        pending.set(approvalId, { settle, timer })
      })
    },
    resolve(approvalId, approved) {
      const entry = pending.get(approvalId)
      if (!entry) return false
      entry.settle(approved)
      return true
    },
  }
}
