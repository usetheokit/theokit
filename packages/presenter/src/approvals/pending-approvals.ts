import type { WireMessage, WireToolApproval } from '../wire/types.js'

/** One HITL decision a run is parked on, flattened for the surface that renders it. */
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

/** The one empty array returned whenever nothing is outstanding. */
const NONE: PendingApproval[] = []

/**
 * One part as a pending approval, or `undefined` when it is not an approval request with a settle id.
 *
 * A part in `approval-requested` without a string `approval.id` is skipped, never settled by its
 * `toolCallId`: `approve()` could not settle it.
 */
export function readPendingApproval(part: unknown): PendingApproval | undefined {
  if (typeof part !== 'object' || part === null) return undefined
  const p = part as Record<string, unknown>
  if (p.state !== 'approval-requested') return undefined
  const approval = p.approval as WireToolApproval | undefined | null
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
export function pendingApprovals(
  messages: readonly Pick<WireMessage, 'parts'>[],
): PendingApproval[] {
  let pending: PendingApproval[] | undefined
  for (const message of messages) {
    for (const part of message.parts) {
      const entry = readPendingApproval(part)
      if (entry === undefined) continue
      pending ??= []
      pending.push(entry)
    }
  }
  return pending ?? NONE
}
