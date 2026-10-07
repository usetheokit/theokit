/**
 * Types for `live-model-preflight.mjs`, so a TypeScript caller such as the root test imports it
 * without a suppression. The script stays `.mjs` because the CI step runs it through plain `node`
 * with no build in front of it, as `publish-log.d.mts` explains for its own script.
 */

/** Milliseconds the one request may take before it is aborted and named unreachable. */
export const PREFLIGHT_TIMEOUT_MS: number

/** Output tokens the preflight asks the model for. */
export const MAX_OUTPUT_TOKENS: number

/** The model used when `LIVE_MODEL` is unset or blank. */
export const DEFAULT_LIVE_MODEL: string

/** The shortest run of the configured key that `redact` replaces on its own. */
export const MIN_KEY_FRAGMENT: number

/**
 * Replace every run of `MIN_KEY_FRAGMENT` or more characters of `key` (the whole key, a head, a
 * tail or a middle) and every `sk-or-v1-` prefix with the hex that follows it with `***`. Both are
 * found on the original text and merged, so a configured key never hides another key from the
 * prefix pattern. A blank `key` applies the prefix pattern only.
 */
export function redact(text: string, key: string): string

/**
 * Send one chat request to OpenRouter and print one named line through `log`. Resolves 0 only on
 * a 2xx whose answer carries non-blank content, 1 otherwise. Never prints the key.
 */
export function runPreflight(options: {
  env: Record<string, string | undefined>
  fetchImpl: (url: string, init: RequestInit) => Promise<Response>
  log: (line: string) => void
  timeoutMs?: number
}): Promise<0 | 1>
