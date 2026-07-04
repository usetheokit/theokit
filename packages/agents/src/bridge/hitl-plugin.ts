/**
 * M4 (theokit-ai-first) — the HITL producer: a `pre_tool_call` plugin that pauses the SDK run
 * for a human-in-the-loop tool approval.
 *
 * ADR 0038: this is the ADAPTER seam — it makes the shipped-but-dead `@HumanInTheLoop` decorator
 * FUNCTIONAL by wiring the SDK's OWN async `pre_tool_call` veto hook (which the SDK loop `await`s,
 * so returning a pending Promise genuinely PAUSES the run) to a human approval. It calls no LLM,
 * dispatches no tool, and runs no second loop — the SDK owns all of that.
 *
 * Flow: gated tool about to run → emit an `ApprovalRequiredEvent` (which the translator maps to
 * the ai-sdk `tool-approval-request` chunk) → `await awaitApproval(approvalId)` (resolved by the
 * out-of-band approve route) → allow (`undefined`) or veto (`{ block, message }`, which the SDK
 * surfaces as a tool result the model self-corrects on).
 */
import type { HumanInTheLoopOptions } from '../decorators/human-in-the-loop.js'

import type { ApprovalRequiredEvent } from './agent-stream-events.js'

/** Minimal shapes mirrored from `@theokit/sdk` (type-only — no runtime import, keeps the SDK peer optional). */
interface PreToolCallContext {
  name: string
  args: Record<string, unknown>
  agentId: string
  runId: string
}
interface PreToolCallVeto {
  block: true
  message: string
}
interface PluginContext {
  on(hook: string, handler: (ctx: PreToolCallContext) => unknown): void
}
export interface HitlPlugin {
  name: string
  register(ctx: PluginContext): void
}

/** Injected wiring — the harness (mount-agent) supplies these; the plugin stays pure. */
export interface HitlWiring {
  /** Tool name → its `@HumanInTheLoop` config. A tool absent here is NOT gated. */
  gated: Map<string, HumanInTheLoopOptions>
  /** Push the approval-required event into the agent stream (the translator emits the chunk). */
  emit: (event: ApprovalRequiredEvent) => void
  /** Await the human decision for `approvalId`; resolves true=approve, false=deny (or timeout). */
  awaitApproval: (approvalId: string, opts: HumanInTheLoopOptions) => Promise<boolean>
}

/**
 * Build the HITL `pre_tool_call` plugin. Gated tools pause for approval; others pass through.
 * The returned object is a `@theokit/sdk` `Plugin` (structural — `definePlugin` is an identity).
 */
export function createHitlPlugin(wiring: HitlWiring): HitlPlugin {
  return {
    name: 'theokit-hitl',
    register(ctx) {
      ctx.on('pre_tool_call', async (c): Promise<PreToolCallVeto | undefined> => {
        const opts = wiring.gated.get(c.name)
        if (!opts) return undefined // not gated — allow
        const approvalId = crypto.randomUUID()
        wiring.emit({
          type: 'approval_required',
          callId: approvalId,
          toolName: c.name,
          question: opts.question,
          input: c.args,
          callbackUrl: `approve/${approvalId}`,
          timeoutMs: opts.timeout ?? 300_000,
        })
        const approved = await wiring.awaitApproval(approvalId, opts)
        return approved
          ? undefined
          : { block: true, message: `Tool '${c.name}' denied by human approver` }
      })
    },
  }
}
