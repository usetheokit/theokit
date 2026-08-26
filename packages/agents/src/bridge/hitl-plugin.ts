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
import type { HumanInTheLoopOptions } from '../types.js'

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
interface HitlPlugin {
  name: string
  /** SDK `BasePlugin.version` — required by the `@theokit/sdk` Plugin contract. */
  version: string
  /**
   * SDK Plugin discriminator. MUST be `'general'` — the SDK's `isCodePlugin()` gate drops any plugin
   * object lacking `kind: 'general'`, so a `register()`-only object never fires (the HITL veto would
   * silently NOT pause the run). Regression guard for the M14 latent E2E bug.
   */
  kind: 'general'
  register(ctx: PluginContext): void
}

/**
 * M20 — a settled HITL decision. Structural mirror of the harness's `ApprovalDecision` (the agents
 * package must not import from `theokit` — dependency direction). `awaitApproval` may resolve a bare
 * boolean (legacy) OR this object; the plugin normalizes both.
 */
export interface HitlDecision {
  approved: boolean
  reason?: string
  payload?: unknown
  /**
   * What settled this, when it was not a person (usetheokit/theokit#393).
   *
   * Mirrors `ApprovalDecision.settledBy` in `theokit`, for the reason the comment above this
   * interface gives: this package must not import from `theokit`. Absent means the decision came
   * through the approve route; `'timeout'` means the window closed with nobody deciding.
   */
  settledBy?: 'timeout'
}

/** Injected wiring — the harness (mount-agent) supplies these; the plugin stays pure. */
export interface HitlWiring {
  /** Tool name → its `@HumanInTheLoop` config. A tool absent here is NOT gated. */
  gated: Map<string, HumanInTheLoopOptions>
  /** Push the approval-required event into the agent stream (the translator emits the chunk). */
  emit: (event: ApprovalRequiredEvent) => void
  /**
   * Await the human decision for `approvalId`; resolves approve/deny (or timeout). M20 — may resolve
   * a bare boolean (legacy) OR a {@link HitlDecision} carrying an approver `reason` + `payload`.
   */
  awaitApproval: (
    approvalId: string,
    opts: HumanInTheLoopOptions,
    toolName: string,
  ) => Promise<boolean | HitlDecision>
  /**
   * OPTIONAL — reach the owner off the stream (usetheokit/theokit#458).
   *
   * `emit` above puts the pause into the run's own event stream, and that was the only egress: a
   * caller not currently consuming it never learned the run was waiting, so the framework's
   * asynchronous promise held exactly as long as someone was watching.
   *
   * This receives the same facts the stream carries and does whatever the APPLICATION does — Slack,
   * email, a row in a table. Deliberately not a `@theokit/gateway` dependency: this package must not
   * import from it, and picking a channel is a policy decision the framework does not get to make.
   *
   * Fire-and-forget by contract. The run does not wait for it and does not fail on it: a dispatch
   * outage must not decide whether a gated tool runs, and must not delay the pause it announces.
   */
  onApprovalRequired?: (request: ApprovalRequest) => void | Promise<void>
}

/** What an application is told when a gated tool pauses. The stream's facts, off the stream. */
export interface ApprovalRequest {
  approvalId: string
  toolName: string
  question: string
  input: unknown
  /** Relative, exactly as the stream carries it — the app knows its own base URL; this does not. */
  callbackUrl: string
  timeoutMs: number
}

/**
 * Build the HITL `pre_tool_call` plugin. Gated tools pause for approval; others pass through.
 * The returned object is a `@theokit/sdk` `Plugin` (structural — `definePlugin` is an identity).
 */
export function createHitlPlugin(wiring: HitlWiring): HitlPlugin {
  return {
    name: 'theokit-hitl',
    version: '1.0.0',
    // `kind: 'general'` is load-bearing — without it the SDK's isCodePlugin() drops this plugin and
    // the HITL veto never fires (the run would proceed WITHOUT waiting for human approval).
    kind: 'general',
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
          // M20 — carry the declared custom-payload schema so the UI knows what to collect.
          ...(opts.payloadSchema !== undefined ? { payloadSchema: opts.payloadSchema } : {}),
        })
        // Announced AFTER the stream and BEFORE the await, without blocking either. A rejected
        // promise here is swallowed on purpose: see `onApprovalRequired` for why a dispatch failure
        // must not become the agent's decision.
        if (wiring.onApprovalRequired !== undefined) {
          void (async () => {
            try {
              await wiring.onApprovalRequired?.({
                approvalId,
                toolName: c.name,
                question: opts.question,
                input: c.args,
                callbackUrl: `approve/${approvalId}`,
                timeoutMs: opts.timeout ?? 300_000,
              })
            } catch {
              // Intentionally ignored — the run's outcome belongs to the human, not to the channel.
            }
          })()
        }

        const raw = await wiring.awaitApproval(approvalId, opts, c.name)
        // M20 — normalize the legacy boolean and the decision object to one shape.
        const decision: HitlDecision = typeof raw === 'boolean' ? { approved: raw } : raw
        if (decision.approved) return undefined
        // On denial, surface the approver's reason + payload to the model so it can self-correct.
        //
        // An expiry is NOT a denial by a person, and saying so was #393: both produced
        // `Tool 'x' denied by human approver`, so an operator auditing a gated action could not
        // tell "a reviewer refused this" from "nobody was watching and the window closed" — the
        // one distinction a HITL gate exists to record. The registry's `reason` already names the
        // budget and which `onTimeout` applied; this only has to stop inventing the actor and
        // point at the knob.
        let message =
          decision.settledBy === 'timeout'
            ? `Tool '${c.name}' was not approved: ${decision.reason ?? 'the approval window expired with no decision'}. ` +
              `Decide within the window, or raise 'timeout' on the tool's approval options.`
            : `Tool '${c.name}' denied by human approver`
        if (decision.settledBy !== 'timeout' && decision.reason) message += `: ${decision.reason}`
        if (decision.payload !== undefined) {
          message += ` (payload: ${JSON.stringify(decision.payload)})`
        }
        return { block: true, message }
      })
    },
  }
}
