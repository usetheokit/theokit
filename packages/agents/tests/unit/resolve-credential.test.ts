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
 * (`sk-ant-…`). There is no longest-match bug to fix *here* because there is no prefix match on keys.
 * Asserting one would have been a test passing for a reason unrelated to its name. What IS asserted
 * below is the real selection rule: priority decides, and a model prefix claiming a provider without
 * a credential throws.
 *
 * **Superseded in part, and recorded rather than left to read as settled.** That note closed the
 * question for this file, and it was later measured that the capability was simply MISSING from the
 * stack: the consumer infers a provider from the key prefix at login, the SDK answered exactly that
 * from an `@internal` module no entry exported, and its lookup depended on the prefix table being
 * hand-written in longest-first order. `providerFromApiKeyPrefix` is now public in
 * `@theokit/sdk/auth` with the ordering derived. It is a DIFFERENT question from this resolver's —
 * "whose is this string?" versus "what credential should I use?" — so it stays a separate symbol,
 * and the forward through `./auth` is pending the SDK publish (see `auth-entry.ts`).
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { providerFromApiKeyPrefix } from '@theokit/sdk/auth'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  CredentialNotFoundError,
  DEFAULT_PROVIDERS,
  credentialSources,
  requireCredential,
  resolveAgentCredential,
  resolveCredential,
} from '../../src/auth/resolve-credential.js'
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

/**
 * The stored-credential shapes a consumer needs to READ what `writeCredential` wrote.
 *
 * Measured against the closest real consumer: it declares its own `StoredOAuthCredential` because
 * the layer forwarded `writeCredential` and `readStoredOAuth` but not the type of what they carry.
 * A function you can call whose payload you must re-describe is only half forwarded — and the
 * hand-written mirror is where the two drift.
 */
describe('stored credential types', () => {
  it('the_shapes_behind_writeCredential_are_reachable', async () => {
    const mod = (await import('../../src/auth-entry.js')) as Record<string, unknown>

    // Types erase at runtime, so what this case can assert is that the module resolves and still
    // carries the functions those types describe. The type half is enforced by the import at the
    // foot of this file — and by a DIFFERENT command than the one running this line, which is worth
    // stating rather than implying: vitest's own `Type Errors` row does not cover it. Verified by
    // deleting the forward and re-running:
    //   npx tsc --noEmit -p packages/agents/tsconfig.test.json   → TS2724 + TS2305
    // That is the gate CI and the pre-push hook run, so the guarantee holds where it matters.
    expect(typeof mod.writeCredential).toBe('function')
    expect(typeof mod.readStoredOAuth).toBe('function')
  })
})

// Compile-time half of the assertion above: `tsc --noEmit` fails if either type is dropped.
import type { StoredCredential, StoredOAuthCredential } from '../../src/auth-entry.js'
type _StoredOAuthIsReachable = StoredOAuthCredential['provider']
type _StoredIsReachable = StoredCredential extends never ? never : true

/**
 * Where the resolver LOOKED, for the message it cannot write.
 *
 * `resolveCredential` returns `undefined` when nothing is configured, deliberately: a missing key is
 * the ordinary first-run state, and a thrown error makes the caller's next move harder. That is not
 * the gap. The gap is that `undefined` says nothing about WHERE it looked, so a product rendering
 * "no credential found" either says exactly that — the least useful sentence available — or rebuilds
 * the resolver's own precedence to name the places. The measured consumer built the second, carrying
 * an `attempts` list on its own error type.
 *
 * Reporting is separated from resolving on purpose: the resolver keeps returning `undefined`, and
 * the caller asks a second, pure question to render its own error.
 */
describe('credentialSources', () => {
  it('names_every_place_the_resolver_would_look', () => {
    const sources = credentialSources({ providers: PROVIDERS })

    expect(sources).toContain('OPENAI_API_KEY')
    expect(sources).toContain('ANTHROPIC_API_KEY')
  })

  it('includes_the_store_when_one_is_configured', () => {
    const sources = credentialSources({
      providers: PROVIDERS,
      store: { home: '/h', dirName: '.theokit', fileName: 'auth.json' },
    })

    expect(
      sources.some((s) => s.includes('auth.json')),
      'a configured store was not named among the places looked',
    ).toBe(true)
  })

  it('omits_the_store_when_none_is_configured', () => {
    // Naming a place that was never consulted sends the user to fix a file the resolver never read.
    const sources = credentialSources({ providers: PROVIDERS })

    expect(sources.some((s) => s.includes('auth.json'))).toBe(false)
  })

  it('follows_the_resolution_order', () => {
    // The list is what a caller prints, so its order has to be the order actually tried — otherwise
    // it reads as a precedence claim that the resolver does not honour.
    const sources = credentialSources({ providers: PROVIDERS })

    expect(sources.indexOf('OPENAI_API_KEY')).toBeLessThan(sources.indexOf('ANTHROPIC_API_KEY'))
  })
})

