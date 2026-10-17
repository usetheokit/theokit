---
'@theokit/agents': minor
---

New subpath `@theokit/agents/handoff`. `createHandoffConversation({ agents, initial, conversationId? })` holds a roster of compiled agents and the name of the one that answers. The answering agent gets a `transfer_to_agent` tool that names only the other agents. When it calls the tool, it still answers the current message, and your next `send()` is answered by the receiver, which reads the transferring agent's note before your message. (B-410)

Each agent runs on its own session, `<conversationId>:<agentName>`. A transfer counts only when the run returns normally: a run that throws, or whose `signal` was aborted, leaves the responder where it was. `send()` takes the `AgentRunner.run` options except `sessionId`, `tools`, `streamFactory` and `maxIterations`, which the conversation owns, and drops them at run time if they arrive through a wider object. `handoffTo(name, note?)` moves the next turn from your code. A roster below two agents, a duplicate name, an unknown agent and an agent whose `maxIterations` is 1 throw `HandoffError` with a `code`; so do `send()` and `handoffTo()` while a turn is running (`turn_in_progress`).

`@theokit/sdk-handoff` stays call-and-return: there the caller keeps the turn.
