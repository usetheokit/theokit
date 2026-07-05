---
scenario: agent-chat-new-surface
date: 2026-07-05
operator: maintainer (M6 live dogfood)
outcome: pass
summary: Fresh npx create-theokit app streamed a real chat response over UIMessageStream via OpenRouter.
---

# Evidence — streaming chat on a fresh scaffold

## What was exercised

`npx create-theokit` (local build of `create-theokit`) → `pnpm install` (published
`theokit@0.15.0` + `@theokit/agents@0.30.0` from npm) → `theokit dev` → `POST /api/agents/chat`
with `{ "message": "In one short sentence, what is TheoKit?" }` and `OPENROUTER_API_KEY` set.

## Result

The endpoint streamed a real `openai/gpt-4o-mini` response token-by-token over the ai-sdk
`UIMessageStream` wire:

```
data: {"type":"start"}
data: {"type":"text-start","id":"ad5a55a5-…"}
data: {"type":"text-delta",…,"delta":"Theo"}
data: {"type":"text-delta",…,"delta":"Kit"}
… (real streamed tokens) …
data: {"type":"text-end",…}
data: {"type":"finish"}
data: [DONE]
```

A second chat run produced 5 `text-delta` chunks. The framework's plumbing — scan → mount →
`streamAgentUIMessages` → the ai-sdk wire — works end-to-end against a real model. (The model's
answer content is the model's business; the framework's job — streaming a real reply on the new
surface — passed.)

## North-star (measured this run)

- Scaffold: **151 ms**. `pnpm install`: **~7 s**. Agent-wiring: **1 file** (`agents/chat.ts`, ~7
  non-comment lines of `defineAgent(...)`).
