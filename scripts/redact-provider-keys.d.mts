/**
 * Types for `redact-provider-keys.mjs`, so a TypeScript caller (the root tests, the live suite's
 * `provider-text.ts`) imports it without a suppression. The script stays `.mjs` because the CI
 * steps run its callers through plain `node`, with no build in front of them.
 */

/** The shortest run of the configured key that `redact` replaces on its own. */
export const MIN_KEY_FRAGMENT: number

/**
 * Replace every run of `MIN_KEY_FRAGMENT` or more characters of `key` (the whole key, a head, a
 * tail or a middle) and every `sk-or-v1-` prefix with the hex that follows it with `***`. Both are
 * found on the original text and merged, so a configured key never hides another key from the
 * prefix pattern. A blank `key` applies the prefix pattern only.
 */
export function redact(text: string, key: string): string
