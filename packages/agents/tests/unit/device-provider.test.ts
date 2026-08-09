import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  CODEX_PROVIDER,
  deviceLogin,
  loginWithDevice,
  openaiDeviceLogin,
  type AuthMethod,
  type CredentialStoreConfig,
  type DeviceAuthProvider,
} from '../../src/auth-entry.js'

/**
 * M111 — device auth plug-and-play: a provider is an object with LABELLED methods, and a login fits
 * in one call.
 *
 * ## What this file proves
 *
 * M110 made RFC 8628 **reachable**. It did not touch the ergonomics: to authenticate against Codex,
 * the consumer had to know that two device-flow shapes exist, copy a `clientId` and three OpenAI
 * URLs, assemble `{fetch, sleep, now}`, call `deviceLogin` and **remember** to call `persist`.
 * Forgetting the last one costs a full OAuth round-trip that stores nothing.
 *
 * ## The decisions these assertions pin
 *
 * M111's discovery measured three peers (`codex`, `opencode`, `gemini-cli`) and **rejected** part of
 * the original proposal:
 *
 * - **Rejected — a `kind` discriminant.** None of the three discriminates protocol by field. The
 *   measurement that closes the case: in `opencode`, Codex's browser and headless methods carry the
 *   **same** `type: "oauth"` (3 `oauth` + 1 `api` in the file), so `type` classifies the **kind of
 *   credential**, not the protocol. A `kind` with internal dispatch would be the `switch` this
 *   milestone exists to remove. Each method points at **its own** function;
 *   `test_the_two_shapes_are_NOT_the_same_function` fails on a merge.
 * - **Confirmed — the facade.** `codex/codex-rs/login/src/device_code_auth.rs:234` has
 *   `run_device_code_login`, which returns `()` — nothing comes out for the caller to persist — and
 *   keeps both halves public. `loginWithDevice` copies that shape.
 * - **Confirmed — the identity lives with the flow.** `codex` exports `CLIENT_ID` from the crate that
 *   implements it (`login/src/lib.rs:32`) and the CLI **imports** it; `opencode` declares it inside
 *   the plugin. Both, independently, and with the same value the consumer had copied.
 *
 * ## Why `AuthMethod` is a discriminated union and not an optional field
 *
 * An optional `authorize?:` would make `{ label, type: 'oauth' }` representable — an OAuth method
 * that cannot authorize, detected only at runtime, in the middle of the user's login. It is exactly
 * the alternative M110's blueprint had already rejected in writing. The union bars it at the compiler.
 */
