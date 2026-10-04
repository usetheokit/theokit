---
"@theokit/agents": patch
---

A streamed reply no longer starves the event loop while it renders

`consumeChunkStream`, which `AgentClient` reads every reply through, called `onMessage` for each
chunk in a loop that never left the microtask queue when the chunks were already buffered. A
renderer answers `onMessage` with a synchronous commit, so a long reply drained its whole backlog
with no macrotask in between: no input and no timers until it ended. In the TheoCode TUI a 400-line
reply ran at 130-140% CPU and Esc could not interrupt it. The loop now yields to the event loop
with a `setTimeout` hop once it has run for 16 ms, only while chunks are queued. (#964)
