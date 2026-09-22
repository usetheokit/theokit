---
"@theokit/http": minor
---

`deriveActionKey` now accepts a salt as its second argument, so key derivation no longer depends on the secret it protects. Called without one it keeps deriving from the secret — existing ciphertext still decrypts — and warns once per process naming what is weak about it. Generate a random salt once, persist it beside the secret, and pass it.

`digestError` survives a throw of `undefined`, a symbol or a function. `JSON.stringify` returns the value `undefined` rather than a string for all three, and the digest then crashed inside the handler that existed to make an arbitrary thrown value safe.

A caught render error now leaves a digest instead of nothing, so an error boundary reports which failure it swallowed.

A Suspense failure can no longer end the process: `allReady` is observed at creation rather than handed to the caller unwatched.
