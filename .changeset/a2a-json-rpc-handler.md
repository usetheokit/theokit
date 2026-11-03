---
'@theokit/agents': minor
---

`@theokit/agents/a2a` serves and calls A2A's JSON-RPC `message/send`. `createA2AJsonRpcHandler({ authorize, respond, maxBodyBytes, timeoutMs })` answers a `message/send` request over Web `Request`/`Response`: an unauthorized request gets 401 before its body is read, the body is bounded, malformed requests get their JSON-RPC 2.0 error codes, and the turn is bounded by `timeoutMs` even when `respond` never settles. `createA2ATool({ protocol: 'jsonrpc' })` calls such a handler and returns the text of the `Message` or `Task` it answers; without `protocol` it sends exactly the request it sent before. `buildAgentCard` copies optional `securitySchemes` and `security` onto the card. (B-394)
