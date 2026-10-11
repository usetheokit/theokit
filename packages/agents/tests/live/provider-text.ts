/**
 * Provider text the live suite logs is redacted on its whole length before it is cut, so a key the
 * model echoed cannot reach the CI log as a fragment that no longer looks like a key (B-415,
 * delivery audit L1). The CI step also pipes the output through `scripts/redact-key-shapes.mjs`;
 * this is the half that runs before the truncation.
 */
import { redact } from '../../../../scripts/redact-provider-keys.mjs'

import { LIVE_KEY_NAMES } from './require-provider-key.js'

/**
 * Redact every configured provider key, and any 8-character run of one, on the whole of `text`,
 * then cut the result to `limit` characters.
 */
export function redactThenCut(
  text: string,
  limit: number,
  env: Record<string, string | undefined> = process.env,
): string {
  let redacted = text
  for (const name of LIVE_KEY_NAMES) redacted = redact(redacted, (env[name] ?? '').trim())
  return redacted.slice(0, limit)
}
