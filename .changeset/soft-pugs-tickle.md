---
'theokit': minor
---

`useNonce()` — an application component can read the request's CSP nonce

The node SSR target mints a nonce per request and stamps it onto the scripts the framework emits.
Anything an application inlined carried none, so the browser refused it. `useNonce()` is the seam:
the SSR entry wraps the app tree in a `NonceProvider` carrying `options.nonce`, and the hook reads it.

The value is deliberately absent from the hydration payload — a nonce readable from the page is a
nonce an attacker can copy onto an injected tag — so it is a string on the server and `undefined` on
the client. Consumers must put `suppressHydrationWarning` on the element; `docs/surfaces/csp-nonce.md`
documents that as mandatory and names the react-dom range it was measured on.
