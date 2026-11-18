import { TheokitAgentError } from '@theokit/sdk/errors'

/**
 * The live-suite guard: under the required flag (default `THEOKIT_LIVE_REQUIRED=1`) an absent
 * provider key fails the run instead of letting every live test skip green. Without the flag it
 * returns, so a developer with no key keeps the local skip. The message names variables, never
 * values, so nothing here can print a credential.
 */

/** Every variable the live tests read a provider key from. */
export const LIVE_KEY_NAMES = [
  'OPENROUTER_API_KEY',
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'THEOKIT_API_KEY',
] as const

const DEFAULT_REQUIRED_FLAG = 'THEOKIT_LIVE_REQUIRED'

export interface ProviderKeyGuardOptions {
  /** Variables that count as a provider key. Defaults to {@link LIVE_KEY_NAMES}. */
  readonly names?: readonly string[]
  /** Variable that, set to `1`, makes a missing key fatal. Defaults to `THEOKIT_LIVE_REQUIRED`. */
  readonly requiredFlag?: string
}

export class MissingProviderKeyError extends TheokitAgentError {
  override readonly name = 'MissingProviderKeyError'
  constructor(names: readonly string[], requiredFlag: string = DEFAULT_REQUIRED_FLAG) {
    super(`provider key absent: ${requiredFlag}=1 and none of ${names.join(', ')} is set`, {
      code: 'missing_provider_key',
      isRetryable: false,
    })
  }
}

export function assertProviderKeyWhenRequired(
  env: Record<string, string | undefined>,
  opts: ProviderKeyGuardOptions = {},
): void {
  const names = opts.names ?? LIVE_KEY_NAMES
  const requiredFlag = opts.requiredFlag ?? DEFAULT_REQUIRED_FLAG
  if (env[requiredFlag] !== '1') return
  if (names.some((name) => (env[name]?.trim() ?? '') !== '')) return
  throw new MissingProviderKeyError(names, requiredFlag)
}

/** A vitest `globalSetup` function an app can re-export from a one-line setup file. */
export function requireProviderKeySetup(opts: ProviderKeyGuardOptions = {}): () => void {
  return () => assertProviderKeyWhenRequired(process.env, opts)
}
