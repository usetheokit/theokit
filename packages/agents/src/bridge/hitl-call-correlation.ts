/**
 * usetheokit/theokit#361 — one logical tool call, one id on the wire.
 *
 * ## The measured defect
 *
 * A HITL-gated tool crossed the wire TWICE, under two ids. The approval id is minted by
 * `createHitlPlugin` (`hitl-plugin.ts`) because the SDK's `pre_tool_call` context carries `name`,
 * `args`, `agentId` and `runId` and no tool-call id at all — measured against `@theokit/sdk@4.52.1`,
 * whose `vetoFromPluginPreHook` builds that context by hand. The runtime id is minted by the SDK's
 * own `dispatchSingleCall`. Neither producer can adopt the other's id, so the two ids are a fact and
 * the correlation has to happen where both are visible.
 *
 * The consequences were not only telemetry. A consumer counting tool calls counted two, a UI
 * grouping blocks by `toolCallId` rendered two cards for one call, and a pause span opened on the
 * approval id was never closed by a result arriving under the runtime id — so its duration
 * approximated the whole run instead of the human's wait.
 *
 * ## Why the ids are paired by tool name, and why order does not decide the answer
 *
 * The pairing key is the tool NAME, because it is the only field both producers carry. That is safe
 * because the gate PAUSES the run inside the SDK's awaited hook: an approval is outstanding only
 * while the call it gates is outstanding. Where the SDK dispatches several calls of the same gated
 * name concurrently, the pairing is FIFO — the SDK starts them in order and the plugin fires in the
 * same order, so the k-th approval belongs to the k-th call.
 *
 * Which id wins is decided by which side reached the wire first, not by a preference. Measured, the
 * approval usually wins: the SDK pushes its `tool_call` (`status: running`) message to the timeline
 * BEFORE awaiting the hook, but that message travels through the translator and the merge queue
 * while the plugin's `emit` pushes into that queue directly. Relying on either order would be
 * relying on microtask scheduling, so this correlates both ways instead:
 *
 * - approval first → the approval id is announced; the runtime call folds into it (`already-announced`)
 * - runtime call first → the approval chunk names the runtime id as its `toolCallId`
 *
 * Either way the `tool-approval-request` chunk keeps carrying the approval id in `approvalId`, so
 * the `approve/${approvalId}` callback URL the plugin published stays valid. The chunk was always
 * shaped for this: `approvalId` is the handle a human answers with, `toolCallId` is the call it gates.
 */

/** What the translator must do with an SDK tool call whose logical call may already be on the wire. */
export type ToolCallDisposition =
  /** Not seen before under any other id — emit it. */
  | 'announce'
  /** An approval already announced this logical call — emitting again would double it. */
  | 'already-announced'

/** Take the oldest id queued for `toolName`, dropping the queue once it empties. */
function claim(queues: Map<string, string[]>, toolName: string): string | undefined {
  const queue = queues.get(toolName)
  if (queue === undefined) return undefined
  const claimed = queue.shift()
  if (queue.length === 0) queues.delete(toolName)
  return claimed
}

/** Queue `id` under `toolName`, waiting for the other side of the pair. */
function enqueue(queues: Map<string, string[]>, toolName: string, id: string): void {
  const queue = queues.get(toolName)
  if (queue === undefined) queues.set(toolName, [id])
  else queue.push(id)
}

/** Forget a queued id — its call ended without an approval ever claiming it. */
function forget(queues: Map<string, string[]>, toolName: string, id: string): void {
  const queue = queues.get(toolName)
  if (queue === undefined) return
  const at = queue.indexOf(id)
  if (at === -1) return
  queue.splice(at, 1)
  if (queue.length === 0) queues.delete(toolName)
}

/**
 * The approval id and the runtime tool-call id of one logical call, reduced to the single id the
 * wire uses. STATEFUL — one instance per stream, like the presenter it sits beside.
 */
export class HitlCallCorrelation {
  /** Tool name → runtime call ids announced on the wire, not yet claimed by an approval. */
  readonly #unclaimedCalls = new Map<string, string[]>()
  /** Tool name → approval ids announced on the wire, not yet claimed by a runtime call. */
  readonly #unclaimedApprovals = new Map<string, string[]>()
  /** Runtime call id → the id the wire already uses for the same logical call. */
  readonly #announcedAs = new Map<string, string>()

  /** Record a runtime tool call and say whether the wire has already announced it. */
  announceToolCall(toolName: string, callId: string): ToolCallDisposition {
    const announced = claim(this.#unclaimedApprovals, toolName)
    if (announced === undefined) {
      enqueue(this.#unclaimedCalls, toolName, callId)
      return 'announce'
    }
    this.#announcedAs.set(callId, announced)
    return 'already-announced'
  }

  /** The `toolCallId` an approval chunk must carry: the runtime id when known, else the approval id. */
  approvalToolCallId(toolName: string, approvalId: string): string {
    const announced = claim(this.#unclaimedCalls, toolName)
    if (announced !== undefined) return announced
    enqueue(this.#unclaimedApprovals, toolName, approvalId)
    return approvalId
  }

  /** The `toolCallId` a result must carry — the id its call was announced under. */
  resultToolCallId(toolName: string, callId: string): string {
    const announced = this.#announcedAs.get(callId)
    if (announced !== undefined) {
      this.#announcedAs.delete(callId)
      return announced
    }
    // Ungated, or gated and already paired: either way this call is over, so a LATER approval for
    // the same tool name must not pair with it.
    forget(this.#unclaimedCalls, toolName, callId)
    return callId
  }
}
