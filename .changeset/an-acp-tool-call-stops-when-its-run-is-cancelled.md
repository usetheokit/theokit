---
"theokit": patch
---

An ACP tool call stops when its run is cancelled. The handler of the tool `createACPTool` returns ignored the run's `AbortSignal` (`ctx.signal`), so a cancelled run left the call pending and the coding agent running until the request timeout, ten minutes by default. The call now rejects with the signal's abort reason as soon as the run is cancelled and closes the agent process the same way it does after a reply or an error, and a run already cancelled when the tool is called starts no agent. (B-408)
