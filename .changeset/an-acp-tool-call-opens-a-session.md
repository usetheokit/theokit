---
"@theokit/agents": minor
"theokit": patch
---

An ACP tool call opens a session before prompting. The tool returned by `createACPTool` sent a single `session/prompt` and read `result.text`, so an ACP agent that enforces the protocol refused the call, and even a tolerant one gave back an empty string, because ACP streams the reply as `session/update` notifications. Each call now sends `initialize`, `session/new` and `session/prompt`, and returns the text of the `agent_message_chunk` updates for its session. A step the agent refuses rejects with an error that names the method, and nothing after it is sent. A `session/request_permission` request is still decided by `onPermissionRequest`, but the reply on the wire is now an ACP `outcome` (`selected` with the option chosen by kind, or `cancelled`) instead of `{ granted }`. `AcpClient` gains `onNotification(method, handler)`, which delivers JSON-RPC notifications to a registered handler.
