---
'@theokit/agents': patch
---

`AcpClient` no longer lets what a coding agent writes to stdout throw out of the transport callback. A line that is not JSON used to throw from the stdout `data` listener of the Node transport, an uncaught exception that ended the host process; it now rejects every request in flight with the decode error, naming the line, and is logged with `console.warn` when nothing is in flight. A notification handler that throws is logged with `console.warn` and the rest of the chunk is still dispatched, where it used to throw into the transport and drop the messages after it. (B-408)
