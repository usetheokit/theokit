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
export type { ResolveCredentialOptions } from '@theokit/sdk/auth'
export type {
  CredentialStoreConfig,
  DeviceDeps,
  OAuthProviderConfig,
  OAuthTokens,
  OpenAIDeviceConfig,
  ResolvedCredential,
} from '@theokit/sdk/auth'
