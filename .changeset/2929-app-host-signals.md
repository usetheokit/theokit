---
'@theokit/host': patch
---

`createAppHost` takes `attachSignalsEarly` to attach the signal listeners at creation, `AppHost.detachSignals()` removes them without stopping anything, and `onError` receives `{ signal }` as a third argument when a repeated signal is ignored.
