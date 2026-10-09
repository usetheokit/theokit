---
'@theokit/agents': patch
---

`createA2ATool` rejects when the remote agent parks its turn on a tool approval. A served route emits `tool-approval-request` and holds the stream open until its approve endpoint is called, which an A2A call cannot do, so the delegating call used to wait for the remote gate's timeout, or forever when it had none. The call now rejects as soon as the gate appears, with `A2A call to "<name>" failed: the remote awaits approval of "<tool>", which A2A cannot give`, and cancels the stream. A remote whose tools need approval is not supported over A2A. (B-407)
