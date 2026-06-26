---
"@theokit/agents": minor
---

V4-R: `AgentRunner` accepts an injectable `RoundStreamFactory` via `run-options.streamFactory`.

`AgentRunnerRunOptions.streamFactory?: RoundStreamFactory` drives the reflective loop with a caller-provided per-round stream INSTEAD of `createSdkAgentStream` (for tests or a custom transport). When set, the SDK-create options (`tools`/`sdkTools`/`model`/`cwd`/...) are not used for that call — the consumer owns the stream. Absent ⇒ the SDK adapter (the default runtime), byte-identical to before. `RoundStreamFactory` (`(message, sessionId) => AsyncIterable<StreamEvent>`) is now exported from the package barrel so consumers can type their factory (the loop DRIVER `runReflectiveLoop` stays internal). Lets an app adopt `AgentRunner.stream()` while keeping its existing stream-injection tests — closes the last adoption seam the theocode discover found. Additive + backward-compatible; no new dependency.
