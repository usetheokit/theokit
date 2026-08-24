---
'theokit': patch
---

The `http.request` span joins the caller's trace instead of minting one of its own. A request
carrying a W3C `traceparent` produced two disconnected traces once the agent run learned to continue
it: the run joined the caller, the HTTP span did not, and the caller's trace id reached the collector
as the `requestId` attribute rather than as the span's `traceId`. The span now continues the inbound
trace on every route and names the caller's span as its parent; a request with no `traceparent`, or
one carrying only an `x-request-id`, still roots a freshly minted trace as before.
