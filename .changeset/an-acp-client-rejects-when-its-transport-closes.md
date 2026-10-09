---
'@theokit/agents': minor
'theokit': patch
---

`AcpTransport` gains an optional `onClose(listener)`, through which a transport reports a channel that closed on its own (the agent process exited or failed). `AcpClient` registers on it: when it fires, every request in flight rejects with the new `AcpConnectionClosedError`, whose message names the cause and whose `cause` is the error the transport reported, and every later request rejects with the same error without being sent. A transport without `onClose` behaves as before. In `theokit`, `AcpToolTransport` now inherits that `onClose` instead of redeclaring it, so its listener receives an `Error`; `NodeAcpTransport` still reports an `AcpTransportClosedError`, and a plain `AcpTransport` still fits where an `AcpToolTransport` is expected. (B-434)
