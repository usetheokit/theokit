---
"@theokit/agents": minor
---

`createOpenAICompatibleRoutes` answers `stream: true` with `chat.completion.chunk` server-sent events ending in `data: [DONE]`, and puts `usage` (`prompt_tokens`, `completion_tokens`, `total_tokens`) in the non-stream body and the final chunk. `complete` may return `{ text, usage }` and receives an `onDelta` callback while streaming. (#1518)
