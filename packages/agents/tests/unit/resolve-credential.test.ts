/**
 * T4.1 — the `oauth` variant `CredentialResolution` declares must be producible.
 *
 * `CredentialResolution.kind` is `'api-key' | 'oauth'` and `SourceOrigin` carries an
 * `{ kind: 'oauth', provider }` arm — both published, neither reachable: every return path built an
 * `'api-key'`. A declared-but-unproducible variant is a correctness defect a consumer only discovers
 * at runtime, after writing the `case 'oauth':` branch that never runs. Worse than absent, because
 * the type promised it.
 *
 * ## Scope correction, recorded rather than quietly dropped
 *
 * The cross-validation also listed "provider inference by KEY prefix without longest-match-wins"
 * (EC-3). Read at implementation time, this resolver has **no key-prefix inference at all** — it
 * selects by declared `priority`, and `modelPrefix` matches the MODEL id (`openai/…`), never the key
 * (`sk-ant-…`). There is no longest-match bug to fix here because there is no prefix match on keys.
 * Asserting one would have been a test passing for a reason unrelated to its name. What IS asserted
 * below is the real selection rule: priority decides, and a model prefix claiming a provider without
 * a credential throws.
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { resolveCredential } from '../../src/auth/resolve-credential.js'
import type { ProviderDescriptor } from '../../src/auth/resolve-credential.js'

let home: string

const PROVIDERS: readonly ProviderDescriptor[] = [
  { name: 'openai', envKey: 'OPENAI_API_KEY', priority: 1, modelPrefix: 'openai/' },
  { name: 'anthropic', envKey: 'ANTHROPIC_API_KEY', priority: 2, modelPrefix: 'anthropic/' },
]

/** The store the SDK writes: `<home>/.theokit/auth.json`, mode 0600 inside a 0700 dir. */
function writeOAuthStore(provider: string, expires: number): void {
  const dir = join(home, '.theokit')
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  chmodSync(dir, 0o700)
  const file = join(dir, 'auth.json')
  writeFileSync(
    file,
    JSON.stringify({ type: 'oauth', provider, access: 'at-123', refresh: 'rt-456', expires }),
    { encoding: 'utf8', mode: 0o600 },
  )
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'theokit-cred-'))
})

afterEach(() => {
  rmSync(home, { recursive: true, force: true })
})

describe('resolveCredential', () => {
  it('returns_undefined_when_nothing_is_configured', () => {
    // Documented behaviour a consumer relies on: a missing key is the ordinary first-run state, and
    // the caller's next move is "run `theokit auth login`" — which a thrown error makes harder.
    expect(resolveCredential({ env: {}, providers: PROVIDERS })).toBeUndefined()
  })

  it('selects_by_declared_priority', () => {
    const resolution = resolveCredential({
      env: { OPENAI_API_KEY: 'sk-a', ANTHROPIC_API_KEY: 'sk-ant-b' },
      providers: PROVIDERS,
    })

    expect(resolution?.provider).toBe('openai')
    expect(resolution?.inferred, 'the caller named no provider, so this was inferred').toBe(true)
  })

  it('a_model_prefix_pins_the_provider', () => {
    const resolution = resolveCredential({
      env: { OPENAI_API_KEY: 'sk-a', ANTHROPIC_API_KEY: 'sk-ant-b' },
      providers: PROVIDERS,
      model: 'anthropic/claude-x',
    })

    expect(resolution?.provider).toBe('anthropic')
    expect(resolution?.inferred, 'the model named it, so it was not inferred').toBe(false)
  })

  it('an_empty_env_value_counts_as_absent', () => {
    // `OPENAI_API_KEY=` is how a key gets unset in practice. Treating it as present sends an empty
    // Authorization header — a clear local failure turned into a remote 401.
    const resolution = resolveCredential({
      env: { OPENAI_API_KEY: '', ANTHROPIC_API_KEY: 'sk-ant-b' },
      providers: PROVIDERS,
    })

    expect(resolution?.provider).toBe('anthropic')
  })

  it('a_prefix_claiming_a_provider_without_a_credential_throws', () => {
    expect(() =>
      resolveCredential({
        env: { OPENAI_API_KEY: 'sk-a' },
        providers: PROVIDERS,
        model: 'anthropic/claude-x',
      }),
    ).toThrow(/anthropic/i)
  })

  it('oauth_kind_is_producible', () => {
    // THE defect: the published type declares this variant and no code path produced it.
    writeOAuthStore('anthropic', 4_000)

    const resolution = resolveCredential({
      env: {},
      providers: PROVIDERS,
      home,
      store: { home, dirName: '.theokit', fileName: 'auth.json' },
    })

    expect(resolution?.kind).toBe('oauth')
    expect(resolution?.provider).toBe('anthropic')
    expect(resolution?.apiKey, 'the access token is what a caller sends').toBe('at-123')
    expect(resolution?.source).toEqual({ kind: 'oauth', provider: 'anthropic' })
  })

  it('an_env_key_wins_over_a_stored_oauth_credential', () => {
    // Precedence, stated: the environment is the more explicit, more immediate signal, and matches
    // the chain a consumer already implements (declared env → per-provider env → file).
    writeOAuthStore('anthropic', 4_000)

    const resolution = resolveCredential({
      env: { OPENAI_API_KEY: 'sk-a' },
      providers: PROVIDERS,
      home,
      store: { home, dirName: '.theokit', fileName: 'auth.json' },
    })

    expect(resolution?.kind).toBe('api-key')
    expect(resolution?.provider).toBe('openai')
  })

  it('a_stored_credential_for_an_undeclared_provider_is_ignored', () => {
    // WHICH providers exist stays app policy. A store naming one the app never declared must not
    // smuggle it in through the back door.
    writeOAuthStore('mistral', 4_000)

    expect(
      resolveCredential({
        env: {},
        providers: PROVIDERS,
        home,
        store: { home, dirName: '.theokit', fileName: 'auth.json' },
      }),
    ).toBeUndefined()
  })

  it('behaviour_is_unchanged_when_no_store_is_configured', () => {
    // Backward-compatibility guard: the store is opt-in, and an existing caller that passes none
    // must observe byte-identical behaviour.
    writeOAuthStore('anthropic', 4_000)

    expect(resolveCredential({ env: {}, providers: PROVIDERS, home })).toBeUndefined()
  })
})
