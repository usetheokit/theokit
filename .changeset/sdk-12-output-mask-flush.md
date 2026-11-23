---
'@theokit/agents': patch
'@theokit/presenter': patch
'@theokit/host': patch
'theokit': patch
---

The `@theokit/sdk` peer range is widened to `<13`, so `@theokit/sdk@12.0.0` is supported. The capability map is measured against it, and TheoClaw flushes its output mask through the `flush` of the `wrapStreams` handle that 12.0.0 adds.
