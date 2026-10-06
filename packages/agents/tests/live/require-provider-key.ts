/**
 * The live suite's globalSetup: under `THEOKIT_LIVE_REQUIRED=1` an absent provider key fails the
 * run instead of letting every live file skip green (B-415). Without the flag it returns, so a
 * developer with no key keeps the local skip the three live files already apply.
 *
 * The key names match the `KEYS` list each live file reads. The message names variables, never
 * values, so nothing here can print a credential.
 */
const LIVE_KEY_NAMES = [
  'OPENROUTER_API_KEY',
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'THEOKIT_API_KEY',
] as const

export class MissingProviderKeyError extends Error {
  constructor(names: readonly string[]) {
    super(`provider key absent: THEOKIT_LIVE_REQUIRED=1 and none of ${names.join(', ')} is set`)
    this.name = 'MissingProviderKeyError'
  }
}

export function assertProviderKeyWhenRequired(env: Record<string, string | undefined>): void {
  if (env.THEOKIT_LIVE_REQUIRED !== '1') return
  if (LIVE_KEY_NAMES.some((name) => (env[name]?.trim() ?? '') !== '')) return
  throw new MissingProviderKeyError(LIVE_KEY_NAMES)
}

export default function setup(): void {
  assertProviderKeyWhenRequired(process.env)
}
