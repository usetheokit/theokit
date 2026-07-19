---
"@theokit/agents": patch
---

Fix stream event order so tool events precede the final answer text. For providers whose `onDelta` reports text but not `tool-call-started` (e.g. gpt-5.4 via OpenRouter), tool events surface only via `run.stream()` (post-completion), so live onDelta text was emitted BEFORE the tool that produced it — even though the model is tool-first (verified against the raw provider response). The SDK adapter now holds `text_delta` and flushes it after the drained stream, so the timeline order matches the model's true chronology (tool → result → answer). Non-text deltas keep their live order; duplicate text stays deduped. Trade-off: on a text-only turn the answer is emitted at generation-complete rather than token-by-token.
