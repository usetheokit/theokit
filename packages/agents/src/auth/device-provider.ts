import type {
  CredentialStoreConfig,
  DeviceDeps,
  OAuthProviderConfig,
  OAuthTokens,
  OpenAIDeviceConfig,
} from '@theokit/sdk/auth'
import { openaiDeviceLogin } from '@theokit/sdk/auth'

import { AuthProvider } from './auth-provider.js'

/**
 * M111 — device auth plug-and-play: a provider is an object with LABELLED methods, and a login fits
 * in one call.
 *
 * ## The problem, measured
 *
 * M110 made the RFC 8628 device flow cross this layer. It did not touch the ergonomics: to
 * authenticate against Codex, the consumer had to know that **two** device-flow shapes exist, copy a
 * `clientId` and three OpenAI URLs into its own code, assemble `{ fetch, sleep, now }`, call
 * `deviceLogin` and **remember** to call `persist` — and forgetting the last one costs a full OAuth
 * round-trip that stores nothing. The `AuthProvider` docblock instructed exactly that:
 * *"the caller persists them via `AuthProvider.persist`"*.
 *
 * ## The shape, and the discriminant that was rejected
 *
 * `loginWithDevice` returns `()` — nothing comes out for the caller to persist, and the two granular
 * halves stay public. A provider is an object with `methods: [{ label, type, authorize }]`, and the
 * label is what the UI shows: it turns a protocol choice into a choice between readable phrases.
 *
 * **REJECTED — a `kind` discriminant.** `type` classifies the **kind of credential**, not the
 * protocol: a browser method and a headless one can both be `type: 'oauth'`. A `kind` with internal
 * dispatch would be a `switch`, exactly the defect this milestone removes from the consumer. Here,
 * each method points at **its own** function.
 *
 * ## Why the public identity lives HERE
 *
 * The client identity belongs beside the flow that uses it rather than in the consumer, so a surface
 * cannot hold a stale copy of it.
 *
 */

/**
 * A labelled way of obtaining a credential within a provider.
 *
 * A DISCRIMINATED UNION, not an optional `authorize?` field. With an optional field,
 * `{ label, type: 'oauth' }` would be representable — an OAuth method that cannot authorize,
 * detected only at runtime, in the middle of the user's login. It is the alternative M110 already
 * rejected in writing when it refused "one type with optional fields": it would make an invalid
 * config representable and move detection out of the compiler
 * para o runtime.
 */
export type AuthMethod =
  | {
      /** What the interface shows the user. The piece that makes the flow choosable without knowing the protocol. */
      readonly label: string
      readonly type: 'oauth'
      /** THIS method's function. No discriminant: the method points at its own, not at a `switch`. */
      readonly authorize: (deps: DeviceDeps, hooks: PromptHooks) => Promise<OAuthTokens>
    }
  | {
      readonly label: string
      readonly type: 'api'
    }

/** What the consumer wires into its UI to show the code the user types on the other device. */
export interface PromptHooks {
  onPrompt: (p: { userCode: string; verificationUri: string; expiresIn?: number }) => void
}

/** An authentication provider: public identity + the labelled ways of authenticating with it. */
export interface DeviceAuthProvider {
  readonly name: string
  readonly oauth: OAuthProviderConfig
  readonly methods: readonly AuthMethod[]
}

/** PUBLIC identifiers of OpenAI's Codex CLI (published in OpenCode's MIT source). Not secrets. */
const CODEX_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'
const CODEX_ISSUER = 'https://auth.openai.com'

/**
 * Environment override for `clientId`. It dissolves the false dilemma between a fixed constant
 * (inflexible) and a mandatory parameter (which hands the copy back to the consumer): a default in
 * the package, an escape for whoever needs one.
 */
export const CODEX_CLIENT_ID_ENV_VAR = 'THEOKIT_CODEX_CLIENT_ID'

const CODEX_OAUTH: OAuthProviderConfig = {
  provider: 'openai',
  clientId: process.env[CODEX_CLIENT_ID_ENV_VAR] ?? CODEX_CLIENT_ID,
  authorizeEndpoint: `${CODEX_ISSUER}/oauth/authorize`,
  tokenEndpoint: `${CODEX_ISSUER}/oauth/token`,
  scopes: ['openid', 'profile', 'email', 'offline_access'],
  redirectUri: `${CODEX_ISSUER}/deviceauth/callback`,
}

