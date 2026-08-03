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
 * M111 — device auth plug-and-play: um provider é um objeto com métodos ROTULADOS, e um login cabe
 * numa chamada.
 *
 * ## O problema, medido
 *
 * O M110 fez o device flow RFC 8628 atravessar esta camada. Ele não tocou a ergonomia: para
 * autenticar no Codex, o consumidor precisava saber que existem **duas** formas de device flow,
 * copiar um `clientId` e três URLs da OpenAI para dentro do próprio código, montar
 * `{ fetch, sleep, now }`, chamar `deviceLogin` e **lembrar** de chamar `persist` — e esquecer o
 * último custa um round-trip OAuth completo que não guarda nada. O docblock de `AuthProvider`
 * instruía exatamente isso: *"the caller persists them via `AuthProvider.persist`"*.
 *
 * ## O desenho veio de medição contra três peers, e refutou a proposta original
 *
 * - **`codex`** — `codex-rs/login/src/device_code_auth.rs:234` tem `run_device_code_login`, que
 *   retorna `()`: **nada** sai para o chamador persistir, e as duas metades granulares continuam
 *   públicas. `loginWithDevice` é a cópia dessa forma.
 * - **`opencode`** — cada provider é um objeto com `methods: [{ label, type, authorize }]`, e três
 *   providers escritos por autores diferentes convergem em **3 métodos rotulados** cada. O rótulo é o
 *   que a UI mostra: transforma escolha de protocolo em escolha de frase legível.
 * - **REJEITADO — discriminante `kind`.** Nenhum dos três discrimina protocolo por campo. A medição
 *   que fecha o caso: no `opencode`, browser e headless do Codex carregam o **mesmo** `type: 'oauth'`
 *   — logo o `type` classifica **espécie de credencial**, não protocolo. Um `kind` com despacho
 *   interno seria um `switch`, exatamente o defeito que este milestone remove do consumidor.
 *   Aqui, cada método aponta para a **sua própria** função.
 *
 * ## Por que a identidade pública mora AQUI
 *
 * `codex` exporta `CLIENT_ID` do crate que implementa o flow (`login/src/lib.rs:32`) e o CLI o
 * **importa**; o `opencode` o declara dentro do plugin. Os dois chegaram ao mesmo lugar
 * independentemente — e com o mesmo valor que o consumidor tinha copiado. Enquanto morasse no
 * consumidor, todo projeto que quisesse Codex copiaria quatro constantes públicas: é violação de DRY
 * através da fronteira, com dois donos do mesmo fato.
 */

/**
 * Uma forma rotulada de obter credencial dentro de um provider.
 *
 * UNIÃO DISCRIMINADA, não um campo `authorize?` opcional. Com opcional, `{ label, type: 'oauth' }`
 * seria representável — um método OAuth que não sabe autorizar, detectado só em runtime, no meio do
 * login do usuário. É a alternativa que o M110 já rejeitou por escrito ao recusar "um tipo só com
 * campos opcionais": tornaria representável um config inválido e moveria a detecção do compilador
 * para o runtime.
 */
export type AuthMethod =
  | {
      /** O que a interface mostra ao usuário. É a peça que torna o fluxo escolhível sem saber o protocolo. */
      readonly label: string
      readonly type: 'oauth'
      /** A função DESTE método. Sem discriminante: o método aponta para a sua, não para um `switch`. */
      readonly authorize: (deps: DeviceDeps, hooks: PromptHooks) => Promise<OAuthTokens>
    }
  | {
      readonly label: string
      readonly type: 'api'
    }

/** O que o consumidor liga à sua UI para mostrar o código que o usuário digita no outro dispositivo. */
export interface PromptHooks {
  onPrompt: (p: { userCode: string; verificationUri: string; expiresIn?: number }) => void
}

/** Um provider de autenticação: identidade pública + as formas rotuladas de autenticar nele. */
export interface DeviceAuthProvider {
  readonly name: string
  readonly oauth: OAuthProviderConfig
  readonly methods: readonly AuthMethod[]
}

/** Identificadores PÚBLICOS do Codex CLI da OpenAI (publicados na fonte MIT do OpenCode). Não são segredo. */
const CODEX_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'
const CODEX_ISSUER = 'https://auth.openai.com'

/**
 * Override do `clientId` por ambiente — adotado do `codex`, que exporta `CLIENT_ID` **e**
 * `CLIENT_ID_OVERRIDE_ENV_VAR` (`login/src/lib.rs:32-33`). Dissolve o falso dilema entre constante
 * fixa (inflexível) e parâmetro obrigatório (que devolve a cópia ao consumidor): default no pacote,
 * escape para quem precisa.
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
 * A config do device flow da OpenAI — **dois** endpoints, com PKCE. É a variante NÃO-padrão, e é por
 * isso que ela não se funde com `DeviceOAuthConfig` (RFC 8628, **um** endpoint).
 */
