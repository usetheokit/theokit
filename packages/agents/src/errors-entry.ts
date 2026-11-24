/**
 * `@theokit/agents/errors` — a thrown turn error, with its cause chain, as a category, a retry verdict and a
 * next step.
 *
 * A subpath rather than a member of the root barrel. The classifier and its default hints came to 4 684 bytes
 * of `dist/index.js`, which put the root bundle at 46 332 bytes against its 42 000-byte cap (ADR 0033). It was
 * never published from the root, and an app that does not render turn failures does not pay for it here.
 */
export {
  classifyTurnFailure,
  describeTurnFailure,
  DEFAULT_TURN_FAILURE_HINTS,
} from './errors/turn-failure.js'
export type { TurnFailure, TurnFailureHints } from './errors/turn-failure.js'
export type { KnownAgentRunErrorCode } from '@theokit/sdk/errors'
export { createTurnRetries } from './errors/turn-retries.js'
export type { TurnRetries } from './errors/turn-retries.js'
