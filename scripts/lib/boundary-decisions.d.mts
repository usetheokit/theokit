/** Types for `boundary-decisions.mjs`. */

/** `'forward'` promises a door exists; `{ out }` records why one does not. */
export type BoundaryDecision = 'forward' | { out: string }

/**
 * One written decision per SDK subpath with no door in `@theokit/agents`, with the measurement
 * behind it. Enforced by `tests/integration/boundary-doorless-subpaths.test.ts`: a subpath the SDK
 * adds later arrives as a named test failure rather than a silent hole.
 */
export declare const DOORLESS_DECISIONS: Record<string, BoundaryDecision>
