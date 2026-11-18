---
'theokit': minor
---

`discoverOidcProvider` now checks every endpoint it returns (`authorization_endpoint`, `token_endpoint`, and `userinfo_endpoint`, `jwks_uri`, `end_session_endpoint` when present) and throws the new `OidcInsecureEndpointError` unless the URL is https or loopback (`localhost`, `[::1]`, `127.0.0.0/8`, never `0.0.0.0`). `isSafeOidcUrl` is exported too.
