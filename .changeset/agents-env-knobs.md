---
'@theokit/agents': minor
---

`@theokit/agents/config` adds `envKnob`, `coerceEnvValue`, `envLayerFrom` and `auditEnvKnobs`: declare which config keys the environment sets, coerce boolean and number values (an unrecognised value is passed through so the schema rejects it by name), build the env layer from the variables that are set, and audit that every key has a knob or an opt-out.
