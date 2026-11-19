---
'@theokit/agents': minor
---

Add `delegationPortFromAgentFactory` to `@theokit/agents/bridge`: a `DelegationPort` that runs a fresh agent per task, cancels its run when the delegating signal aborts, and disposes the agent in every case. The `DelegationPort` doc no longer claims an SDK `SubAgent` satisfies it.
