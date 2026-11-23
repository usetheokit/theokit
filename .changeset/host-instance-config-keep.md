---
'@theokit/host': patch
---

`defineInstanceConfig` accepts `undeclared: 'keep'` so `load` and `write` carry keys that are not declared, onboarding takes `only` to collect a subset of the declared keys, and the `validate` of `reload` and `watch` also receives the `successor` environment (the changed start-only keys included). A reload where nothing changed is no longer validated.

The `./instance-config` export also has a `default` condition, so a CommonJS caller (a `tsx` script) can load it.
