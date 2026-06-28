---
"theokit": minor
---

Add `AgentThinkingEvent` (`{ type: 'thinking'; content: string }`) as a fifth variant of the `AgentEvent` wire contract, exported from `theokit/client`. Additive and non-breaking — the four existing variants are unchanged and consumers that switch only on the known types are unaffected. It mirrors the `@theokit/agents` stream-layer `ThinkingEvent`, so agent apps can carry the model's reasoning end-to-end instead of dropping it at the consumer's translation boundary. The framework's own SSE producer does not emit the variant yet (documented follow-up); the immediate consumer is theocode via the `@theokit/agents` `AgentRunner.stream()` path.
