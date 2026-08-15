// Imported from the SDK directly, not from this package's own barrel: these files now LIVE in
// `@theokit/agents`, so `from '@theokit/agents'` would be a package self-reference (and a cycle
// through `src/index.ts`). The barrel re-exports the same SDK symbols for consumers; inside the
// package we reach the source.
import { resolveEffectiveContextWindow } from '@theokit/sdk/compaction'
// These modules moved from `theokit` into `@theokit/agents`, and this package enforces an
// invariant the web package does not: no exported error class extends plain `Error`. A class
// outside the `TheokitAgentError` hierarchy is invisible to `isTransientError` and to any
// consumer catching `instanceof TheokitAgentError` — the exact defect U-11 measured across ten
// classes. `tests/unit/error-taxonomy.test.ts` caught all three the moment they crossed the
// boundary, which is the guard working.
import { TheokitAgentError } from '@theokit/sdk/errors'

/**
 * M74 — context pressure: the fraction of the window a run has consumed.
 *
 * ## Why this had no counterpart
 *
 * The framework shipped the DENOMINATOR (`resolveEffectiveContextWindow`, crossed in M67) and the
 * NUMERATOR (token usage, on every `done` event) and never put them together. So every product that
 * wanted to warn a user before a run hit the wall computed the ratio itself, and each picked its own
 * thresholds.
 *
 * The arithmetic is trivial; publishing it is not about saving a division. It is about there being
 * ONE answer to "is this run in trouble", so a warning in the CLI and a badge in a dashboard agree.
 */

/** How close a run is to its context limit. */
export type ContextPressure = 'ok' | 'warn' | 'critical'

/**
 * Fractions of the effective window at which each level begins.
 *
 * Defaults chosen to leave room to act: `warn` at 75% is early enough that compacting still helps,
 * `critical` at 90% is where the next turn may not fit. Configurable because a product with long
 * tool outputs legitimately wants an earlier warning than one with short chat turns.
 */
export interface ContextPressureThresholds {
  readonly warn: number
  readonly critical: number
}

export const DEFAULT_CONTEXT_PRESSURE_THRESHOLDS: ContextPressureThresholds = {
  warn: 0.75,
  critical: 0.9,
}

/** Raised when thresholds are ordered in a way that makes a level unreachable. */
export class ContextPressureThresholdError extends TheokitAgentError {
  override readonly name = 'ContextPressureThresholdError'

  constructor(message: string) {
    // Not retryable: a misordered threshold is a configuration mistake, and retrying it produces
    // the same unreachable level forever.
    super(message, { code: 'context_pressure_thresholds_unordered', isRetryable: false })
  }
}

/**
 * Classify a run's context pressure.
 *
 * @param usedTokens tokens the run has consumed
 * @param effectiveWindow the window it is consuming from — typically
 * `resolveEffectiveContextWindow(...)`, re-exported here so a caller reaches both through one import
 * (see {@link effectiveContextWindow}).
 *
 * An `effectiveWindow` of zero or less returns `'ok'` rather than dividing: an unknown window is not
 * evidence of pressure, and `Infinity`/`NaN` reaching a UI as a percentage is worse than saying
 * nothing. Missing evidence is not evidence — the same rule the transcript collector applies to a
 * missing mtime.
 *
 * @throws {ContextPressureThresholdError} when `warn` is not below `critical` — a caller who
 * inverted them holds a belief about their own thresholds that is wrong, and silently sorting them
 * would leave that belief intact.
 */
export function contextPressure(
  usedTokens: number,
  effectiveWindow: number,
  thresholds: ContextPressureThresholds = DEFAULT_CONTEXT_PRESSURE_THRESHOLDS,
): ContextPressure {
  if (thresholds.warn >= thresholds.critical) {
    throw new ContextPressureThresholdError(
      `context pressure: \`warn\` (${String(thresholds.warn)}) must be below \`critical\` ` +
        `(${String(thresholds.critical)}), otherwise one of the two levels can never be reached.`,
    )
  }
  if (!Number.isFinite(effectiveWindow) || effectiveWindow <= 0) return 'ok'
  if (!Number.isFinite(usedTokens) || usedTokens <= 0) return 'ok'

  const ratio = usedTokens / effectiveWindow
  if (ratio >= thresholds.critical) return 'critical'
  if (ratio >= thresholds.warn) return 'warn'
  return 'ok'
}

/**
 * The SDK's effective-window resolver, re-exported beside its consumer.
 *
 * The numerator and the denominator living in different imports is precisely why nobody put them
 * together for so long.
 */
export { resolveEffectiveContextWindow as effectiveContextWindow }