const CODEX_DEVICE: OpenAIDeviceConfig = {
  ...CODEX_OAUTH,
  deviceUsercodeEndpoint: `${CODEX_ISSUER}/api/accounts/deviceauth/usercode`,
  devicePollEndpoint: `${CODEX_ISSUER}/api/accounts/deviceauth/token`,
  verificationUri: `${CODEX_ISSUER}/codex/device`,
}

/**
 * O provider do Codex, montado e **congelado**.
 *
 * Congelado porque é identidade pública COMPARTILHADA no processo: um consumidor que a mutasse
 * mudaria o login de todos os outros. `Object.freeze` é raso, então a lista de métodos é congelada
 * separadamente — sem isso, `CODEX_PROVIDER.methods.push(...)` passaria.
 */
export const CODEX_PROVIDER: DeviceAuthProvider = Object.freeze({
  name: 'openai',
  oauth: Object.freeze(CODEX_OAUTH),
  methods: Object.freeze([
    Object.freeze({
      label: 'ChatGPT Pro/Plus (headless device code)',
      type: 'oauth' as const,
      // Aponta para a variante da OpenAI. Um provider RFC 8628 apontaria para `deviceLogin`, e é
      // assim que as duas formas coexistem sem discriminante.
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
 * Opções do Facade. `deps` e `env` viajam juntos num objeto em vez de dois parâmetros posicionais:
 * ambos são opcionais e raramente usados, e seis posicionais é assinatura que o chamador erra em
 * silêncio (o lint do monorepo cobra 5 como teto — o teto existe por este motivo).
 */
export interface LoginWithDeviceOptions {
  /** Injeção de I/O para teste. Omitido, usa `fetch`/`setTimeout`/`Date.now` reais. */
  readonly deps?: Partial<DeviceDeps>
  /** Ambiente lido pelo store para resolver o diretório da credencial. */
  readonly env?: Record<string, string | undefined>
}

/** Defaults das deps de I/O. `deps` é opcional na superfície ergonômica; a injeção fica para o teste. */
function comDefaults(deps?: Partial<DeviceDeps>): DeviceDeps {
  return {
    fetch: deps?.fetch ?? fetch,
    sleep: deps?.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))),
    now: deps?.now ?? Date.now,
  }
}

/**
 * Autoriza **e** persiste, numa chamada. Devolve onde a credencial ficou e a conta atribuída —
 * **nunca** material de token.
 *
 * A forma vem de `run_device_code_login` (`codex`), que retorna `()`: se nada sai para o chamador,
 * não há passo que ele possa esquecer. As duas metades continuam públicas em `AuthProvider`
 * (`deviceLogin` / `persist`) para quem precisa da granularidade — mesma escolha que o `codex` faz ao
 * manter `request_device_code` e `complete_device_code_login` públicas ao lado do Facade.
 *
 * Delega verbatim: `method.authorize` roda o flow e `AuthProvider.persist` grava. Copiar a sequência
 * em vez de chamá-la criaria um segundo oráculo sobre o mesmo fato, e dois oráculos divergem no
 * primeiro fix aplicado a um lado só.
 */
export async function loginWithDevice(
  provider: DeviceAuthProvider,
  method: AuthMethod,
  store: CredentialStoreConfig,
  hooks: PromptHooks,
  opts: LoginWithDeviceOptions = {},
): Promise<{ path: string; accountId?: string }> {
  // VALIDAÇÃO NA FRONTEIRA, antes de qualquer I/O. As três recusas abaixo acontecem sem tocar a rede
  // e sem tocar o disco: falhar depois de gravar deixaria credencial parcial, e a próxima execução
  // leria um estado que nunca foi válido.
  if (provider.methods.length === 0) {
    throw new TypeError(
      `o provider "${provider.name}" declara nenhum método de autenticação — não há o que escolher`,
    )
  }
  if (!provider.methods.includes(method)) {
    throw new TypeError(`o método "${method.label}" não pertence ao provider "${provider.name}"`)
  }
  if (method.type !== 'oauth') {
    throw new TypeError(
      `o método "${method.label}" é de chave (api key), não é um método de device — use o caminho de chave`,
    )
  }

  const tokens = await method.authorize(comDefaults(opts.deps), hooks)
  const path = new AuthProvider(provider.oauth, store).persist(provider.name, tokens, opts.env)
  // O retorno NÃO carrega token: o consumidor precisa saber onde ficou e de quem é, não o segredo.
  return tokens.accountId === undefined ? { path } : { path, accountId: tokens.accountId }
}
