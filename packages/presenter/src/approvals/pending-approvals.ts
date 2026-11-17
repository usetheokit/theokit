import type { WireMessage, WireToolApproval } from '../wire/types.js'

/**
 * One outstanding HITL decision read off the wire thread.
 *
 * The list is plural because the SDK dispatches a round's calls concurrently, so two gated calls
 * of the same tool can be outstanding at once. A singular field would be silently wrong exactly
 * when a human has two things to decide.
 */
export interface PendingApproval {
  /** The id `approve()` settles. */
  readonly approvalId: string
  /** The call this gate holds — the same id `tool-input-available` announced. */
  readonly toolCallId: string
  /** The gated tool's name, off the part. `undefined` only if the producer announced none. */
  readonly toolName: string | undefined
  /** The resolved arguments the human is authorising, off the part. */
  readonly input: unknown
  /** The question declared on the gate, when the producer sent one. */
  readonly question?: string
  /** The window before the gate settles itself, in ms, when the producer sent one. */
  readonly timeoutMs?: number
}

const NO_PENDING_APPROVALS: PendingApproval[] = []

/**
 * One part as a pending approval, or `undefined` when it is not an approval request with a settle id.
 * Never falls back to `toolCallId`: a part without `approval.id` cannot be settled by `approve()`.
 */
export function readPendingApproval(part: unknown): PendingApproval | undefined {
  if (typeof part !== 'object' || part === null) return undefined
  const p = part as Record<string, unknown>
  if (p.state !== 'approval-requested') return undefined
  const approval = p.approval as Partial<WireToolApproval> | undefined
  if (typeof approval?.id !== 'string') return undefined
  return {
    approvalId: approval.id,
    toolCallId: String(p.toolCallId),
    toolName: typeof p.toolName === 'string' ? p.toolName : undefined,
    input: p.input,
    ...(approval.question !== undefined ? { question: approval.question } : {}),
    ...(approval.timeoutMs !== undefined ? { timeoutMs: approval.timeoutMs } : {}),
  }
}

/** Every outstanding approval across `messages`, in order. Returns one shared empty array when none. */
export function pendingApprovals(messages: readonly Pick<WireMessage, 'parts'>[]): PendingApproval[] {
  let pending: PendingApproval[] | undefined
  for (const message of messages) {
    for (const part of message.parts) {
      const entry = readPendingApproval(part)
      if (entry === undefined) continue
      pending ??= []
      pending.push(entry)
    }
  }
  return pending ?? NO_PENDING_APPROVALS
}
