---
'@theokit/agents': minor
---

Added `parseDottedOverrides` and `DottedOverrideError` to `@theokit/agents/config`: turns `-c a.b=value` pairs into a config layer, refusing prototype-pollution segments and pairs that build incompatible shapes, with coercion keyed by the full dotted path.
