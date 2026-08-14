import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  ProviderPrefixMismatchError,
  resolveCredential,
  type ProviderDescriptor,
} from '../../src/auth/resolve-credential.js'

/**
 * M79 — "given an env, a home and a model, WHICH credential do I use, and WHERE did it come from?"
 *
 * ## The gap
 *
 * The hard half was already supplied: RFC 8628 device flow, refresh under a cross-process lock,
 * persistence, account-id extraction. The half every consumer meets FIRST was answered twice inside
 * the framework and exposed neither time — `resolveProvider()` behind `internal-api.ts`, and
 * `resolveCredential` deliberately withheld from `@theokit/agents/auth`.
 *
 * The "app policy" framing defends **which** providers exist. It does not defend the precedence
 * chain, the prefix/provider consistency check, or the provenance record: those are mechanism, and a
 * consumer forced to rewrite mechanism writes a 70-line dotenv parser to answer "shell or .env?".
 *
 * ## Why the descriptors are a PARAMETER
 *
 * The SDK and the agent-builder each ship a different function called `resolveCredential` — sync vs
 * async, throws vs `undefined`, reads env vs does not, infers the provider vs refuses. Publishing a
 * third under the same name in the same scope would be an invitation to import the wrong one.
 *
 * Taking the descriptor list as an argument is what makes this one distinguishable at the call site
 * rather than by luck: it is the only one whose signature says which providers it is talking about.
 */

const PROVIDERS: readonly ProviderDescriptor[] = [
  { name: 'openrouter', envKey: 'OPENROUTER_API_KEY', priority: 1, modelPrefix: 'openrouter/' },
  { name: 'openai', envKey: 'OPENAI_API_KEY', priority: 2, modelPrefix: 'openai/' },
  { name: 'anthropic', envKey: 'ANTHROPIC_API_KEY', priority: 3, modelPrefix: 'anthropic/' },
]

let home: string

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'resolve-cred-'))
})
afterEach(() => {
  rmSync(home, { recursive: true, force: true })
})

describe('precedence — which credential wins', () => {
  it('test_the_highest_priority_provider_present_in_env_wins', () => {
    const resolved = resolveCredential({
      env: { OPENAI_API_KEY: 'sk-openai', ANTHROPIC_API_KEY: 'sk-anthropic' },
      providers: PROVIDERS,
    })
    expect(resolved).toMatchObject({ provider: 'openai', apiKey: 'sk-openai', kind: 'api-key' })
  })

  it('test_priority_is_the_DECLARED_number_and_not_the_array_order', () => {
    // Anti-vacuity: with the array order also matching, a resolver that ignored `priority` entirely
    // would pass the test above. Handing it the list backwards is what proves the field is read.
    const resolved = resolveCredential({
      env: { OPENAI_API_KEY: 'sk-openai', OPENROUTER_API_KEY: 'sk-or' },
      providers: [...PROVIDERS].reverse(),
    })
    expect(resolved?.provider).toBe('openrouter')
  })

  it('test_no_credential_anywhere_returns_undefined_rather_than_throwing', () => {
    // A missing key is the ordinary first-run state, not an exceptional one: the caller's next move
    // is to print "run `theokit auth login`", which a thrown error makes harder, not easier.
    expect(resolveCredential({ env: {}, providers: PROVIDERS })).toBeUndefined()
  })

  it('test_an_empty_value_counts_as_ABSENT', () => {
    // `OPENAI_API_KEY=` in a `.env` is how a key gets "unset" in practice. Treating the empty string
    // as present sends an empty Authorization header and turns a clear local failure into a 401.
    const resolved = resolveCredential({
      env: { OPENAI_API_KEY: '', ANTHROPIC_API_KEY: 'sk-anthropic' },
      providers: PROVIDERS,
    })
    expect(resolved?.provider).toBe('anthropic')
  })
})

