---
'@theokit/agents': minor
---

`readThreadHistory()` from `@theokit/agents/session`: read one thread's stored history with three
answers — `present`, `absent`, or `unreadable` with the reason.

Applications had two. Catching for a brand-new thread (which has no transcript yet) is mandatory, and
that catch also swallowed parse and permission failures, so a damaged conversation rendered as an
empty successful one.

`absent` still does not distinguish a lost conversation from a new one, and the type says so: the
thread id is minted client-side and nothing records that it was issued. That distinction belongs to
the caller who knows whether the id was restored from storage or freshly minted.
