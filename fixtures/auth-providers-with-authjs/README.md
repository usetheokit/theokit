# auth-providers-with-authjs

Delegates the OAuth provider layer to **Auth.js** (`@auth/core`) — the
specialist library owns Google/GitHub/etc. and their constant deltas — then
**syncs** the resulting identity into TheoKit's own session store via
`/auth/sync`. This is the recommended path when you want many providers without
maintaining them: Auth.js handles the dance, TheoKit owns the session.

See `docs/concepts/auth-providers.md` for the full delegation rationale.
