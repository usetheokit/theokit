---
'@theokit/agents': minor
---

A refused tool call now says who refused it. A veto from the HITL gate, the approval posture, the permission gate, a hook spec or a delegation hook is recorded in a run-scoped ledger, and the stream's `refusal.by` becomes `human` (a person said no), `timeout` (nobody answered), `policy` or `hook`, with `refusal.reason` carrying the bare reason. A veto from a plugin the framework did not build keeps `by: 'plugin'`. The model-facing messages are unchanged.
