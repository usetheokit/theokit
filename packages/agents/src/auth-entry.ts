// M60 — `@theokit/agents/auth`: the OO auth contract. `AuthProvider` (ENRICH — it holds the shared
// `config`+`store` state and delegates to the SDK's free OAuth-lifecycle functions), plus the auth
// domain's types re-exported so a consumer types the whole surface from the Theokit layer, never
// reaching back to `@theokit/sdk/auth`.
export { AuthProvider } from './auth/auth-provider.js'
export type {
  CredentialStoreConfig,
  DeviceDeps,
  OAuthProviderConfig,
  OAuthTokens,
  OpenAIDeviceConfig,
  ResolvedCredential,
} from '@theokit/sdk/auth'
