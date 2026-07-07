# Multi-agent patterns

Sometimes a task is too large or too varied for a single agent. TheoKit gives you two
patterns for composing agents:

| Pattern | When to use |
|---|---|
| **Supervisor + subagents** | Open-ended tasks where the supervisor decides which specialist to call |
| **Sequential squad** | Fixed pipelines where step order is known upfront |

---

## Supervisor with subagents

A supervisor agent delegates work by calling subagents as tools. The parent model decides
when to delegate and which subagent to use — you don't wire the flow manually.

```ts
// agents/supervisor.ts
import { defineAgent } from '@theokit/agents'
import { defineSubAgent } from '@theokit/sdk/a2a'

const researcher = defineSubAgent({
  name: 'researcher',
  description: 'Research a topic and return a factual summary. Call when you need external information.',
  instructions: 'You are a factual research assistant. Return concise, sourced summaries.',
  model: 'openai/gpt-4o-mini',
})

const writer = defineSubAgent({
  name: 'writer',
  description: 'Write polished prose from research notes. Call when you have raw material to shape.',
  instructions: 'You are a technical writer. Turn research notes into clear, structured articles.',
  model: 'anthropic/claude-sonnet-4-6',
})

export default defineAgent({
  model: 'anthropic/claude-opus-4-8',
  system: `You are an editor. For each request:
1. Use the researcher to gather facts.
2. Use the writer to shape those facts into a draft.
3. Review and return the final draft.`,
  tools: [researcher, writer],
})
```

`defineSubAgent` returns a tool. The supervisor model calls it by name when it decides
delegation is appropriate — the same way it calls any other tool.

### How delegation works

When the supervisor calls a subagent tool:
1. A new child agent is created with the spec's `model` and `instructions`.
2. The LLM-supplied `input` string is sent as the child's first message.
3. The child runs its full reasoning loop (which may include its own tool calls).
4. The child's final response is returned as the tool result to the supervisor.
5. The child agent is disposed.

The supervisor and subagent are completely isolated — they have separate contexts,
separate conversation histories, and separate tool sets.

### Limiting recursion depth

Subagents can themselves have subagents. To prevent infinite delegation loops:

```ts
const subagent = defineSubAgent({
  name: 'analyst',
  description: 'Analyse data and produce a report.',
  instructions: 'You are a data analyst.',
  maxDelegationDepth: 2,   // default: 3
})
```

When the depth limit is exceeded, `MaxDelegationDepthError` is thrown and the delegation
stops. The supervisor receives an error tool result and can reason about it.

### Restricting subagent tool access

Give a subagent access to only the tools it needs — not the supervisor's full set:

```ts
import { createReadFileTool, createSearchTextTool } from '@theokit/sdk-tools'

const researcher = defineSubAgent({
  name: 'code-researcher',
  description: 'Search and read files. Call for questions about the codebase.',
  instructions: 'You are a code analyst. Read files and search the codebase.',
  tools: [
    createReadFileTool({ projectRoot: process.cwd() }),
    createSearchTextTool({ projectRoot: process.cwd() }),
    // no write/edit/shell — researcher is read-only
  ],
})
```

---

## Sequential squads

When the pipeline is fixed — step A always feeds step B — use `createSquad`:

```ts
import { createSquad } from '@theokit/sdk'

const pipeline = createSquad({
  agents: [scraperAgent, summarizerAgent, editorAgent],
})

const result = await pipeline.run('Summarize the latest React blog posts')
// scraper runs → its output feeds summarizerAgent → its output feeds editorAgent
// result.result is the editor's final output
```

Each agent's output is the next agent's input (plain string threading). `result.steps`
contains the per-agent trace so you can inspect intermediate outputs.

`createSquad` is a thin wrapper over `Workflow` + `agentStep`. For branching, parallel
execution, or conditional logic use `Workflow` directly.

---

## Memory isolation

Each subagent delegation uses its own agent instance with no shared conversation history.
If you want subagents to share context, pass the relevant information in the delegation
prompt rather than via shared memory.

For a stable resource ID across delegations (useful when subagents write to durable memory
and you want facts attributed to the same user):

```ts
const researcher = defineSubAgent({
  name: 'researcher',
  description: 'Research tool.',
  instructions: `You are a researcher. Resource ID: ${userId}-researcher`,
  // conventions: {parentUserId}-{agentName} keeps facts attributable
})
```

---

## Delegation hooks (M12)

The programmatic `delegate()` primitive accepts two observability hooks — a supervisor can rewrite
the sub-agent's input before it runs, and transform/score/redact the result before it returns.
These are observability over the existing delegation (no new orchestration engine).

```ts
import { delegate } from '@theokit/agents'

const result = await delegate(ResearchAgent, task, {
  apiKey,
  // Runs BEFORE the sub-agent — return the input it should receive (rewrite or pass through).
  onDelegationStart: ({ subAgent, input }) => `[persona: concise researcher]\n${input}`,
  // Runs AFTER the sub-agent — return the result the supervisor sees (transform or pass through).
  onDelegationComplete: ({ subAgent, result }) => ({
    ...result,
    response: redactSecrets(result.response),
  }),
})
```

`abortSignal` propagation already works — pass `signal` and aborting cancels an in-flight
delegation. Both hooks may be async.

## What TheoKit doesn't have (yet)

**Message filtering** — controlling which messages from the supervisor's context are shared
with the subagent before delegation. `delegate()` takes a single `input` string, not a message
history; `messageFilter` over a multi-turn history maps to the SDK squad surface (`createSquad`
in `@theokit/sdk/a2a`), not this primitive.

---

## Related

- [Using tools](./using-tools.md) — tools are the building block that subagents build on
- [Overview](./overview.md) — agent fundamentals
- [Run context](./run-context.md) — pass context (userId, tenantId) through delegation chains
