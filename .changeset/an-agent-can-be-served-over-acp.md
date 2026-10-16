---
'@theokit/agents': patch
---

An agent from `toAgentFactory` can be served over ACP by `@theokit/acp` when it declares guardrails or a step ceiling. Its turn now has `stream()`, which the server reads: it yields one assistant message with the text after the output guards, and shares one guard run with `wait()`. Both wrappers now forward `pluginManager`, so the server's default `ask` mode can install its permission plugin instead of refusing the prompt with `permission enforcement unavailable on this runtime (no plugin manager)`. A guarded agent served this way sends its text once the turn completes, with no token streaming and no tool activity, because streaming the raw text would pass it before the output guards ran. `SdkTurnHandle.stream` and `SdkAgentHandle.pluginManager` are new optional members.
