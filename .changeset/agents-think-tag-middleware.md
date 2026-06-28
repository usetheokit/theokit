---
'@theokit/agents': minor
---

Add an opt-in `<think>`-tag reasoning middleware (M2). When `parseThinkTags` is set — declaratively via `@Agent({ parseThinkTags: true })` or per-run via `AgentRunner.run(msg, { parseThinkTags: true })` (per-run wins over compiled) — the agent's text stream is wrapped with a streaming extractor that converts inline `<think>…</think>` into `thinking` StreamEvents, so models that emit reasoning as inline tags (qwen/deepseek-class) surface it the same way native-reasoning providers do (M1's `reasoningEffort`). The extractor is chunk-straddle-safe, preserves interleaved order, flushes a truncated `<think>` at stream end, and treats a non-tag prefix like `<thinkers>` as text. Off by default — zero behavior change for existing agents. New exports: `createThinkTagExtractor`, `extractThinkTagStream`, `Segment`.
