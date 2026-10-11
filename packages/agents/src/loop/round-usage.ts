/**
 * What one round of the reflective loop cost, read from its `done` event, and how that folds into
 * the run's {@link DelegationResult} (V4-N: cost and total/split tokens; V4-O: the reasoning and
 * cache buckets; B-409: whether the cost is known).
 *
 * Kept out of `run-reflective-loop.ts`, which is at its file-size budget: the fold is a table over
 * the usage fields and does not depend on how a round is driven.
 */
import type { StreamEvent } from '../bridge/agent-sse-handler.js'
import type { DelegationResult } from '../bridge/delegation-types.js'

/** The usage a round reports; every field starts at 0 and `costKnown` at false. */
export interface RoundUsage {
  cost: number
  /** B-409: false until a `done` reports a finite cost; an unpriced round folds as 0 into `cost`. */
  costKnown: boolean
  tokens: number
  tokensInput: number
  tokensOutput: number
  reasoningTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
}

/** The token buckets a round adds to the run, each optional on {@link DelegationResult}. */
const TOKEN_BUCKETS = [
  'tokensInput',
  'tokensOutput',
  'reasoningTokens',
  'cacheReadTokens',
  'cacheWriteTokens',
] as const

/**
 * Each round field a `done` event's usage sets, beside the usage key it reads. A key the
 * provider or adapter omits sets the field to 0.
 */
const DONE_USAGE_FIELDS = [
  ['tokens', 'totalTokens'],
  ['tokensInput', 'inputTokens'],
  ['tokensOutput', 'outputTokens'],
  ['reasoningTokens', 'reasoningTokens'],
  ['cacheReadTokens', 'cacheReadTokens'],
  ['cacheWriteTokens', 'cacheWriteTokens'],
] as const

/** The usage a `done` event carries; every key optional, and absent means 0. */
interface DoneUsage {
  totalTokens?: number
  inputTokens?: number
  outputTokens?: number
  reasoningTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
}

/** Fold a `done` event's cost and token usage into the round. */
export function applyDone(event: StreamEvent, r: RoundUsage): void {
  r.costKnown = typeof event.cost === 'number' && Number.isFinite(event.cost)
  r.cost = r.costKnown ? (event.cost as number) : 0 // EC-2: NaN/Infinity never reach the spend
  const usage = (event.usage ?? {}) as DoneUsage
  for (const [field, key] of DONE_USAGE_FIELDS) r[field] = usage[key] ?? 0
}

/**
 * Fold one round's usage into the run; the optional `acc` fields default to 0 before adding.
 *
 * B-409: an unpriced round adds 0 to `cost`, which stays the known spend the ceiling reads, and
 * marks the run `costUnknown` so the result does not report that spend as the run's price.
 */
export function accumulateUsage(acc: DelegationResult, r: RoundUsage): void {
  acc.cost += r.cost
  if (!r.costKnown) acc.costUnknown = true
  acc.tokens += r.tokens
  for (const bucket of TOKEN_BUCKETS) acc[bucket] = (acc[bucket] ?? 0) + r[bucket]
}
