---
'@theokit/agents': minor
---

Add `resolveSecretRefs` to `@theokit/agents/auth`: it replaces `secretref:env:`, `secretref:file:`, `op://` (1Password) and `secretref:vault:` values in an environment with the value read from the store, and returns the values for output masks and a map of variable to store kind. A failure throws `SecretReferenceError` with `variable` and `store`. Callers can add their own `SecretStore`.
