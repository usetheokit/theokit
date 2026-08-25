---
'theokit': minor
---

A `server/routes/api/` directory is now refused at scan time instead of silently doubling the prefix.

`routes/` is already served under `/api`, so a file at `server/routes/api/auth/callback.ts` answered at `/api/api/auth/callback` — not the redirect URI anybody registers with an identity provider, and not a URL anybody would call. It was found by wiring a real OAuth sign-in and watching the callback 404.

The second half is worse because it survives a reader's attention: `.theokit/client.d.ts` mirrors the file tree into the typed client, so the same file produced `client.api.auth.callback.get()` — an `api` segment that reads as a typo and is not one. Both halves were wrong from one cause.

The error names the file, the URL it would have produced, the client chain it would have produced, and where the file belongs.

A route merely NAMED `api-keys.ts` or `apiary.ts` is unaffected — only a top-level `api/` directory doubles, because only a directory prefixes everything beneath it.
