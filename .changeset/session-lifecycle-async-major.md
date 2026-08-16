---
"@theokit/agents": major
---

BREAKING: `deleteSession` and `runTranscriptGC` are now `async`.

Their return type goes from `T` to `Promise<T>`. A caller that does not `await` reads `undefined`
instead of the result and throws on the first field access — which is what happened to this repo's
own `theokit agent sessions gc` command, unnoticed for a day because the workspace typecheck was
measured against a stale `.d.ts`.

The change is required rather than cosmetic: the only agent registry in the ecosystem is
`Agent.delete(id): Promise<void>`, and the registry half of session deletion is unreachable without
awaiting it. Migration is `await`.

BREAKING: `SessionRegistryRemoverError` changes constructor arity and meaning. It was
`constructor(sessionId)` for "you passed a thenable to a synchronous seam"; it is now
`constructor(sessionId, timeoutMs)` for "the registry did not answer in time". The old condition no
longer exists, so a `catch` that depended on it will never fire again. The class moved module and is
re-exported from its old home, so import paths are unaffected.

Also: the registry timeout now has a bounded DEFAULT (`DEFAULT_REGISTRY_TIMEOUT_MS`, 30s) where it
previously waited forever. Unbounded remains available by passing a non-finite value.
