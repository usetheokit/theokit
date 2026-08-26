---
'theokit': minor
---

A model whose declared provider prefix is not registered is now refused, instead of being routed to whichever provider happens to hold a key.

`resolveProvider` already carried the right error — *"declares provider X, which is not registered"* — and it was unreachable for anyone with a key. `providerOf` returns `undefined` for an unregistered prefix, which is indistinguishable from a bare model id, so the env-priority walk claimed the turn before the check below it ever ran.

The visible symptom was a confusing error. The real cost appears when the substitute's key is **valid**: the turn succeeds against a provider nobody named — a different endpoint, a different account billed, and the prompt delivered to a vendor the operator had explicitly routed away from. The only trace was a `console.warn` reading `(by env priority)`, which fires at most once per process, so on a long-running server it may already have been printed for an unrelated turn.

**This inverts a case theokit#326 listed as intended.** That commit recorded `acme/whatever → previous priority order` among its outcomes, but gave no reason for it, and argued the opposite principle two paragraphs on: *"refusing to substitute is the load-bearing part … falling through to another provider's key is precisely what made that 401 unattributable."* An unregistered prefix is a choice, not a silence, so #326's own reasoning applies to it.

**To upgrade:** a model id like `acme/whatever` that previously resolved by env priority now throws, naming the prefix and the registered providers. Either register it — `registerProvider({ name: 'acme', … })` — or drop the prefix, since a bare id (`gpt-4o-mini`, `qwen2.5:3b`) still falls back to priority exactly as before. A registered prefix still wins over priority, also unchanged.
