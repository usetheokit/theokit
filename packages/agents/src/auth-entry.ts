// M60 — `@theokit/agents/auth`: the OO auth contract. `AuthProvider` (ENRICH — it holds the shared
// `config`+`store` state and delegates to the SDK's free OAuth-lifecycle functions), plus the auth
// domain's types re-exported so a consumer types the whole surface from the Theokit layer, never
// reaching back to `@theokit/sdk/auth`.
export { AuthProvider } from './auth/auth-provider.js'

// M73 — "enriquecer nunca reduz". A mecânica de store do SDK atravessa como PASS-THROUGH PURO.
//
// Antes disto, este subpath exportava 1 valor e 6 tipos enquanto `@theokit/sdk/auth` exportava 19
// símbolos: nenhuma função atravessava. Como o consumidor tem regra INQUEBRÁVEL de nunca importar
// `@theokit/sdk*` direto, **reimplementar era a única saída legal** — e o agent-builder reescreveu
// seis destes nomes, ~120 linhas de mecânica duplicada. A lacuna era daqui, não indisciplina de lá.
//
// PURO, e não wrapper (parsimony Rung 9): estas são funções de I/O sem estado a segurar. A camada
// enriquece onde há orquestração — é o que `AuthProvider` faz com o par `config`+`store`. Envolver
// isto acrescentaria indireção sem nada dentro, e **quebraria `instanceof`**: o consumidor faz
// `err instanceof CredentialError`, o que só vale enquanto a classe for a MESMA referência do SDK.
// `tests/unit/auth-parity.test.ts` trava essa identidade com `toBe`.
//
// `resolveCredential` NÃO atravessa, de propósito: o SDK e o agent-builder têm funções DIFERENTES com
// esse nome (sync vs async, lança vs `undefined`, lê env vs não lê, infere provider vs recusa), e o
// próprio SDK declara que a precedência de env, a inferência por prefixo e o provider declarado são
// app policy do consumidor (`internal/auth/credential-store.ts`). Expor os dois no mesmo escopo seria
// convite a importar o errado, com falha silenciosa.
export {
  authFilePath,
  CredentialError,
  credentialHome,
  readAuthFile,
  readStoredOAuth,
  writeCredential,
} from '@theokit/sdk/auth'

// M110 — o device flow **RFC 8628** atravessa, pelo MESMO argumento do M73 acima, sobre símbolos que
// aquele milestone não cobriu.
//
// Medido: o SDK implementa o padrão (`deviceLogin`, `requestDeviceCode`, `pollDeviceToken`,
// `DeviceOAuthConfig`), e este subpath re-exportava **apenas** a variante da OpenAI
// (`openaiDeviceLogin`, `OpenAIDeviceConfig`). Um consumidor que precisasse do padrão tinha duas
// saídas: violar a regra INQUEBRÁVEL, ou reimplementar o RFC. É literalmente a frase do M73 — *"a
// lacuna era daqui, não indisciplina de lá"* — reencenada num subsistema vizinho.
//
// PURO, não wrapper, pelo critério que o M73 escreveu: são funções de I/O sem estado a segurar.
// `DeviceDeps` já é injetável, então um consumidor testa o próprio provider sem rede.
//
// As duas formas COEXISTEM e nada é unificado: `DeviceOAuthConfig` tem **um** `deviceCodeEndpoint`
// (RFC), e `OpenAIDeviceConfig` tem **dois** (`deviceUsercodeEndpoint` → `devicePollEndpoint`, com
// PKCE). Fundi-las quebraria o Codex — o provider que este trabalho existe para facilitar.
// E `openaiDeviceLogin` atravessa JUNTO, o que a medição do M110 mostrou faltar: ele era **importado**
// aqui para uso interno do `AuthProvider` e nunca re-exportado. Consequência — o flow do Codex só era
// alcançável construindo um `AuthProvider` (que exige `config`+`store`), quando o pedido concreto era
// *"facilitar usar o provider Codex"*. Exportá-lo é o mesmo argumento das linhas acima, aplicado à
// variante que já existia.
export {
  deviceLogin,
  openaiDeviceLogin,
  pollDeviceToken,
  requestDeviceCode,
} from '@theokit/sdk/auth'
export type { DeviceCodeGrant, DeviceOAuthConfig } from '@theokit/sdk/auth'
export type { ResolveCredentialOptions } from '@theokit/sdk/auth'
export type {
  CredentialStoreConfig,
  DeviceDeps,
  OAuthProviderConfig,
  OAuthTokens,
  OpenAIDeviceConfig,
  ResolvedCredential,
} from '@theokit/sdk/auth'

// M111 — device auth PLUG-AND-PLAY. O M110 fez o flow RFC 8628 atravessar; ele não tocou a ergonomia.
//
// Para autenticar no Codex, o consumidor tinha de saber que existem DUAS formas de device flow, copiar
// um `clientId` e três URLs da OpenAI para dentro do próprio código, montar `{fetch, sleep, now}`,
// chamar `deviceLogin` e LEMBRAR de chamar `persist` — esquecer o último custa um round-trip OAuth
// completo que não guarda nada.
//
// O desenho veio de medição contra três peers e REFUTOU a proposta original (um descritor plano com
// discriminante `kind`): nenhum dos três discrimina protocolo por campo. `AuthMethod` é união
// discriminada e cada método aponta para a SUA função — sem `switch`, e sem tornar representável um
// método OAuth que não sabe autorizar.
//
// ENRIQUECE, não é pass-through: `loginWithDevice` orquestra `authorize` + `persist` (a forma de
// `run_device_code_login` do codex, que retorna `()`), e `CODEX_PROVIDER` é identidade pública que
// antes cada consumidor copiava — dois donos do mesmo fato é violação de DRY através da fronteira.
export { CODEX_CLIENT_ID_ENV_VAR, CODEX_PROVIDER, loginWithDevice } from './auth/device-provider.js'
export type { AuthMethod, DeviceAuthProvider, PromptHooks } from './auth/device-provider.js'
