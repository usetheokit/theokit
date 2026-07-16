---
"@theokit/agents": minor
---

Surface per-turn usage on the streamed assistant message. `translateToUIMessageStream` now rides the turn's authoritative totals — `usage` (input/output/total + reasoning/cache buckets), `cost`, and `durationMs` — on the ai-sdk `finish` chunk's `messageMetadata`, so they reconstruct onto the client's assistant `UIMessage.metadata` (via `readUIMessageStream`) with no extra header or store wiring. A run that ends without a `done` event (error/abort) keeps a bare `finish` (no fabricated usage). New public type `AgentTurnMetadata`. This is what lets a surface (a TUI status bar, a web cost meter) show real tokens/cost for the turn it just streamed — previously the totals stopped at the server.
