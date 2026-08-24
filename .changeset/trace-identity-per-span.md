---
'theokit': minor
---

An agent run reaches the collector as one trace instead of one trace per span. Spans now carry the
trace they belong to and their own id, decided when the span starts; `agent.tool` and `agent.hitl`
hang under the `agent.run` that opened them, and a request carrying a `traceparent` is continued
rather than replaced. `ObservabilityAdapter.startSpan` takes an optional third argument placing the
span in a trace — existing callers are unaffected, and `defineObservabilityAdapter` forwards it so a
custom adapter is not trace-blind by construction.
