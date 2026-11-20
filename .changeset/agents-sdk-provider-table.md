---
'@theokit/agents': minor
---

`DEFAULT_PROVIDERS` is now derived from the SDK provider table (`DEFAULT_PROVIDER_CANDIDATES` in `@theokit/sdk/auth`), so the env var names and the default order (openrouter, anthropic, openai) are the SDK's and `@theokit/agents` holds no literal env var name or key prefix. The default descriptors no longer carry `keyPrefix`; the key coherence check still runs through the SDK's `providerFromApiKeyPrefix`. Treated as minor, not breaking: the default order is unchanged.