/**
 * The ASSEMBLY — the policy that turns the SDK's credential primitives into an auth mechanism.
 *
 * Measured against the closest real consumer: it imports our `authFilePath`, `credentialHome`,
 * `readAuthFile`, `writeCredential` and `AuthProvider`, and then writes ~250 lines of its own on top.
 * None of those lines are about its domain — they are the RESOLUTION POLICY every terminal agent app
 * needs and none of them can import:
 *
 *  1. **The declared-provider pin.** `PROVIDER=anthropic` must mean "anthropic or nothing". Falling
 *     back to another provider's key because the pinned one is missing sends the request somewhere
 *     the operator did not choose, and the bill and the data both go there.
 *  2. **Key ↔ provider coherence.** A key whose prefix contradicts its declared provider is a
 *     mistake caught locally for free, or a 401 from the wrong endpoint later whose message says
 *     nothing about the mismatch.
 *  3. **Attempts.** "No credential found" without the list of places looked is the least useful
 *     sentence available.
 *  4. **Freshness.** An expired OAuth token refreshes; a refresh that fails TRANSIENTLY falls back
 *     to the token in hand rather than failing the turn on a network blip.
 */
describe('credential resolution policy', () => {
  const WITH_PREFIX: readonly ProviderDescriptor[] = [
    { name: 'openai', envKey: 'OPENAI_API_KEY', priority: 1, keyPrefix: 'sk-' },
    { name: 'anthropic', envKey: 'ANTHROPIC_API_KEY', priority: 2, keyPrefix: 'sk-ant-' },
  ]

  it('a_declared_provider_pins_the_choice', () => {
    const resolution = resolveCredential({
      env: { PROVIDER: 'anthropic', OPENAI_API_KEY: 'sk-a', ANTHROPIC_API_KEY: 'sk-ant-b' },
      providers: WITH_PREFIX,
      declaredProviderEnvVar: 'PROVIDER',
    })

    expect(resolution?.provider).toBe('anthropic')
    expect(resolution?.inferred, 'the operator named it, so nothing was inferred').toBe(false)
  })

  it('a_declared_provider_refuses_to_fall_back', () => {
    // The security property. Silently using OpenAI's key because the pinned Anthropic one is absent
    // sends the request — and the bill, and the data — somewhere the operator did not choose.
    expect(() =>
      resolveCredential({
        env: { PROVIDER: 'anthropic', OPENAI_API_KEY: 'sk-a' },
        providers: WITH_PREFIX,
        declaredProviderEnvVar: 'PROVIDER',
      }),
    ).toThrow(/anthropic/i)
  })

  it('a_declared_provider_that_is_not_declared_is_refused', () => {
    // Negative case: a typo must not silently disable the pin and fall through to precedence.
    expect(() =>
      resolveCredential({
        env: { PROVIDER: 'anthropci', ANTHROPIC_API_KEY: 'sk-ant-b' },
        providers: WITH_PREFIX,
        declaredProviderEnvVar: 'PROVIDER',
      }),
    ).toThrow(/anthropci|expected one of/i)
  })

  it('a_key_whose_prefix_contradicts_its_provider_is_refused', () => {
    // `ANTHROPIC_API_KEY=sk-proj-…` is a paste into the wrong variable. Caught here for free, or a
    // remote 401 later whose message says nothing about the mismatch.
    expect(() =>
      resolveCredential({
        env: { ANTHROPIC_API_KEY: 'sk-proj-openai-shaped' },
        providers: WITH_PREFIX,
      }),
    ).toThrow(/prefix|sk-ant-/i)
  })

  it('a_matching_prefix_passes', () => {
    // Anti-vacuity floor: refusing every key would satisfy the assertion above.
    expect(
      resolveCredential({ env: { ANTHROPIC_API_KEY: 'sk-ant-ok' }, providers: WITH_PREFIX })
        ?.provider,
    ).toBe('anthropic')
  })

  it('requireCredential_names_every_place_it_looked', () => {
    let thrown: unknown
    try {
      requireCredential({ env: {}, providers: WITH_PREFIX })
    } catch (err) {
      thrown = err
    }

    expect(thrown).toBeInstanceOf(CredentialNotFoundError)
    const attempts = (thrown as CredentialNotFoundError).attempts
    expect(attempts, 'the error cannot say where it looked').toContain('OPENAI_API_KEY')
    expect(attempts).toContain('ANTHROPIC_API_KEY')
    expect((thrown as Error).message).toMatch(/OPENAI_API_KEY/)
  })

  it('requireCredential_returns_the_resolution_when_there_is_one', () => {
    expect(
      requireCredential({ env: { OPENAI_API_KEY: 'sk-a' }, providers: WITH_PREFIX }).provider,
    ).toBe('openai')
  })

  it('resolveCredential_still_returns_undefined_rather_than_throwing', () => {
    // Backward-compatibility guard: the non-throwing shape is what existing callers rely on, and
    // `requireCredential` is the opt-in for the ones that want the error.
    expect(resolveCredential({ env: {}, providers: WITH_PREFIX })).toBeUndefined()
  })
})

