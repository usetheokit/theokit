---
'@theokit/agents': patch
---

Add tests for `delegationPortFromAgentFactory`: a failing disposal after a failed run reports both errors, and an already aborted signal never creates the worker.
