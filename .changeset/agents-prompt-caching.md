---
"@theokit/agents": patch
---

An agent on an Anthropic model now reads its system prompt from the provider cache on later turns. `@theokit/agents` requires `@theokit/sdk` `^5.11.0`, the release that marks the configured prompt with `cache_control` for model ids starting with `anthropic/` or `claude` (also behind `openrouter/` or `vertex/`; Bedrock ids such as `bedrock/us.anthropic.claude-…` are not matched and their requests do not change) and reports the cache counters Anthropic returns. A consumer on @theokit/sdk 5.3 to 5.10 must upgrade to 5.11.0. Measured through OpenRouter on `anthropic/claude-haiku-4.5` with a 12 261-token cached prefix: the second turn reported `cacheReadTokens` 12 261. (B-412)

Two things a caller sees change with that SDK. On the chat-completions client (OpenRouter included) `tokensInput` is now the uncached part of the prompt, so the whole prompt is `tokensInput + cacheReadTokens + cacheWriteTokens`. `tokens` and the `done` event's `usage.totalTokens` stay input plus output, so they leave the cached prompt out too. And the first turn of an Anthropic run pays the cache-write premium (1.25 times the input price); a run with one turn never reads it back.
