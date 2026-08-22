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

import { processSingleton } from '../_internal/process-singleton.js'

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
   * Who the run belongs to — the `RouteSubject.id` admitted for it (B-016).
   *
   * Absent when the run had no identity to record, which is the `'public'` agent path:
   * `admitAgentRequest` deliberately does not resolve a subject when the policy is absent or
   * `'public'`, so there is nothing to attribute the approval to. Absent therefore means "no owner
   * was established", never "anyone", and the caller must branch on the difference — a rule that
   * refused when it is absent would start turning public agents away.
   *
   * Deliberately NOT surfaced by `list()`: that listing feeds a UI, and owner ids are identity.
   */
  owner?: string
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
  /**
   * Who owns the pending approval `approvalId`, or `undefined` (B-016).
   *
   * `undefined` covers three cases the caller treats identically — never registered, already
   * settled, and registered without an owner — because in all three there is nothing to compare a
   * caller against.
   */
  ownerOf(approvalId: string): string | undefined
}

interface Pending {
  settle: (decision: ApprovalDecision) => void
  timer: ReturnType<typeof setTimeout>
  info: PendingApproval
  /** Held beside `info` rather than inside it, so `list()` cannot leak it (B-016). */
  owner?: string
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
export function getApprovalRegistry(): ApprovalRegistry {
  // Per PROCESS, not per module instance (usetheokit/theokit#401). The paragraph above calls a
  // single instance "not a convenience but a correctness requirement", and a module-level `let`
  // does not deliver that: it gives one instance per MODULE INSTANCE, and this module is emitted
  // into two chunks of the published bundle. A run awaiting an approval and the route resolving it
  // could hold different objects, and the symptom would be a HITL pause that never resumes.
  return processSingleton('approval-registry', () => createInProcessApprovalRegistry())
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
        pending.set(approvalId, {
          settle,
          timer,
          info,
          ...(opts.owner !== undefined ? { owner: opts.owner } : {}),
        })
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
    ownerOf(approvalId) {
      // `settle` deletes the entry, so an approval that has been answered or timed out reports no
      // owner — which is what stops a later registration of the same id from inheriting one.
      return pending.get(approvalId)?.owner
    },
  }
}