describe('provenance — WHERE it came from, as data', () => {
  it('test_a_shell_variable_reports_env_with_its_name', () => {
    const resolved = resolveCredential({ env: { OPENAI_API_KEY: 'sk-x' }, providers: PROVIDERS })
    expect(resolved?.source).toEqual({ kind: 'env', varName: 'OPENAI_API_KEY' })
  })

  it('test_a_variable_DECLARED_in_a_dotenv_file_reports_that_file', () => {
    // The distinction the consumer wrote a dotenv parser for. It matters operationally: "your key
    // comes from .env" and "your key comes from the shell" send an operator to different places.
    writeFileSync(join(home, '.env'), 'OPENAI_API_KEY=sk-from-file\nOTHER=1\n', 'utf8')
    const resolved = resolveCredential({
      env: { OPENAI_API_KEY: 'sk-from-file' },
      home,
      providers: PROVIDERS,
    })
    expect(resolved?.source).toEqual({ kind: 'file', path: join(home, '.env') })
  })

  it('test_only_the_NAME_is_read_from_the_file_never_the_value', () => {
    // The parsimony that keeps this from being a dotenv parser: provenance needs the set of declared
    // names, not their values. The value in play is always the one already in `env` — the loader
    // resolved interpolation, quoting and overrides long before we got here, and re-deriving it
    // would be a second, divergent answer to a question already settled.
    writeFileSync(join(home, '.env'), 'OPENAI_API_KEY=stale-value-in-file\n', 'utf8')
    const resolved = resolveCredential({
      env: { OPENAI_API_KEY: 'sk-live' },
      home,
      providers: PROVIDERS,
    })
    expect(resolved?.apiKey).toBe('sk-live')
    expect(resolved?.source).toMatchObject({ kind: 'file' })
  })

  it('test_a_commented_out_declaration_does_not_claim_provenance', () => {
    // `# OPENAI_API_KEY=old` is a line an operator leaves behind. Attributing the live shell value to
    // it would send them to edit a comment.
    writeFileSync(join(home, '.env'), '# OPENAI_API_KEY=old\n', 'utf8')
    const resolved = resolveCredential({
      env: { OPENAI_API_KEY: 'sk-live' },
      home,
      providers: PROVIDERS,
    })
    expect(resolved?.source).toEqual({ kind: 'env', varName: 'OPENAI_API_KEY' })
  })

  it('test_an_export_prefix_still_counts_as_a_declaration', () => {
    // `export FOO=bar` is valid in the `.env` files people actually write.
    writeFileSync(join(home, '.env'), 'export OPENAI_API_KEY=sk-x\n', 'utf8')
    const resolved = resolveCredential({
      env: { OPENAI_API_KEY: 'sk-x' },
      home,
      providers: PROVIDERS,
    })
    expect(resolved?.source).toMatchObject({ kind: 'file' })
  })

  it('test_a_missing_dotenv_file_is_not_an_error', () => {
    const resolved = resolveCredential({
      env: { OPENAI_API_KEY: 'sk-x' },
      home,
      providers: PROVIDERS,
    })
    expect(resolved?.source).toEqual({ kind: 'env', varName: 'OPENAI_API_KEY' })
  })
})

describe('the model prefix must agree with the provider', () => {
  it('test_a_matching_prefix_resolves_and_is_NOT_marked_inferred', () => {
    const resolved = resolveCredential({
      env: { OPENAI_API_KEY: 'sk-x' },
      model: 'openai/gpt-5',
      providers: PROVIDERS,
    })
    expect(resolved).toMatchObject({ provider: 'openai', inferred: false })
  })

  it('test_no_prefix_means_the_provider_was_INFERRED_from_precedence', () => {
    // The bit that tells a caller whether the user chose the provider or the resolver did. Without
    // it, "why is it calling Anthropic?" has no answer in the data.
    const resolved = resolveCredential({
      env: { ANTHROPIC_API_KEY: 'sk-x' },
      model: 'some-model',
      providers: PROVIDERS,
    })
    expect(resolved).toMatchObject({ provider: 'anthropic', inferred: true })
  })

  it('test_a_prefix_naming_a_provider_with_NO_credential_fails_typed', () => {
    // The consumer has this check; the framework did not. Silently falling back to another provider
    // sends the request to a model the user did not ask for — and bills them for it.
    expect(() =>
      resolveCredential({
        env: { ANTHROPIC_API_KEY: 'sk-x' },
        model: 'openai/gpt-5',
        providers: PROVIDERS,
      }),
    ).toThrow(ProviderPrefixMismatchError)
  })

  it('test_the_mismatch_message_names_BOTH_sides_and_what_to_do', () => {
    const error = (() => {
      try {
        resolveCredential({
          env: { ANTHROPIC_API_KEY: 'sk-x' },
          model: 'openai/gpt-5',
          providers: PROVIDERS,
        })
        return undefined
      } catch (e) {
        return e as Error
      }
    })()
    expect(error?.message).toMatch(/openai/)
    expect(error?.message).toMatch(/OPENAI_API_KEY/)
  })

  it('test_an_UNKNOWN_prefix_is_not_treated_as_a_provider_claim', () => {
    // `meta-llama/llama-3` is a model id whose first segment is not a provider in the list. Reading
    // every slash as a provider claim would refuse perfectly good model ids.
    const resolved = resolveCredential({
      env: { OPENROUTER_API_KEY: 'sk-or' },
      model: 'meta-llama/llama-3',
      providers: PROVIDERS,
    })
    expect(resolved).toMatchObject({ provider: 'openrouter', inferred: true })
  })
})
