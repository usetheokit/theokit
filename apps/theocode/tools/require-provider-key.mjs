/**
 * The globalSetup of `npm run test:live` (B-407, B-415): under `THEOKIT_LIVE_REQUIRED=1` an absent
 * provider key fails the run instead of letting the A2A real-model test skip green. Without the
 * flag it returns, so a developer with no key keeps the skip the test file applies.
 *
 * The same guard `@theokit/agents` loads for its own live suite. It is restated here rather than
 * imported, because TheoCode reaches theokit only through published entry points and a package's
 * `tests/` directory is not one. The key names match the `KEYS` list the live test reads. The
 * message names variables, never values, so nothing here can print a credential.
 */
const LIVE_KEY_NAMES = ['OPENROUTER_API_KEY', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'THEOKIT_API_KEY']

export class MissingProviderKeyError extends Error {
  /** @param {readonly string[]} names */
  constructor(names) {
    super(`provider key absent: THEOKIT_LIVE_REQUIRED=1 and none of ${names.join(', ')} is set`)
    this.name = 'MissingProviderKeyError'
  }
}

/** @param {Record<string, string | undefined>} env */
export function assertProviderKeyWhenRequired(env) {
  if (env.THEOKIT_LIVE_REQUIRED !== '1') return
  if (LIVE_KEY_NAMES.some((name) => (env[name]?.trim() ?? '') !== '')) return
  throw new MissingProviderKeyError(LIVE_KEY_NAMES)
}

export default function setup() {
  assertProviderKeyWhenRequired(process.env)
}
