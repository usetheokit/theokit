---
'@theokit/agents': minor
---

`@theokit/agents/auth` now lets the OAuth engine cross over: `ensureFreshCredential`,
`persistOAuthTokens`, `refreshOAuthTokens` and `extractAccountId`.

M73 opened the credential-store mechanics and M110 opened the RFC 8628 device flow. What sits
**between** them — exchanging a device grant for tokens, refreshing before expiry, persisting the
result, knowing which account the tokens belong to — had no door. Since consumers have an unbreakable
rule never to import `@theokit/sdk*` directly, the only legal way out was to reimplement; that is
what happened, for the third time in this same subsystem.

Pure pass-through (same reference as the SDK, locked with `toBe`), by the criterion M73 fixed: these
are stateless I/O functions.

`resolveCredential` deliberately stays out, and now has a test proving it — two functions share that
name with divergent semantics (sync vs async, throws vs `undefined`, reads env vs does not), and
exposing both in one scope invites importing the wrong one, silently.
