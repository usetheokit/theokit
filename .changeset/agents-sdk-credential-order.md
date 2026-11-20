---
'@theokit/agents': minor
---

`DEFAULT_PROVIDERS` is now derived from the SDK provider table (`DEFAULT_PROVIDER_CANDIDATES` in `@theokit/sdk/auth`), so the env var names and the default order (openrouter, anthropic, openai with SDK 5.32.0) are the SDK's, and the default descriptors no longer carry a `keyPrefix`. The key check asks the SDK's `providerFromApiKeyPrefix`; a key it cannot attribute to a default provider is still refused, and the `ProviderKeyMismatchError` message now says what the key looks like. This is partial: `resolveAgentCredential` does not yet call `resolveProviderCredential` (async in SDK 5.32.0) and the openai-before-anthropic order needs an SDK release. Minor, not breaking: the default order is unchanged.
