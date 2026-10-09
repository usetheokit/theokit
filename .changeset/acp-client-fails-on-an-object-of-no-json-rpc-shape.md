---
'@theokit/agents': patch
---

`AcpClient` now fails the requests in flight with `AcpProtocolError` when the agent writes an object that is not a JSON-RPC response, request or notification it can dispatch (an `id` with neither `result` nor `error`, a string `id`, a notification carrying `id: null`), and logs a warning when no request is in flight. Such a line used to be dropped, and the request it was meant to answer stayed pending until the transport closed.
