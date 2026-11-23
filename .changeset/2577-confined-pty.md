---
'@theokit/agents-pty': patch
---

`@theokit/agents-pty` requires `@theokit/sdk-pty` 0.4.0 or later and re-exports `createConfinedPtyBackend` and `probeConfinement`, so an app takes the confined shell and its probe from one place.
