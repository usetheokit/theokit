---
'@theokit/agents': minor
---

An agent can declare a ceiling on the tool-calling turns of a single run, and the served agent obeys
it. `AgentBuilder.create().maxIterations(5)` and `defineAgent({ maxIterations: 5 })` are new; the
ceiling `@Agent({ maxIterations })` and `@MainLoop({ maxIterations })` already accepted now reaches
the runtime as well.

The number was written by every authoring path and read by none of them once the agent was served:
the only code enforcing a ceiling was the reflective loop, which no served path calls. The adapter
now lowers `CompiledAgentOptions.maxIterations` to the SDK's `SendOptions.maxIterations` — its
documented per-send ceiling — on both the streaming path and the handle `toAgentFactory` serves,
where a caller's own value still wins for that turn.

An agent that declares no ceiling is untouched: the key is omitted entirely, so the SDK's own default
still applies and nothing about that run changes. A value that is not a positive integer is refused
where it was written rather than at the first send.
