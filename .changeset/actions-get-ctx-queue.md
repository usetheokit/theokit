---
'theokit': patch
---

A server action gets `ctx.queue` when `jobs.backend` is set, under `theokit start` and `theokit dev`, and the handler `ctx` of `action()` and `defineAction` is typed `RouteContext`, like a route's. Jobs an action enqueues reach the backend after a successful response and are discarded when the action fails. Before, `ctx` was `unknown` and `ctx.queue` was `undefined` (#1096).
