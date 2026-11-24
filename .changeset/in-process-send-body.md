---
'@theokit/agents': patch
---

`InProcessTransport` forwards the object passed to `send(input)` to the runner as `InProcessRunInput.body`, as `HttpTransport` does, so a per-turn option no longer needs a side channel.