describe('M111 — a provider with labelled methods', () => {
  let home: string

  const store = (): CredentialStoreConfig => ({
    home,
    dirName: '.m111',
    fileName: 'auth.json',
    homeEnvVar: 'M111_HOME',
  })

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'm111-'))
  })
  afterEach(() => {
    rmSync(home, { recursive: true, force: true })
  })

  it('test_floor_the_layer_publishes_the_M111_symbols', () => {
    // ANTI-VACUITY FLOOR: without it, an import resolving to `undefined` would make the assertions
    // below fail for the wrong reason, and a test failing for the wrong reason cannot tell "the layer
    // does not expose it" from "the provider is badly assembled".
    expect(typeof loginWithDevice, '`loginWithDevice` does not cross the layer').toBe('function')
    expect(CODEX_PROVIDER, '`CODEX_PROVIDER` does not cross the layer').toBeDefined()
  })

  it('test_CODEX_PROVIDER_is_frozen_and_carries_the_public_identity', () => {
    // Frozen because it is a SHARED public identity: a consumer that mutated it would change
    // everyone else's login in the same process.
    expect(Object.isFrozen(CODEX_PROVIDER), 'the provider is not frozen').toBe(true)
    expect(Object.isFrozen(CODEX_PROVIDER.methods), 'the method list is not frozen').toBe(true)
    // The identity that USED to live in the consumer (agent-builder) — the milestone's D2 defect.
    expect(CODEX_PROVIDER.oauth.clientId, 'the public clientId does not cross').toBe(
      'app_EMoamEEZ73f0CkXaXp7hrann',
    )
    expect(CODEX_PROVIDER.oauth.provider).toBe('openai')
  })

  it('test_the_methods_are_LABELLED_and_cover_oauth_and_api_key', () => {
    // The label is what closes the request that opened the milestone: it turns a protocol choice into
    // a choice between readable phrases. All three peers converge on labelled methods.
    const labels = CODEX_PROVIDER.methods.map((m) => m.label)
    expect(labels.length, 'the provider declares no methods').toBeGreaterThanOrEqual(2)
    for (const l of labels)
      expect(l.length, 'a method with no label is invisible in the UI').toBeGreaterThan(0)
    expect(
      CODEX_PROVIDER.methods.some((m) => m.type === 'oauth'),
      'no OAuth method — the device login disappeared',
    ).toBe(true)
    expect(
      CODEX_PROVIDER.methods.some((m) => m.type === 'api'),
      'no api-key method — the TUI would keep saying "use an API key" without offering a path',
    ).toBe(true)
  })

  it('test_every_oauth_method_HAS_authorize_and_the_api_key_one_does_NOT', () => {
    // The runtime half of the discriminated union. The compiler bars `{label, type:'oauth'}`; this
    // assertion bars the same defect arriving through untyped JS.
    for (const m of CODEX_PROVIDER.methods) {
      if (m.type === 'oauth') {
        expect(typeof m.authorize, `método oauth "${m.label}" sem authorize`).toBe('function')
      } else {
        expect('authorize' in m, `api method "${m.label}" must not carry authorize`).toBe(false)
      }
    }
  })

  it('test_the_two_shapes_are_NOT_the_same_function', () => {
    // Merging would break Codex: RFC 8628 has ONE `deviceCodeEndpoint`; OpenAI's variant has TWO
    // (`deviceUsercodeEndpoint` → `devicePollEndpoint`, with PKCE). This fails if somebody "simplifies".
    expect(typeof deviceLogin).toBe('function')
    expect(typeof openaiDeviceLogin).toBe('function')
    expect(
      deviceLogin as unknown,
      "the standard flow and OpenAI's became the same reference — the protocols differ",
    ).not.toBe(openaiDeviceLogin as unknown)
  })

  it('test_loginWithDevice_persists_and_returns_a_PATH_never_a_token', async () => {
    // The facade: one call. The test does NOT call `persist` — if the credential is not on disk at
    // the end, the facade is not a facade.
    const metodo: AuthMethod = {
      label: 'sintético',
      type: 'oauth',
      authorize: async () => ({
        access: 'ACCESS-TOKEN',
        refresh: 'TOKEN-REFRESH',
        expires: 1_700_000_000_000,
        accountId: 'account-1',
      }),
    }
    const provider: DeviceAuthProvider = {
      name: 'sintetico',
      oauth: CODEX_PROVIDER.oauth,
      methods: [metodo],
    }

    const r = await loginWithDevice(provider, metodo, store(), { onPrompt: () => {} })

    expect(r.path, 'the facade did not return the path').toContain('auth.json')
    expect(
      existsSync(r.path),
      'the credential was not persisted — the consumer would have to call persist',
    ).toBe(true)
    expect(r.accountId).toBe('account-1')
    // Token material NEVER leaves in the return — neither as a key nor as a value.
    const serialized = JSON.stringify(r)
    expect(serialized, 'the return leaked the access token').not.toContain('ACCESS-TOKEN')
    expect(serialized, 'the return leaked the refresh token').not.toContain('REFRESH-TOKEN')
    // …but the disk DOES have the token: without this assertion, "it did not leak" would be satisfied
    // by persisting nothing at all.
    expect(readFileSync(r.path, 'utf8'), 'the token never reached the store').toContain(
      'ACCESS-TOKEN',
    )
  })

  it('test_omitting_deps_uses_the_defaults', async () => {
    // ADR-5: `deps` is optional. None of the three peers requires deps on the happy path; injection
    // is for tests. This call does not pass the 5th argument.
    const metodo: AuthMethod = {
      label: 'sintético',
      type: 'oauth',
      authorize: async () => ({ access: 'A', refresh: 'R', expires: 1 }),
    }
    const provider: DeviceAuthProvider = {
      name: 's',
      oauth: CODEX_PROVIDER.oauth,
      methods: [metodo],
    }
    await expect(
      loginWithDevice(provider, metodo, store(), { onPrompt: () => {} }),
    ).resolves.toBeDefined()
  })

  it('test_NEGATIVE_a_method_from_ANOTHER_provider_fails_typed_and_writes_nothing', async () => {
    // The signature accepts `provider` and `method` independently; nothing structural stops passing a
    // method the provider does not declare. Validate at the boundary — and prove the store stays
    // untouched, because failing AFTER writing is worse than failing.
    const foreign: AuthMethod = {
      label: 'from another provider',
      type: 'oauth',
      authorize: async () => ({ access: 'X', refresh: 'Y', expires: 1 }),
    }
    const provider: DeviceAuthProvider = {
      name: 'sintetico',
      oauth: CODEX_PROVIDER.oauth,
      methods: [{ label: 'the only one it has', type: 'api' }],
    }
    const s = store()
    await expect(loginWithDevice(provider, foreign, s, { onPrompt: () => {} })).rejects.toThrow(
      /does not belong/i,
    )
    expect(existsSync(join(home, '.m111', 'auth.json')), 'wrote a credential despite failing').toBe(
      false,
    )
  })

  it('test_NEGATIVE_an_API_KEY_method_is_refused_by_the_device_facade', async () => {
    // The compiler already bars this on the typed side (a discriminated union); this is the guard for
    // whoever arrives through untyped JS. A `type:'api'` method has no `authorize` — calling the
    // facade with it must fail CLEARLY, not with `authorize is not a function`.
    const credKey = { label: 'Manually enter API Key', type: 'api' as const }
    const provider: DeviceAuthProvider = {
      name: 's',
      oauth: CODEX_PROVIDER.oauth,
      methods: [credKey],
    }
    await expect(
      loginWithDevice(provider, credKey as unknown as AuthMethod, store(), { onPrompt: () => {} }),
    ).rejects.toThrow(/api key|not a device method/i)
  })

  it('test_NEGATIVE_a_provider_with_NO_methods_fails_clearly_instead_of_returning_an_empty_list', async () => {
    // A provider with no methods renders a blank choice, which the user reads as a hang.
    const empty: DeviceAuthProvider = { name: 'empty', oauth: CODEX_PROVIDER.oauth, methods: [] }
    const anything: AuthMethod = {
      label: 'x',
      type: 'oauth',
      authorize: async () => ({ access: 'A', refresh: 'R', expires: 1 }),
    }
    await expect(loginWithDevice(empty, anything, store(), { onPrompt: () => {} })).rejects.toThrow(
      /declares no authentication method/i,
    )
  })

  it('test_NEGATIVE_an_authorize_failure_propagates_and_nothing_is_written', async () => {
    // Failing AFTER writing would leave a partial credential on disk, and the next run would read a
    // state that was never valid.
    const broken: AuthMethod = {
      label: 'broken',
      type: 'oauth',
      authorize: () => Promise.reject(new Error('device endpoint returned HTTP 401')),
    }
    const provider: DeviceAuthProvider = {
      name: 's',
      oauth: CODEX_PROVIDER.oauth,
      methods: [broken],
    }
    await expect(
      loginWithDevice(provider, broken, store(), { onPrompt: () => {} }),
    ).rejects.toThrow(/401/)
    expect(
      existsSync(join(home, '.m111', 'auth.json')),
      'wrote a credential despite the error',
    ).toBe(false)
  })

  it('test_the_environment_clientId_override_WORKS_and_only_at_load', async () => {
    // The review's MEDIUM-4: `CODEX_CLIENT_ID_ENV_VAR` was exported public API, documented across five
    // lines, with ZERO tests — removing the `process.env[…] ??` kept everything green. A knob with no
    // oracle is indistinguishable from a knob that does not work.
    //
    // The read happens at MODULE evaluation, so `vi.resetModules()` is what makes the test possible —
    // and that is exactly the limitation the consumer needs to know: setting the variable after the
    // import has no effect at all.
    const { CODEX_CLIENT_ID_ENV_VAR } = await import('../../src/auth-entry.js')
    const anterior = process.env[CODEX_CLIENT_ID_ENV_VAR]
    process.env[CODEX_CLIENT_ID_ENV_VAR] = 'app_FROM_ANOTHER_TENANT'
    try {
      vi.resetModules()
      const reloaded = (await import('../../src/auth/device-provider.js')) as {
        CODEX_PROVIDER: { oauth: { clientId: string } }
      }
      expect(
        reloaded.CODEX_PROVIDER.oauth.clientId,
        'the environment override had no effect — the knob is decorative',
      ).toBe('app_FROM_ANOTHER_TENANT')
    } finally {
      // `vi.stubEnv` / restoration by assignment instead of a `delete` with a computed key: the
      // monorepo rule forbids the dynamic `delete`, and an empty string is indistinguishable from
      // absent for the
      // `??` que lê o knob.
      process.env[CODEX_CLIENT_ID_ENV_VAR] = anterior ?? ''
      vi.resetModules()
    }
  })
})
