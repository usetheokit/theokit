/**
 * Types for `live-model.mjs`, so the root tests and the `@theokit/agents` live files import it
 * without a suppression. The script stays `.mjs` because the CI step runs the preflight that imports
 * it through plain `node`, with no build in front of it.
 */

/** The model the live-model job runs when `LIVE_MODEL` is unset, empty or whitespace. */
export const DEFAULT_LIVE_MODEL: string

/** `env.LIVE_MODEL` trimmed, or `DEFAULT_LIVE_MODEL` when that leaves nothing. */
export function resolveLiveModel(env: Record<string, string | undefined>): string
