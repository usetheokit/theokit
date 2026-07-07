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
// The timeout policy vocabulary is owned by the `@HumanInTheLoop` decorator (DRY / G12) — reuse it
// rather than re-declaring the union, so the two can never drift.
import type { TimeoutAction } from '@theokit/agents'

export type { TimeoutAction }

export interface RegisterOptions {
  /** Milliseconds before the approval auto-settles per `onTimeout`. */
  timeoutMs: number
  /**
   * What a timeout means. Only `'proceed'` auto-approves; `'abort'` and `'retry'` both deny — the
   * registry does NOT implement retry semantics (a timed-out `'retry'` is a deny, not a re-prompt).
   */
  onTimeout: TimeoutAction
  /** M14 — the gated tool name, surfaced by `list()` (optional; absent for legacy callers). */
  toolName?: string
  /** M14 — the approval question, surfaced by `list()` (optional). */
  question?: string
  /**
   * M20 — an optional JSON-schema descriptor of the custom payload the approver may attach. Carried
   * verbatim into `list()` + the `approval_required` event so the UI knows what to collect. Kept as
   * a plain JSON object (not a live Zod schema) so the registry stays serializable and SDK-free.
   */
  payloadSchema?: Record<string, unknown>
}

/**
 * M20 — a settled HITL decision. `approved` is the allow/deny bit (backward-compatible with the
 * legacy boolean); `reason` + `payload` are the optional approver-attached extras that surface to
 * the model (on denial, via the veto message) and to the app/UI.
 */
export interface ApprovalDecision {
  approved: boolean
  reason?: string
  payload?: unknown
}

/** M14 — a pending approval as surfaced by {@link ApprovalRegistry.list}. */
export interface PendingApproval {
  approvalId: string
  toolName?: string
  question?: string
  /** Epoch millis when the pending approval auto-settles (registeredAt + timeoutMs). */
  expiresAt: number
  /** M20 — the declared custom-payload schema, if the gated tool declares one. */
  payloadSchema?: Record<string, unknown>
}

export interface ApprovalRegistry {
  /**
   * Register a pending approval; the returned Promise settles with the full {@link ApprovalDecision}
   * on `resolve` or timeout (M20 — was a bare boolean pre-M20).
   */
  register(approvalId: string, opts: RegisterOptions): Promise<ApprovalDecision>
  /**
   * Settle a pending approval. Accepts a full {@link ApprovalDecision} OR a bare boolean (coerced to
   * `{ approved }` — backward-compatible). Returns false if the id is unknown or already settled.
   */
  resolve(approvalId: string, decision: boolean | ApprovalDecision): boolean
  /** M14 — list the currently-pending approvals (process-wide; single-process contract). */
  list(): PendingApproval[]
}

interface Pending {
  settle: (decision: ApprovalDecision) => void
  timer: ReturnType<typeof setTimeout>
  info: PendingApproval
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
      return new Promise<ApprovalDecision>((resolve) => {
        const settle = (decision: ApprovalDecision): void => {
          const entry = pending.get(approvalId)
          if (!entry) return
          clearTimeout(entry.timer)
          pending.delete(approvalId)
          resolve(decision)
        }
        // 'proceed' → allow on timeout; 'abort'/'retry' → deny on timeout.
        const timer = setTimeout(() => {
          settle({ approved: opts.onTimeout === 'proceed' })
        }, opts.timeoutMs)
        const info: PendingApproval = {
          approvalId,
          toolName: opts.toolName,
          question: opts.question,
          expiresAt: Date.now() + opts.timeoutMs,
          ...(opts.payloadSchema !== undefined ? { payloadSchema: opts.payloadSchema } : {}),
        }
        pending.set(approvalId, { settle, timer, info })
      })
    },
    resolve(approvalId, decision) {
      const entry = pending.get(approvalId)
      if (!entry) return false
      // M20 — coerce the legacy bare-boolean form to a decision object.
      entry.settle(typeof decision === 'boolean' ? { approved: decision } : decision)
      return true
    },
    list() {
      return [...pending.values()].map((p) => p.info)
    },
  }
}