/**
 * OpenAI's device-flow config — **two** endpoints, with PKCE. It is the NON-standard variant, which
 * is why it does not merge with `DeviceOAuthConfig` (RFC 8628, **one** endpoint).
 */
const CODEX_DEVICE: OpenAIDeviceConfig = {
  ...CODEX_OAUTH,
  deviceUsercodeEndpoint: `${CODEX_ISSUER}/api/accounts/deviceauth/usercode`,
  devicePollEndpoint: `${CODEX_ISSUER}/api/accounts/deviceauth/token`,
  verificationUri: `${CODEX_ISSUER}/codex/device`,
}

/**
 * The Codex provider, assembled and **frozen**.
 *
 * Frozen because it is a public identity SHARED across the process: a consumer that mutated it
 * would change everyone else's login. `Object.freeze` is shallow, so the method list is frozen
 * separately — without that, `CODEX_PROVIDER.methods.push(...)` would go through.
 */
export const CODEX_PROVIDER: DeviceAuthProvider = Object.freeze({
  name: 'openai',
  oauth: Object.freeze(CODEX_OAUTH),
  methods: Object.freeze([
    Object.freeze({
      label: 'ChatGPT Pro/Plus (headless device code)',
      type: 'oauth' as const,
      // Points at OpenAI's variant. An RFC 8628 provider would point at `deviceLogin`, and that is
      // how the two shapes coexist with no discriminant.
      authorize: (deps: DeviceDeps, hooks: PromptHooks): Promise<OAuthTokens> =>
        openaiDeviceLogin(CODEX_DEVICE, deps, hooks),
    }),
    Object.freeze({
      label: 'Manually enter API Key',
      type: 'api' as const,
    }),
  ]),
})

/**
 * Facade options. `deps` and `env` travel together in one object rather than as two positional
 * parameters: both are optional and rarely used, and six positionals is a signature callers get
 * wrong in silence (the monorepo lint enforces 5 as the ceiling — the ceiling exists for this reason).
 */
interface LoginWithDeviceOptions {
  /** I/O injection for tests. Omitted, it uses the real `fetch`/`setTimeout`/`Date.now`. */
  readonly deps?: Partial<DeviceDeps>
  /** The environment the store reads to resolve the credential directory. */
  readonly env?: Record<string, string | undefined>
}

/** Defaults for the I/O deps. `deps` is optional on the ergonomic surface; injection is for tests. */
function comDefaults(deps?: Partial<DeviceDeps>): DeviceDeps {
  return {
    fetch: deps?.fetch ?? fetch,
    sleep: deps?.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))),
    now: deps?.now ?? Date.now,
  }
}

/**
 * Authorizes **and** persists, in one call. Returns where the credential landed and the account it
 * was attributed to — **never** token material.
 *
 * Nothing comes out for the caller, so there is no step it can forget. The two halves stay public on
 * `AuthProvider` (`deviceLogin` / `persist`) for whoever needs the granularity, alongside this
 * facade.
 *
 * It delegates verbatim: `method.authorize` runs the flow and `AuthProvider.persist` writes. Copying
 * the sequence instead of calling it would create a second oracle over the same fact, and two oracles
 * diverge on the first fix applied to only one side.
 */
export async function loginWithDevice(
  provider: DeviceAuthProvider,
  method: AuthMethod,
  store: CredentialStoreConfig,
  hooks: PromptHooks,
  opts: LoginWithDeviceOptions = {},
): Promise<{ path: string; accountId?: string }> {
  // VALIDATION AT THE BOUNDARY, before any I/O. The three refusals below happen without touching the
  // network and without touching the disk: failing after writing would leave a partial credential,
  // and the next run would read a state that was never valid.
  if (provider.methods.length === 0) {
    throw new TypeError(
      `provider "${provider.name}" declares no authentication method — there is nothing to choose`,
    )
  }
  if (!provider.methods.includes(method)) {
    throw new TypeError(`method "${method.label}" does not belong to provider "${provider.name}"`)
  }
  if (method.type !== 'oauth') {
    throw new TypeError(
      `method "${method.label}" is an api-key method, not a device method — use the api-key path`,
    )
  }

  const tokens = await method.authorize(comDefaults(opts.deps), hooks)
  const path = new AuthProvider(provider.oauth, store).persist(provider.name, tokens, opts.env)
  // The return carries NO token: the consumer needs to know where it landed and whose it is, not the secret.
  return tokens.accountId === undefined ? { path } : { path, accountId: tokens.accountId }
}
