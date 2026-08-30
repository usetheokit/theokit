---
'@theokit/http': patch
---

A controller whose constructor throws answers 500 for its own routes instead of exiting the process.

Reported from a real app (#577): one optional plugin's env var was unset, the app booted, logged the
plugin as skipped, printed its URL — and then died on the first request to **any** route, from an
unhandled rejection inside the dispatcher. `createDecoratorHandler` built every controller in one
loop before serving anything, so one class failing to construct discarded the handler for all of
them; because the framework builds that handler lazily inside request dispatch, the throw escaped
into the request.

The routes of a controller that failed to build are still registered and now answer 500
`CONTROLLER_CONSTRUCTION_FAILED`, carrying the cause and the controller's name — with the stack
redacted in production by the same `digestError` every other error path here uses. The failure is
also logged once, at construction: containment is not swallowing, and a 500 nobody reads is the
silent failure this codebase refuses elsewhere.

Every other controller serves normally, which is the whole point — the operator had been told the
plugin degraded gracefully, and it had widened one route's failure to the process.
