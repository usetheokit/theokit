---
'@theokit/agents': patch
---

`AcpClient` handles what a coding agent writes to stdout one line at a time. A line that is valid JSON but not an object (`null`, a number, a string, an array) used to reach dispatch: `null` threw a `TypeError` that failed every request in flight with no hint of a protocol error, and the others were dropped in silence. It now fails the requests in flight like a line that is not JSON, and both reject with the new `AcpProtocolError`, which carries the offending `line`. A bad line no longer discards the well-formed messages of the same chunk: a response, a server request (which still gets its reply) or a notification before or after it is dispatched, and only the requests in flight when the bad line arrives are rejected. A notification handler that returns a promise which rejects is now reported with `console.warn`, like one that throws, instead of becoming an unhandled rejection. (B-408)
