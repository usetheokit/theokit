/**
 * B-080 — telling the user the context is running out BEFORE it does.
 *
 * `/compact` was the only compaction path and nothing warned: the failure arrived mid-turn, at the
 * point where the work is least recoverable. The footer showed `used/window` all along, which is
 * data, not a signal — a number climbing slowly is exactly what people stop reading.
 *
 * ## Absorbed 2026-08-15 — the classifier is the framework's, the words are ours
 *
 * `contextPressure` and its `ContextPressure` type now come from `@theokit/agents/config`.
 * Behaviour is identical, verified against the published build rather than assumed: the defaults
 * are `{warn: 0.75, critical: 0.9}`, 74% is `ok`, 75% is `warn`, 89% is `warn`, 90% is `critical`,
 * and a window of zero or less is `ok` — the same refusal to fire the alarm on a model with no
 * declared window. Ours additionally accepts per-call thresholds, which nothing here needs yet.
 *
 * What stays is `contextWarning`: the message text names `/compact` and says what compaction costs,
 * so the user is choosing rather than obeying. That is product copy, and a framework that wrote it
 * would be putting words in this product's mouth.
 */
export { contextPressure } from '@theokit/agents/config'
export type { ContextPressure } from '@theokit/agents/config'

import { DEFAULT_CONTEXT_PRESSURE_THRESHOLDS } from '@theokit/agents/config'
import type { ContextPressure } from '@theokit/agents/config'

/**
 * The thresholds, DERIVED from the framework rather than restated.
 *
 * They were local constants, and a local copy of a default is a copy that stops matching without
 * anyone noticing. Reading them from the framework means this product's own test — which asserts the
 * warning fires AT the threshold and not after — is checking the real number, so a change upstream
 * shows up here as a failure instead of as drift.
 */
export const WARN_AT = DEFAULT_CONTEXT_PRESSURE_THRESHOLDS.warn
export const CRITICAL_AT = DEFAULT_CONTEXT_PRESSURE_THRESHOLDS.critical

/**
 * The message for a pressure level, or `undefined` when there is nothing to say.
 *
 * It names `/compact` because a warning without the remedy is just anxiety, and it says what
 * compaction costs — a summary replaces the older turns — so the user is choosing, not obeying.
 */
export function contextWarning(level: ContextPressure): string | undefined {
  if (level === 'critical') {
    return 'context is nearly full — run /compact now, or the next turn may fail mid-answer. Compacting summarizes the older turns and keeps the recent ones.'
  }
  if (level === 'warn') {
    return 'context is filling up — /compact summarizes the older turns when you want the room back.'
  }
  return undefined
}
