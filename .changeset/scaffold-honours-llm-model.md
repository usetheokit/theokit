---
'create-theokit': patch
---

The scaffold's documented `LLM_MODEL` override is read.

`.env.example` offered the variable and nothing in the framework read it, so a developer who
uncommented it, set a model and restarted got the model `agents/chat.ts` declares — silently. The
outcome is indistinguishable from the override working and picking the same value, which sends the
reader looking for the cause somewhere else entirely.

The generated agent now reads it where the model is already declared:

```ts
.model(process.env.LLM_MODEL ?? 'openai/gpt-4o-mini')
```

No framework surface was added. The model lives in a file the developer owns and edits, so a knob a
template can honour in one expression does not need an override path threaded through the
framework — and the value stays visible in the file that decides it. The literal remains as the
fallback, because a scaffold has to run with no environment at all.

The comment beside it named `ModelCapability`, a concept that exists only inside the agents package
and its tests and appears nowhere a scaffolded app can reach. It now names `agents/chat.ts`, which
is a file the reader has.
