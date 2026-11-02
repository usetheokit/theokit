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

const SIGNIFICANT_DIGITS = 6

type RunResult = Pick<Awaited<ReturnType<TurnRun['wait']>>, 'usage' | 'cost'>

/** A count the SDK omitted, or reported as something other than a finite number, is 0. */
function count(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

/**
 * The usage record of one finished run (plan D1). A finite amount, 0 included, is a price; an
 * absent, `null`, `NaN` or infinite one is unpriced, which must never read as a free run.
 */
export function usageOf(result: RunResult, model: string): TurnUsage {
  const amount: unknown = result.cost?.amountUsd
  const tokens = { inputTokens: count(result.usage?.inputTokens), outputTokens: count(result.usage?.outputTokens), model }
  return typeof amount === 'number' && Number.isFinite(amount) ? { ...tokens, costUsd: amount } : { ...tokens, costUnpriced: true }
}

/**
 * Six significant digits with trailing zeros trimmed, so a cost below a millionth prints its
 * digits instead of reading as 0 (EC-4). `toFixed` takes at most 100 decimals and prints an
 * exponent from 1e21 up; no run costs less than 1e-100 or more than 1e21 USD.
 */
function formatAmount(amount: number): string {
  const rounded = Number(amount.toPrecision(SIGNIFICANT_DIGITS))
  if (rounded === 0) return '0'
  const decimals = SIGNIFICANT_DIGITS - 1 - Math.floor(Math.log10(Math.abs(rounded)))
  const fixed = rounded.toFixed(Math.min(Math.max(decimals, 0), 100))
  return fixed.includes('.') ? fixed.replace(/0+$/, '').replace(/\.$/, '') : fixed
}

function costText(usage: TurnUsage, unpriced: string): string {
  return usage.costUsd === undefined ? unpriced : `$${formatAmount(usage.costUsd)}`
}

/** The one process line a finished turn writes (FR-004); it carries counts and a model id only. */
export function formatUsageLine(surface: UsageSurface, usage: TurnUsage): string {
  const cost = costText(usage, 'unpriced')
  return `theoclaw: usage ${surface} ${usage.model} in=${usage.inputTokens} out=${usage.outputTokens} cost=${cost}`
}

/** The footer `/usage` appends under a chat reply (FR-005). */
export function formatUsageFooter(mode: UsageFooterMode, usage: TurnUsage): string {
  const tokens = `${usage.inputTokens} in · ${usage.outputTokens} out`
  const cost = costText(usage, 'cost unpriced')
  if (mode === 'tokens') return `— ${tokens}`
  if (mode === 'cost') return `— ${cost}`
  return `— ${tokens} · ${cost} · ${usage.model}`
}