/**
 * The default provider set — what makes a NEW app need no table of its own.
 *
 * Measured: the closest consumer opens with three hand-written tables (`PROVIDERS`, `PREFIXES`,
 * `ENV_KEYS`) that say the same thing every terminal agent app says. That is not its domain; it is
 * the cost of the framework shipping a resolver with no defaults, so every app writes the argument.
 */
describe('DEFAULT_PROVIDERS', () => {
  it('covers_the_providers_an_agent_app_starts_with', () => {
    const names = DEFAULT_PROVIDERS.map((p) => p.name)

    expect(names).toContain('openai')
    expect(names).toContain('anthropic')
    expect(names).toContain('openrouter')
  })

  it('every_default_carries_what_the_resolver_needs', () => {
    for (const p of DEFAULT_PROVIDERS) {
      expect(p.envKey, `${p.name} has no env var`).toMatch(/_API_KEY$/)
      expect(p.keyPrefix, `${p.name} has no key prefix`).toBeTruthy()
      expect(typeof p.priority).toBe('number')
    }
  })

  it('priorities_are_distinct_so_precedence_is_not_array_order', () => {
    // A tie would make the caller's array order a hidden second policy — the thing `priority` exists
    // to make explicit.
    const priorities = DEFAULT_PROVIDERS.map((p) => p.priority)
    expect(new Set(priorities).size).toBe(priorities.length)
  })

  it('the_prefixes_agree_with_the_sdk', () => {
    // DRIFT GUARD, now with a typed import. The SDK owns the same knowledge, and a second
    // hand-maintained copy is what produced the longest-prefix bug fixed in 4.52.0. The coherence
    // check already ASKS the SDK rather than restating it; this keeps the descriptor table — which
    // still names a prefix per provider for the escape-hatch path — from drifting away from it.
    for (const p of DEFAULT_PROVIDERS) {
      expect(
        providerFromApiKeyPrefix(`${p.keyPrefix ?? ''}example-key`),
        `our table says ${p.name} owns "${p.keyPrefix ?? ''}", the SDK disagrees`,
      ).toBe(p.name)
    }
  })
})

/**
 * A NEW app, from zero — the acceptance criterion for this whole feature.
 *
 * The question is not "does the policy exist as a function"; it is whether an app that has just been
 * created gets working auth WITHOUT writing the assembly. So these cases pass only what a new app
 * actually has: the environment.
 */
