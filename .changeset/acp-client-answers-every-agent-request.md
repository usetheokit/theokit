---
'@theokit/agents': patch
---

`AcpClient` answers every request the agent sends and checks the `error` of a response. A server request whose handler result cannot be serialized (a `BigInt`, for example) used to leave the agent without an answer and the host with an unhandled rejection; it is now answered with JSON-RPC error -32603, and a reply the transport cannot send is logged with `console.warn`. A response whose `error` is not an object with a numeric `code` and a string `message` used to resolve the request with `undefined` (`"error": null`) or reject it with an empty message; it now fails the requests in flight with `AcpProtocolError`, naming the line. (B-408)
