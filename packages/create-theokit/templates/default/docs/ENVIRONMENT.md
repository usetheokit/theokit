# Environment

Configuration lives in `.env` (copy `.env.example`). Nothing here is committed — `.env` is gitignored.

| Variable | Required | What it does |
|----------|----------|--------------|
| `OPENROUTER_API_KEY` | one of these | Provider key. OpenRouter is the default gateway (many models behind one key). |
| `ANTHROPIC_API_KEY` | one of these | Use Anthropic directly instead of OpenRouter. |
| `OPENAI_API_KEY` | one of these | Use OpenAI directly. |

The agent resolves the key from the environment at runtime (OpenRouter preferred). The model id in
`agents/chat.ts` is provider-prefixed (e.g. `openai/gpt-4o-mini`) so OpenRouter routes it upstream — see
<https://openrouter.ai/models>.

```bash
cp .env.example .env
# then set your key
echo 'OPENROUTER_API_KEY=sk-or-v1-…' >> .env
npm run dev
```
