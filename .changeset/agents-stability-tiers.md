---
'@theokit/agents': major
---

`@theokit/agents/testing`: `createMockAgentStream`, `MockAgentStreamOptions`, `MockResponse` and `MockStreamEvent` are now tagged `@experimental` (the legacy snake_case vocabulary no production path consumes), which the surface gate counts as a demotion from stable. The rest of the subpath stays stable, and the README now records that tier decision and lists the experimental exports by entry.
