---
'theokit': patch
---

An ACP tool call whose agent writes a stdout line that is JSON but not a JSON-RPC message (a scalar such as `42`, or an object that is neither a response, a request nor a notification) now rejects with `AcpProtocolError` from `@theokit/agents` (code `ACP_PROTOCOL_ERROR`, carrying the offending `line`) and ends the agent, as a non-JSON line already did. A scalar used to reach the caller as a plain `Error` reading "the agent refused initialize", and a wrong-shaped object was dropped.
