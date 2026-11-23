---
'@theokit/agents': minor
---

`@theokit/agents/session` adds `threadToUIMessages(rows)`, which turns transcript rows into UI messages with each tool call paired to its result, and `transcriptToText(messages, { format })` for `text`, `jsonl` and `markdown` exports. `useAgent` accepts `initialThread` to start from an existing thread.
