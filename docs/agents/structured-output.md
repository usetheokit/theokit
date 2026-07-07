# Structured output

By default, an agent returns a raw text string. When you need a typed object — a form extracted
from a document, a classification result, a data record — use structured output. TheoKit guarantees
the response matches a Zod schema before returning it to your code.

---

## Quickstart

```ts
import { Agent } from '@theokit/sdk'
import { z } from 'zod'

const Sentiment = z.object({
  label: z.enum(['positive', 'negative', 'neutral']),
  score: z.number().min(0).max(1),
  reason: z.string(),
})

const result = await Agent.generateObject({
  schema: Sentiment,
  prompt: 'Analyse the sentiment of: "The new deploy pipeline is a game changer!"',
  model: 'anthropic/claude-sonnet-4-6',
  local: { cwd: process.cwd() },
})

console.log(result.object)
// { label: 'positive', score: 0.94, reason: 'Expresses strong approval...' }
```

`generateObject` returns a promise that resolves once the model has called the schema-matching
tool and the response validates successfully.

---

## Return value

```ts
interface GenerateObjectResult<T> {
  object: T        // Typed object — Zod-parsed and validated
  raw: unknown     // Raw input the model passed before Zod parsing
  usage: {
    inputTokens: number
    outputTokens: number
  }
}
```

`object` is the typed, validated result. If the model's response doesn't match the schema, TheoKit
retries automatically (up to `maxRetries` attempts, default 1 retry).

---

## Options

```ts
await Agent.generateObject({
  schema: MySchema,         // z.ZodType — the shape you expect (required)
  prompt: '...',            // User prompt to send (required)
  model: '...',             // Model selection (required)
  local: { cwd: '...' },   // Local runtime config (required)
  systemPrompt: '...',      // Optional — override the default structured-output prompt
  apiKey: '...',            // Optional — falls back to env var
  maxRetries: 2,            // Optional — retry budget on schema mismatch (default: 1)
})
```

---

## Streaming structured output

For long responses or when you want partial progress, use `streamObject`. It yields partial updates
as the model fills in the schema fields:

```ts
import { Agent } from '@theokit/sdk'
import { z } from 'zod'

const Report = z.object({
  title: z.string(),
  summary: z.string(),
  bulletPoints: z.array(z.string()),
  confidence: z.number(),
})

const stream = Agent.streamObject({
  schema: Report,
  prompt: 'Write a report on TypeScript adoption trends in 2025.',
  model: 'anthropic/claude-sonnet-4-6',
  local: { cwd: process.cwd() },
})

for await (const partial of stream) {
  // partial.object may have only some fields filled — undefined for not-yet-filled fields
  if (partial.object?.summary) {
    console.log('Summary so far:', partial.object.summary)
  }
}

// After the loop, the final object is fully populated and valid
```

---

## How it works

TheoKit uses a **synthetic `output` tool** approach. When you call `generateObject` or
`streamObject`, the SDK:

1. Creates a transient agent with a single tool named `output` whose input schema matches
   your Zod schema.
2. Tells the model: *"Call the `output` tool with your structured answer."*
3. Intercepts the tool call, runs the input through `z.parse()`, and returns the typed result.
4. If the parse fails and retries remain, re-prompts the model with the validation error.
5. Disposes the transient agent after the result is captured.

This approach works across all providers TheoKit supports — including models that don't have
native structured-output APIs.

---

## Zod is required

Structured output requires Zod as an optional peer dependency:

```bash
pnpm add zod
```

Both Zod 3 and Zod 4 are supported. The SDK detects the version at runtime.

---

## Nested schemas and arrays

Any valid Zod schema works — nested objects, arrays, discriminated unions:

```ts
const ExtractedData = z.object({
  entities: z.array(z.object({
    name: z.string(),
    type: z.enum(['person', 'org', 'location']),
    confidence: z.number(),
  })),
  summary: z.string(),
  language: z.string().optional(),
})

const result = await Agent.generateObject({
  schema: ExtractedData,
  prompt: `Extract entities from: "${text}"`,
  model: 'openai/gpt-4o',
  local: { cwd: process.cwd() },
})

for (const entity of result.object.entities) {
  console.log(`${entity.name} (${entity.type}): ${entity.confidence}`)
}
```

---

## Structured output on agent instances

`generateObject` and `streamObject` are static methods on `Agent` — they create transient,
single-use agents. For recurring structured extraction within a conversational agent (one
that maintains history), define a tool that returns the structured data:

```ts
import { defineAgent } from '@theokit/agents'
import { defineAgentTool } from 'theokit/server'
import { z } from 'zod'

const extractContact = defineAgentTool({
  name: 'extract_contact',
  description: 'Extract contact info from the message and store it.',
  inputSchema: z.object({
    name: z.string(),
    email: z.string().email().optional(),
    phone: z.string().optional(),
  }),
  handler: async (contact) => {
    await db.contacts.upsert(contact)
    return `Saved contact: ${contact.name}`
  },
})

export default defineAgent({
  model: 'anthropic/claude-sonnet-4-6',
  system: 'You are a contact manager. When the user gives you contact info, extract and save it.',
  tools: [extractContact],
})
```

The model calls the tool when it detects contact data; your handler receives the parsed,
typed input.

---

## Error strategy on validation failure (M14)

By default, if the model's output still fails schema validation after all retries, `generateObject`
throws `GenerateObjectError('parse_failed')`. `errorStrategy` changes that:

```ts
const { object, raw } = await Agent.generateObject({
  schema: Report,
  prompt: '...',
  model: 'anthropic/claude-sonnet-4-6',
  local: { cwd: process.cwd() },
  errorStrategy: 'return-partial', // 'throw' (default) | 'return-partial' | 'return-raw'
})
```

- `'throw'` — the default; raises `GenerateObjectError`.
- `'return-raw'` — resolves with the raw, unvalidated input the model sent (inspect `raw`).
- `'return-partial'` — for object schemas, keeps only the fields that individually validate.

Shipped in `@theokit/sdk@2.19.0`.

## What TheoKit doesn't have (yet)

**Multiple schema providers** — Mastra supports Valibot, ArkType, and raw JSON Schema in
addition to Zod. TheoKit only supports Zod. See the [feature backlog](./feature-backlog.md).

**Separate structuring model** — running a cheap fast model just for the structured extraction
step (while using a larger model for reasoning) is not built in. Workaround: call
`Agent.generateObject` with a smaller model after the main agent produces its reasoning.

---

## Related

- [Using tools](./using-tools.md) — tools are the building block structured output builds on
- [Overview](./overview.md) — agent fundamentals
- [Memory](./memory.md) — persist structured data across conversations
