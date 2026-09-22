---
"theokit": minor
---

`GET /api/agents/<name>/approvals` now answers `{ approvals: [...], scope: 'instance' }`. The
`scope` field is new and present on every response.

It matters because the registry behind that listing is a process singleton, and every deploy target
the endpoint became reachable on is multi-instance by construction — a Worker is isolates, a Lambda
is concurrent invocations. An owner whose run paused on another instance was answered
`200 {approvals: []}`, which is indistinguishable from "nothing is pending". A pending approval that
reads as absent is worse than an error: the operator stops looking.

The declaration rides on every response and not only the empty one, because the empty case is the
half that is obvious and not the whole of it — a listing of two from one instance can be two of
five, and a caveat present only when the list is empty would vanish exactly when a caller starts
trusting the numbers.

The value is read from the registry rather than written into the handler. That interface is
injectable so a durable store can replace the in-process one, and a constant in the handler would
become false the day somebody wires that up. A registry that declares nothing is read as
`'instance'`: silence takes the narrow claim, because a registry that cannot say how far it reaches
must not be reported as speaking for a deployment. Nothing shared ships today; `'shared'` exists so
that adding one later does not mean editing the listing.

The decision behind the single-process contract is recorded in `docs/adr/0017`, which four
production files had been citing as a document that did not exist.
