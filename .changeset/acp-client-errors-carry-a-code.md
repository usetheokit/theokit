---
'@theokit/agents': patch
---

`AcpProtocolError` and `AcpConnectionClosedError` now extend `TheokitAgentError`, with the stable codes `ACP_PROTOCOL_ERROR` and `ACP_CONNECTION_CLOSED` and `isRetryable: false`, so a caller can tell a broken agent channel from other failures through `code` and `isTransientError` instead of the message text. Their `name`, message, `line` and `cause` are unchanged.
