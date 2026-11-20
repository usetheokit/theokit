---
'@theokit/agents': minor
---

`@theokit/agents/tools` exports `agentRunPort`, a stock scheduler `RunPort` that sends each prompt on an agent with the scheduler's signal and maps an `error`, a `cancelled` or an empty run to a failure, and `fileTransientJob`, a transient job whose prompt is a file re-read on each fire.
