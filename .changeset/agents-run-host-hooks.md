---
'@theokit/agents': minor
---

`@theokit/agents/hooks` exports `runHostHooks`, which runs the approved hooks of one event the host owns (such as session start) outside an agent loop, with the same trust and approval gate as `buildHookHandlers` and an explicit, required environment.
