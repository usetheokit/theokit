import {
  authFilePath,
  ensureFreshCredential,
  openaiDeviceLogin,
  persistOAuthTokens,
  readStoredOAuth,
} from '@theokit/sdk/auth'
import type {
  CredentialStoreConfig,
  OAuthProviderConfig,
  OAuthTokens,
  OpenAIDeviceConfig,
  ResolvedCredential,
} from '@theokit/sdk/auth'
import { withFileLock } from '@theokit/sdk/persistence'

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
  async ensureFresh(
    resolved: ResolvedCredential,
    deps: EnsureFreshHttpDeps,
    env?: Record<string, string | undefined>,
  ): Promise<ResolvedCredential> {
    if (resolved.kind !== 'oauth') {
      // Chave de API não expira: nenhum lock, nenhuma releitura, nenhum I/O. Manter o caminho quente
      // livre é o que torna o resolvedor por-run barato (M74, Risco 1).
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- `CredentialStoreConfig` do subpath /auth resolve sob tsc; o projeto type-aware do eslint o lê como error-typed.
      return ensureFreshCredential(resolved, { config: this.config, store: this.store, env }, deps)
    }

    const caminho: string = authFilePath(this.store, env)

    // SINGLE-FLIGHT in-process, ANTES do lock (M74, EC-2 do edge-case review).
    //
    // `withFileLock` (proper-lockfile) NÃO é reentrante: se uma run começar de dentro de um contexto
    // que já segura o lock — uma run aninhada, ou um time disparando membros enquanto o pai refresca —
    // a segunda aquisição espera até o timeout e o sintoma é "a run travou", sem erro nenhum. Com o
    // resolvedor por-run do M74 isso deixa de ser hipotético: `ensureFresh` passa a ser chamado de
    // dentro do stream. A promise em voo faz a reentrância resolver por composição, não por lock.
    const emVoo = AuthProvider.refreshEmVoo.get(caminho)
    if (emVoo !== undefined) return emVoo

    const promessa = this.refrescarSobLock(caminho, resolved, deps, env)
    AuthProvider.refreshEmVoo.set(caminho, promessa)
    try {
      return await promessa
    } finally {
      AuthProvider.refreshEmVoo.delete(caminho)
    }
  }

  /** Refresh em voo por caminho de store — a chave é o arquivo, não a instância. */
  private static readonly refreshEmVoo = new Map<string, Promise<ResolvedCredential>>()

  /**
   * O refresh propriamente dito, serializado entre PROCESSOS e com re-leitura.
   *
   * A re-leitura não é detalhe: sem ela o lock apenas serializa, e o segundo processo decide com o
   * estado que leu ANTES de esperar — refrescando de novo e invalidando o token que o primeiro acabou
   * de gravar. É o double-checked locking clássico, e é o que o teste de dois processos pega.
   */
  private refrescarSobLock(
    caminho: string,
    resolved: ResolvedCredential,
    deps: EnsureFreshHttpDeps,
    env?: Record<string, string | undefined>,
  ): Promise<ResolvedCredential> {
    /* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- os subpaths `/auth` e `/persistence` do SDK resolvem sob tsc (typecheck da raiz limpo); o projeto type-aware do eslint os lê como error-typed. Mesma nota que este arquivo já carregava para `CredentialStoreConfig`. */
    return withFileLock(caminho, async () => {
      // RE-LEITURA depois de adquirir o lock: outro processo pode ter refrescado enquanto esperávamos.
      const doDisco = readStoredOAuth(this.store, env)
      const atual =
        doDisco !== undefined
          ? { ...resolved, apiKey: doDisco.access, expiresAt: doDisco.expires }
          : resolved
      return await ensureFreshCredential(
        atual,
        { config: this.config, store: this.store, env },
        deps,
      )
    }) as Promise<ResolvedCredential>
    /* eslint-enable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
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
