---
'theokit': minor
'@theokit/agents': patch
---

An ACP tool call rejects a turn the agent did not finish, and `AcpClient` answers a request with a string id. The tool returned by `createACPTool` dropped the `session/prompt` result, so a turn the agent ended with `stopReason` `max_tokens`, `max_turn_requests`, `refusal` or `cancelled` came back as a finished answer. Only `end_turn` resolves now. Any other stop reason rejects with the new `AcpTurnStoppedError` (exported from `theokit/server/agent`), which carries `stopReason` and the text streamed before the stop as `partialText`; a result with no string `stopReason` rejects naming `session/prompt` (ADR 0025). `AcpClient` failed every request in flight when the agent sent a JSON-RPC request whose id is a string, which JSON-RPC 2.0 allows; it now answers that request with the same id. (B-408)
