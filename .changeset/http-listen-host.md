---
"@theokit/http": minor
---

`TheoApp.listen(port, host?)` and `ServerHandle.listen(port, callback?, host?)` take a host and bind to loopback (`127.0.0.1`) by default on the Node, Bun and Deno adapters, where the server used to listen on every interface. Pass `'0.0.0.0'` as the host to keep listening on all interfaces, for example inside a container.
