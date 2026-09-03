# Environment

Configuration lives in `.env` (copy `.env.example`). Nothing here is committed — `.env` is gitignored.

| Variable             | Required     | What it does                                                                  |
| -------------------- | ------------ | ----------------------------------------------------------------------------- |
| `OPENROUTER_API_KEY` | one of these | Provider key. OpenRouter is the default gateway (many models behind one key). |
| `ANTHROPIC_API_KEY`  | one of these | Use Anthropic directly instead of OpenRouter.                                 |
| `OPENAI_API_KEY`     | one of these | Use OpenAI directly.                                                          |

The FIRST segment of the model id in `src/server/agents/chat.ts` picks the provider, and that decides which key
is needed. It is not a hint: `openai/gpt-4o-mini` goes to OpenAI and needs `OPENAI_API_KEY`, even
with an OpenRouter key present. Reaching another vendor's catalog THROUGH OpenRouter means naming
the gateway first — `openrouter/openai/gpt-4o-mini`, which is what the scaffold declares, matching
the key above. See <https://openrouter.ai/models> for the ids OpenRouter serves.

| Model id in `src/server/agents/chat.ts`    | Key it needs         |
| ------------------------------- | -------------------- |
| `openrouter/openai/gpt-4o-mini` | `OPENROUTER_API_KEY` |
| `anthropic/claude-sonnet-4-6`   | `ANTHROPIC_API_KEY`  |
| `openai/gpt-4o-mini`            | `OPENAI_API_KEY`     |

```bash
cp .env.example .env
# then set your key
echo 'OPENROUTER_API_KEY=sk-or-v1-…' >> .env
npm run dev
```
