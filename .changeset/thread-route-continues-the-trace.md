---
'theokit': patch
---

A run's trace no longer depends on which endpoint started it. The thread message route
(`POST /api/agents/<name>/threads/<sessionId>/message`) dropped the incoming `traceparent`, so the
same header produced the caller's trace on the plain POST and a freshly minted one on the thread
route. Both endpoints now open their spans through one function, so the trace continued is the trace
of the request that started the run — including for a follow-up queued behind an active run, which
outlives the request that queued it.
