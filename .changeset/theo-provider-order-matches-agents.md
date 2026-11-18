---
'theokit': minor
---

`resolveProvider` now falls back in the same order as `@theokit/agents` (`openrouter > anthropic > openai`). With both `ANTHROPIC_API_KEY` and `OPENAI_API_KEY` set and a bare model id, theo used to pick OpenAI while agents picked Anthropic; both now pick Anthropic. Set `OPENAI_API_KEY` alone, or name the provider in the model id (`openai/gpt-4o-mini`), to keep OpenAI.
