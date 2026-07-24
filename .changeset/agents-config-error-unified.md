---
'@theokit/agents': minor
---

Unify `ConfigurationError` on the SDK's class (M61).

`@theokit/agents` used to define its own `ConfigurationError extends Error` while `@theokit/sdk`
shipped a separate `ConfigurationError extends TheokitAgentError`. A `catch (e instanceof
ConfigurationError)` caught one throw path and silently missed the other. The layer now RE-EXPORTS the
SDK's class, so authoring throws (`@theokit/agents`) and runtime throws (`@theokit/sdk`) are the SAME
class — `instanceof` holds across the boundary in both directions. Existing single-arg
`new ConfigurationError('msg')` calls are unchanged (the SDK options are optional); the class stays
`instanceof Error`. Decision in `knowledge-base/adrs/0006-configuration-error-unification.md`.
