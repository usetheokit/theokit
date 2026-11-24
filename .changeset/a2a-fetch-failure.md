---
'@theokit/agents': patch
---

`createA2ATool` rejects a refused connection, DNS or TLS failure as `A2A call to "<name>" failed: <reason>` with the original as `cause`; a cancelled caller still gets its abort reason.
