/**
 * What `@theokit/agents` adds to a tool handler's `ctx`, and why it adds it here.
 *
 * Its own module for the reason `model-selection.ts` and `sdk-error.ts` give: `sdk-adapter.ts` sits
 * under a 500-line ceiling, and this is a cohesive concern with a name — the SDK's `ToolContext` is
 * whatever the SDK decides, and this is the theokit half of it.
 *
 * The half exists because the SDK does not forward what it does not know about. `ctx.context` (M7)
 * is theokit's run-context, and `ctx.usage` (theokit#475) is theokit's reading of the run's real
 * token usage; both are injected at the ADAPTER layer, which is why they reach a handler even when
 * the SDK passes no ctx at all.
 */
import type { CustomTool } from '@theokit/sdk'

import type { RunUsageMeter } from '../usage/run-usage.js'

/** What this layer adds to a tool handler's `ctx` beyond what the SDK hands it. */
export interface ToolContextInjection {
  /** M7 — the run-context, when the run has one. */
  readonly runContext?: { value: unknown }
  /** theokit#475 — the live usage meter, when the run opted into exposing usage to tools. */
  readonly meter?: RunUsageMeter
}

/**
 * M7 — wrap a tool handler so it receives the run-context as `ctx.context`, injected from a closure
 * over `runContext`. theokit owns the run-context concern (the `defineAgent({ context })` /
 * `AgentBuilder.create().context()` API is theokit's), so it injects it at THIS adapter layer instead of relying
 * on the SDK to forward it — decoupling the framework from the SDK's tool-call internals. The
 * incoming `ctx.signal` (from the SDK) is preserved; `context` is set to the agent's run-context.
 *
 * theokit#475 — `ctx.usage` arrives the same way and for the same reason: the SDK does not forward
 * what it does not know about, and the number a tool needs is one this layer holds. The snapshot is
 * taken at INVOCATION time, not at wrap time, so a tool called on the fourth iteration reads the
 * fourth iteration's total rather than a value frozen before the turn began.
 */
export function withInjectedToolContext(
  handler: CustomTool['handler'],
  injection: ToolContextInjection,
): CustomTool['handler'] {
  // Forward the FULL ctx (SE12 `messages` transcript projection + `signal` + any future
  // field) and override ONLY what this layer owns. Dropping `messages` here would
  // silently break a tool that reads the turn transcript — so spread, don't cherry-pick.
  //
  // `usage` is a field the SDK's `ToolContext` does not declare. It survives because a spread
  // suspends excess-property checking, which is the same reason a handler cannot READ it without
  // help — hence `readRunUsage`, the typed door back in, rather than a cast in every consumer.
  return (input, ctx) =>
    handler(input, {
      ...ctx,
      ...(injection.runContext !== undefined ? { context: injection.runContext.value } : {}),
      ...(injection.meter !== undefined ? { usage: injection.meter.snapshot() } : {}),
    })
}
