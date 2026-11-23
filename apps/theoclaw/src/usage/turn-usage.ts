import { formatUsd, usageFromRun } from '@theokit/agents/usage'

import type { TurnRun } from '../agent-port.js'

/** What one finished turn cost: exactly one of `costUsd` and `costUnpriced` is present (FR-002). */
export interface TurnUsage {
  readonly inputTokens: number
  readonly outputTokens: number
  readonly model: string
  readonly costUsd?: number
  readonly costUnpriced?: true
}

/** Where the turn came from, as the usage line names it. */
export type UsageSurface = 'channel' | 'control' | 'webchat'

/** A conversation's footer, as `/usage` sets it; `off` adds none. */
export type UsageFooterMode = 'tokens' | 'cost' | 'full'

type RunResult = Pick<Awaited<ReturnType<TurnRun['wait']>>, 'usage' | 'cost'>

/**
 * The usage record of one finished run (plan D1), from the framework's `usageFromRun`: a finite
 * amount, 0 included, is a price; an absent, `null`, `NaN` or infinite one is unpriced, which must
 * never read as a free run.
 */
export function usageOf(result: RunResult, model: string): TurnUsage {
  const { tokens, costUsd, priced } = usageFromRun(result, { model })
  const base = { inputTokens: tokens.input, outputTokens: tokens.output, model }
  return priced ? { ...base, costUsd } : { ...base, costUnpriced: true }
}

function costText(usage: TurnUsage, unpriced: string): string {
  return usage.costUsd === undefined ? unpriced : `$${formatUsd(usage.costUsd)}`
}

/** The one process line a finished turn writes (FR-004); it carries counts and a model id only. */
export function formatUsageLine(surface: UsageSurface, usage: TurnUsage): string {
  const cost = costText(usage, 'unpriced')
  return `theoclaw: usage ${surface} ${usage.model} in=${usage.inputTokens} out=${usage.outputTokens} cost=${cost}`
}

/** The keys a final `done` frame carries for a finished turn (FR-003). */
export function usageFrameFields(usage: TurnUsage): Record<string, unknown> {
  const cost = usage.costUsd === undefined ? { costUnpriced: true } : { costUsd: usage.costUsd }
  return { usage: { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens }, model: usage.model, ...cost }
}

/** The footer `/usage` appends under a chat reply (FR-005). */
export function formatUsageFooter(mode: UsageFooterMode, usage: TurnUsage): string {
  const tokens = `${usage.inputTokens} in · ${usage.outputTokens} out`
  const cost = costText(usage, 'cost unpriced')
  if (mode === 'tokens') return `— ${tokens}`
  if (mode === 'cost') return `— ${cost}`
  return `— ${tokens} · ${cost} · ${usage.model}`
}
