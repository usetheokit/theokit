import { ensureFreshCredential, openaiDeviceLogin, persistOAuthTokens } from '@theokit/sdk/auth'
import type {
  CredentialStoreConfig,
  OAuthProviderConfig,
  OAuthTokens,
  OpenAIDeviceConfig,
  ResolvedCredential,
} from '@theokit/sdk/auth'

/**
 * M60 — `AuthProvider`, the OO contract that unifies the SDK's free OAuth-lifecycle functions
 * (`openaiDeviceLogin` → `persistOAuthTokens` → `ensureFreshCredential`). Those are stateful across a
 * SHARED `config` (`OAuthProviderConfig`) + `store` (`CredentialStoreConfig`); this class holds that
 * state so a consumer authors `new AuthProvider(config, store).persist(...)` / `.ensureFresh(...)`
 * instead of threading `config`/`store` through every call — the `SDK → Theokit → AgentBuilder`
 * boundary applied to the auth domain (ENRICH, per blueprint D2: auth carries orchestration + state).
 *
 * It DELEGATES, never reimplements (parsimony Rung 9): each method forwards verbatim to the SDK
 * function, so login → persist → refresh produces byte-identical state to calling the SDK directly.
 *
 * SECRET-SAFETY (hard rule): this class NEVER logs, stringifies, or otherwise surfaces token material.
 * Methods return exactly what the SDK returns and add no observability — a token is data that flows
 * through, never something this layer emits. The parity/secret tests pin both properties.
 */

/** The HTTP deps of `ensureFreshCredential` (`{ fetch, now }`) — typed off the SDK to avoid drift. */
type EnsureFreshHttpDeps = Parameters<typeof ensureFreshCredential>[2]
/** The device-flow deps + prompt hook of `openaiDeviceLogin` — typed off the SDK. */
type DeviceLoginDeps = Parameters<typeof openaiDeviceLogin>[1]
type DeviceLoginHooks = Parameters<typeof openaiDeviceLogin>[2]

export class AuthProvider {
  constructor(
    private readonly config: OAuthProviderConfig,
    private readonly store: CredentialStoreConfig,
  ) {}

  /**
   * Refresh a resolved credential if stale. Delegates to `ensureFreshCredential` with the held
   * `config` + `store`; `env` (for reading the store's env overrides) + the `{ fetch, now }` HTTP deps
   * thread through. Returns the fresh `ResolvedCredential` — never logs the rotated token.
   */
  ensureFresh(
    resolved: ResolvedCredential,
    deps: EnsureFreshHttpDeps,
    env?: Record<string, string | undefined>,
  ): Promise<ResolvedCredential> {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- `CredentialStoreConfig` (SDK `/auth` subpath) resolves under tsc (root typecheck is clean) but eslint's type-aware project reads `this.store` as error-typed; the assignment is type-safe per tsc.
    return ensureFreshCredential(resolved, { config: this.config, store: this.store, env }, deps)
  }

  /**
   * Run the headless OpenAI device-login flow. Delegates to `openaiDeviceLogin` (which JWT-extracts the
   * account id). `deviceConfig` is passed per-call because it is a distinct endpoint set from the
   * refresh `config`. Returns `OAuthTokens` — the caller persists them via {@link AuthProvider.persist}.
   */
  deviceLogin(
    deviceConfig: OpenAIDeviceConfig,
    deps: DeviceLoginDeps,
    hooks: DeviceLoginHooks,
  ): Promise<OAuthTokens> {
    return openaiDeviceLogin(deviceConfig, deps, hooks)
  }

  /**
   * Persist freshly-obtained tokens through the held `store`. Delegates to `persistOAuthTokens` and
   * returns the credential-file path (never the token). `env` selects the store's home override.
   */
  persist(provider: string, tokens: OAuthTokens, env?: Record<string, string | undefined>): string {
    return persistOAuthTokens(provider, tokens, this.store, env)
  }
}
