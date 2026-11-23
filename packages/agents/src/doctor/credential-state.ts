import { existsSync, readFileSync } from 'node:fs'

import type { CredentialState } from './checks.js'

export interface CredentialStateOptions {
  /** Epoch milliseconds; injected so the expiry boundary is testable. Defaults to `Date.now()`. */
  now?: number
  /**
   * Whether the environment already supplies a usable credential. Consulted BEFORE the file, because
   * a runtime that prefers the environment authenticates even when the store is absent or expired.
   * Provider selection is the product's policy, so the product answers it.
   */
  fromEnvironment?: () => boolean
}

/** Every stored credential names its `provider`; that is the one field both forms share. */
function looksLikeACredential(parsed: unknown): boolean {
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return false
  const provider: unknown = (parsed as { provider?: unknown }).provider
  return typeof provider === 'string' && provider !== ''
}

/**
 * The state of the stored credential at `path`, derived without returning or logging its value.
 *
 * `present` when the environment supplies one, or the file parses to an object with a `provider`
 * and no past `expires`; `absent` when there is no file; `unreadable` when it is not JSON or not a
 * credential; `expired` when a numeric `expires` is at or before `now`. A missing or non-numeric
 * `expires` is not expiry: API-key credentials have none.
 */
export function credentialState(
  path: string,
  options: CredentialStateOptions = {},
): CredentialState {
  if (options.fromEnvironment?.() === true) return 'present'
  if (!existsSync(path)) return 'absent'
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return 'unreadable'
  }
  if (!looksLikeACredential(parsed)) return 'unreadable'
  const expires = (parsed as { expires?: unknown }).expires
  return typeof expires === 'number' && expires <= (options.now ?? Date.now())
    ? 'expired'
    : 'present'
}
