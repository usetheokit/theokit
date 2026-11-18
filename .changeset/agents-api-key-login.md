---
'@theokit/agents': minor
---

`@theokit/agents/auth` now exports `loginWithApiKey` (infers the provider from the key prefix, refuses a contradicting provider and an existing credential without `overwrite`, throws `CredentialExistsError`), `logout`, and two `AuthProvider` options: `requestTimeoutMs` aborts a hanging refresh request, and `onTransientFailure: 'use-stored'` returns the stored credential when the refresh endpoint stays unreachable.
