---
'@theokit/agents': patch
---

The tool `createA2ATool` returns now stops when its run is cancelled. Its handler ignored the run's `AbortSignal` (`ctx.signal`), so a cancelled run kept the HTTP connection and the remote agent's turn open until the remote finished, and the call stayed pending. The signal now reaches `fetch`, so a cancellation aborts the request and the event stream it holds, and the call rejects with the signal's abort reason instead of an `A2A call ... failed` error. (B-407)
