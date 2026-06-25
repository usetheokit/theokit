---
"@theokit/agents": minor
---

V4-M: `AgentRunner.stream()` reflective-loop rounds now share a persisted SDK session, so round N+1 sees what rounds 1..N read and did.

- Each round resumes the same session via `Agent.getOrCreate(sessionId, { conversationStorage })` with ONE shared `conversationStorage` created per run (default `InMemoryConversationStorage` — per-run, no disk), survivable across the per-round agent dispose.
- Rounds 2+ no longer re-send the original task — the persisted session carries it; the round-2+ prompt is the reflection block (or a short continuation). Round 1 sends the original message unchanged.
- New `AgentRunnerRunOptions.conversationStorage` (and `RuntimeOverrides.conversationStorage`) lets an app plug a `FileSystemConversationStorage`/custom adapter for durable cross-run history.

**Behavior change (fix):** previously each round created a fresh, memoryless agent (history was NOT carried across rounds) — a multi-round reflective loop whose rounds could not see prior tool results. Rounds are now stateful by default. This reuses the SDK's own session-persistence primitives (Rule 9); no new dependency. It unblocks consumers (e.g. a code agent) adopting `AgentRunner.stream()` for continuation loops.
