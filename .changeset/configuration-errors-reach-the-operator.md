---
'@theokit/agents': minor
---

A configuration error now reaches the browser with its own message, instead of the generic mask.

`missing_api_key` and `malformed_api_key` are the operator's own input — the person reading the blank error is the person who forgot to set the variable. Masking them cost that person the first ten minutes of every misconfiguration, and did it next to a `transient: true` that means *do not persist in history* on this protocol and *retry may help* everywhere else a developer has met the word. Together they read as a network hiccup.

Everything else is unchanged. #390's default stands: a driver's message, an HTTP client's, a filesystem call's — anything that could name a host, a path, a query or a credential — still reaches the browser as `An error occurred.`, with the failure code travelling separately so consumers never go back to matching on text.

The hole is keyed on **codes**, not on the error class. `ConfigurationError` is a large surface and parts of it do describe internals, so an allowlist keyed on the parent would widen by accident the first time something new subclassed it. Adding a code to the list is a decision about what a browser may read, and the bar is written beside it.

A host that passes its own `onError` is unaffected — the allowlist is the default's behaviour, not a rule imposed above the hook.