describe('resolveAgentCredential — the one call a new app makes', () => {
  it('a_new_app_needs_only_the_environment', () => {
    const resolution = resolveAgentCredential({ env: { ANTHROPIC_API_KEY: 'sk-ant-x' } })

    expect(resolution.provider).toBe('anthropic')
    expect(resolution.apiKey).toBe('sk-ant-x')
  })

  it('precedence_works_with_no_table_declared', () => {
    const resolution = resolveAgentCredential({
      env: { OPENAI_API_KEY: 'sk-a', OPENROUTER_API_KEY: 'sk-or-b' },
    })

    expect(resolution.provider, 'the default order put openrouter first').toBe('openrouter')
  })

  it('the_pin_works_with_no_variable_name_declared', () => {
    const resolution = resolveAgentCredential({
      env: { THEOKIT_PROVIDER: 'openai', OPENAI_API_KEY: 'sk-a', OPENROUTER_API_KEY: 'sk-or-b' },
    })

    expect(resolution.provider).toBe('openai')
  })

  it('an_empty_environment_says_where_it_looked', () => {
    // A new app's FIRST run. Printing this error is the whole handling it needs.
    let thrown: unknown
    try {
      resolveAgentCredential({ env: {} })
    } catch (err) {
      thrown = err
    }

    expect(thrown).toBeInstanceOf(CredentialNotFoundError)
    expect((thrown as Error).message).toMatch(/ANTHROPIC_API_KEY/)
    expect((thrown as Error).message).toMatch(/OPENROUTER_API_KEY/)
  })

  it('an_app_can_narrow_the_provider_set', () => {
    // The real reason to disagree with the default: a product that only talks to one provider must
    // not silently accept another's key from the environment.
    expect(() =>
      resolveAgentCredential({
        env: { OPENAI_API_KEY: 'sk-a' },
        providers: DEFAULT_PROVIDERS.filter((p) => p.name === 'anthropic'),
      }),
    ).toThrow(CredentialNotFoundError)
  })

  it('a_mis_pasted_key_is_caught_with_no_extra_wiring', () => {
    expect(() => resolveAgentCredential({ env: { ANTHROPIC_API_KEY: 'sk-proj-openai' } })).toThrow(
      /sk-ant-/,
    )
  })
})

/**
 * The file store holds API keys too — and they must be readable.
 *
 * `writeCredential` persists an api-key credential as `{ provider, api_key }`, and the resolver read
 * back only the `oauth` variant. Write without read: the framework could store a key that nothing
 * in it could then use, which is why the measured consumer keeps its own file reader.
 *
 * Found by attempting the migration — the same shape as every other gap in this series.
 */
describe('resolveCredential — the api-key variant in the store', () => {
  const writeApiStore = (provider: string, apiKey: string): void => {
    const dir = join(home, '.theokit')
    mkdirSync(dir, { recursive: true, mode: 0o700 })
    chmodSync(dir, 0o700)
    writeFileSync(
      join(dir, 'auth.json'),
      JSON.stringify({ type: 'api', provider, api_key: apiKey }),
      {
        encoding: 'utf8',
        mode: 0o600,
      },
    )
  }

  const store = () => ({ home, dirName: '.theokit', fileName: 'auth.json' })

  it('an_api_key_written_to_the_store_is_read_back', () => {
    writeApiStore('anthropic', 'sk-ant-stored')

    const resolution = resolveCredential({ env: {}, providers: PROVIDERS, home, store: store() })

    expect(resolution?.kind).toBe('api-key')
    expect(resolution?.provider).toBe('anthropic')
    expect(resolution?.apiKey).toBe('sk-ant-stored')
  })

  it('the_source_says_it_came_from_the_file', () => {
    // Provenance is the point of `SourceOrigin`: "why is it calling Anthropic?" must be answerable
    // from the data, and "from the store" is a different answer than "from the environment".
    writeApiStore('anthropic', 'sk-ant-stored')

    const resolution = resolveCredential({ env: {}, providers: PROVIDERS, home, store: store() })

    expect(resolution?.source).toEqual({ kind: 'file', path: expect.stringContaining('auth.json') })
  })

  it('an_env_key_still_wins_over_the_stored_one', () => {
    // Precedence unchanged: the environment is the more explicit, more immediate signal.
    writeApiStore('anthropic', 'sk-ant-stored')

    expect(
      resolveCredential({
        env: { OPENAI_API_KEY: 'sk-env' },
        providers: PROVIDERS,
        home,
        store: store(),
      })?.apiKey,
    ).toBe('sk-env')
  })

  it('a_stored_api_key_for_an_undeclared_provider_is_ignored', () => {
    // Same rule the oauth path already holds: which providers exist is app policy, and the store
    // must not smuggle one in through the back door.
    writeApiStore('mistral', 'sk-whatever')

    expect(
      resolveCredential({ env: {}, providers: PROVIDERS, home, store: store() }),
    ).toBeUndefined()
  })

  it('an_empty_stored_key_counts_as_absent', () => {
    writeApiStore('anthropic', '')

    expect(
      resolveCredential({ env: {}, providers: PROVIDERS, home, store: store() }),
    ).toBeUndefined()
  })
})
