---
'@theokit/agents': major
---

Remove the backward-compatibility concessions the previous release carried (M56).

**BREAKING — `ToolboxCapability.compile()` deleted.** It had zero callers anywhere and was kept only
because removing a public method breaks consumers. `apply()` is the one path an agent's tools flow
through. If you called `compile()` directly, apply the capability instead:
`applyCapabilities([new ToolboxCapability(...)])`.

**BREAKING — `ConfigurationError` is no longer re-exported from the capability module.** One class
with two import paths was compatibility, not design. Import it from where it is defined:

```diff
- import { ConfigurationError } from '@theokit/agents'   // still works — barrel unchanged
```

The barrel export is unchanged; only the internal `capability/capabilities.js` re-export was removed.
Consumers importing from the package root are unaffected.

Also in this release: the two `compileTools` failure paths that threw a bare `Error` (missing toolbox
instance, non-method handler) now throw the typed `ConfigurationError` the rest of the module uses, so
an authoring mistake is distinguishable from an unexpected runtime failure.
