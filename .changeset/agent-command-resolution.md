---
'theokit': minor
---

`createACPTool` resolves the agent command on absolute `PATH` entries only, and `theokit/server/agent` exports `resolveAgentCommand`. A relative command or one that is not found closes the transport with `AcpTransportClosedError` before anything is spawned, and the agent's `PATH` keeps only its absolute entries. Windows keeps its previous behaviour.
