import type { UsageRecord } from './usage-types.js'

/** The slice of a run's `wait()` result that {@link usageFromRun} reads. */
export interface RunUsageSource {
  usage?: {
    inputTokens?: number
    outputTokens?: number
    cacheReadTokens?: number
    cacheWriteTokens?: number
  }
  cost?: { amountUsd?: number | null }
}

export interface UsageFromRunContext {
  model: string
  userId?: string
  now?: () => Date
}

const count = (value: number | undefined): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : 0

/**
 * Derive a {@link UsageRecord} from a run result.
 *
 * `priced` is `true` only when `cost.amountUsd` is a finite number (`0` included: a free run is
 * priced). Absent, `null`, `NaN` and infinite amounts give `priced: false` with `costUsd: 0`, so a
 * model without a catalog price is not mistaken for a free run. A token count the SDK omitted is `0`;
 * cache counts stay absent when not reported.
 */
export function usageFromRun(
  result: RunUsageSource,
  context: UsageFromRunContext,
): UsageRecord & { priced: boolean } {
  const amount = result.cost?.amountUsd
  const priced = typeof amount === 'number' && Number.isFinite(amount)
  const usage = result.usage
  const tokens: UsageRecord['tokens'] = {
    input: count(usage?.inputTokens),
    output: count(usage?.outputTokens),
  }
  if (typeof usage?.cacheReadTokens === 'number' && Number.isFinite(usage.cacheReadTokens)) {
    tokens.cacheRead = usage.cacheReadTokens
  }
  if (typeof usage?.cacheWriteTokens === 'number' && Number.isFinite(usage.cacheWriteTokens)) {
    tokens.cacheWrite = usage.cacheWriteTokens
  }
  return {
    ...(context.userId === undefined ? {} : { userId: context.userId }),
    model: context.model,
    tokens,
    costUsd: priced ? amount : 0,
    priced,
    timestamp: (context.now ?? (() => new Date()))(),
  }
}

/**
 * Format a USD amount with six significant digits and trailing zeros trimmed. Never uses an
 * exponent, and prints `0` only for `0`: a cost below a millionth prints its digits.
 */
export function formatUsd(amount: number): string {
  if (!Number.isFinite(amount)) return String(amount)
  if (amount === 0) return '0'
  const magnitude = Math.floor(Math.log10(Math.abs(amount)))
  const decimals = Math.min(100, Math.max(0, 5 - magnitude))
  const fixed = amount.toFixed(decimals)
  if (!fixed.includes('.')) return fixed
  let end = fixed.length
  while (fixed[end - 1] === '0') end -= 1
  if (fixed[end - 1] === '.') end -= 1
  return fixed.slice(0, end)
}
