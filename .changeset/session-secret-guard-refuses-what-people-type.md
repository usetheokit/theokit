---
'theokit': minor
---

**A session secret that looks like a placeholder no longer boots in production** (#610).

`assertProductionSecret` reached both session constructors already (#429's half of the fix) and
still admitted every placeholder an adopter actually writes. Its whole vocabulary was
`/CHANGE_ME|demo[-_]|placeholder/i`, so the 32-character floor was the only condition that ever
fired — and a placeholder long enough to clear that floor is exactly what a developer produces when
the error message asks for 32 characters. Measured against `theokit@0.64.0` with
`NODE_ENV=production`, all five of these started a server:

```
ACCEPTED  "dev-only-session-secret-32-chars-min-xxxx"   ← a real app's fallback
ACCEPTED  "changemexxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"    ← the pattern wants CHANGE_ME, not changeme
ACCEPTED  "devxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
ACCEPTED  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"    ← forty identical characters
ACCEPTED  "test-secret00000000000000000000000000000"
```

An app that falls back to a literal when its env var is unset then signs production cookies with a
value published in its own source. Reading the repository is the whole attack: forge the cookie,
and the server accepts any identity. The adopter that surfaced this had two such fallbacks, the
second written because the first one was a pattern.

The rules now live in `theokit/server/auth`'s new `inspectSecret`, exported so the same question can
be asked of a webhook secret or a signing key: a vocabulary of words that appear in strings people
type and not in generated output, a floor on distinct characters that refuses `aaaa…`, and a
repeated-block check. The distinct-character floor is 8 rather than 12 on purpose — a real
`openssl rand -hex 32` carries about 14 with a tail below 12, and a guard that refuses correct input
is a guard somebody disables.

**Two behaviour changes to know about:**

- A production boot with a weak secret now throws where it previously proceeded. That is the point
  of the change, and the message names which rule fired.
- The error no longer echoes the first 16 characters of the secret. An error message reaches stdout,
  the crash reporter, and everything that aggregates them; the index and the reason identify which
  secret is wrong without publishing half of it.
