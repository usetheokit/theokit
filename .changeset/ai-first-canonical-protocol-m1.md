---
"@theokit/agents": minor
---

A theokit agent's tool calls and reasoning now render in `@ai-sdk/react`'s `useChat` — a tool-call card (name + input + result) and a reasoning block, not just text (theokit-ai-first M1).

`translateToUIMessageStream` widens the M0 text-only mapping to emit ai-sdk tool chunks (`tool-input-available` → `tool-output-available` / `tool-output-error`) and reasoning chunks (`reasoning-start` → `reasoning-delta*` → `reasoning-end`) via an open-block state machine that closes the current text/reasoning block before switching kind. Runtime-discovered tools carry `dynamic: true`, so the ai-sdk consumer materializes a `dynamic-tool` part whose tool name survives to the rendered part; a tool result that arrives without a preceding tool call synthesizes the tool-input part first, so the consumer never throws. `UIMessageStream` stays the canonical wire (AG-UI rejected — ADR 0036). Backward-compatible: M0 text/error runs are byte-unchanged; the translator signature and barrel exports are unchanged.
