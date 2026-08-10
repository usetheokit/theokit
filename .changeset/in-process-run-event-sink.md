---
"@theokit/agents": minor
---

Forward `onRunEvent` through the in-process turn. The HTTP path threaded the SDK's typed `RunEvent` sink since theokit#132; the in-process entry point declared no field for it, so an embedded surface could not observe any run event. Additive — absent, the key is omitted and the SDK call is byte-identical to before.
