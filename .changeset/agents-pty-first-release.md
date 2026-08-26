---
'@theokit/agents-pty': minor
---

First release. The PTY interactive backend for `@theokit/agents`, split out so a web application does not compile a terminal it will never open.

Six symbols, re-exported whole from `@theokit/sdk-pty` with no wrapper: `clampYield`, `MaxSessionsError`, `PtyInteractiveBackend`, `YIELD_MAX_MS`, `YIELD_MIN_MS`, and the type `PtyInteractiveBackendOptions`. A test asserts they are the upstream identities, so "re-export, not wrapper" is checkable rather than claimed.

Install it only if you drive a terminal. See `docs/adr/0004-the-terminal-is-a-separate-package.md` for why it is a package rather than a subpath or an optional peer.
