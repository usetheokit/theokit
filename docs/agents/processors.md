# Processors (lifecycle hooks)

Observe and control every step of an agent run — log each tool call, veto a dangerous one, or watch
each LLM turn — without touching the agent's logic. Processors are a plugin over the SDK's own
lifecycle hooks.

---

## Quickstart

```ts
import { createToolHooksPlugin } from '@theokit/agents'

const audit = createToolHooksPlugin({
  beforeToolCall: ({ name, args }) => {
    console.log('tool →', name, args)
    if (name === 'delete_everything') return { block: true, message: 'blocked by policy' }
  },
  afterToolCall: ({ name, result }) => console.log('tool ←', name, result),
  beforeLLMCall: ({ agentId, runId, iteration }) => console.log('llm turn', iteration),
  afterLLMCall: ({ iteration }) => console.log('llm done', iteration),
})
```

The returned object is a `@theokit/sdk` plugin — pass it wherever the runtime accepts plugins.

---

## Hooks

| Hook | Fires | Can veto? | Context |
|---|---|---|---|
| `beforeToolCall` | before each tool runs | ✅ return `{ block, message }` | `{ name, args }` |
| `afterToolCall` | after each tool returns | — | `{ name, result }` |
| `beforeLLMCall` | before each LLM turn | — | `{ agentId, runId, iteration }` |
| `afterLLMCall` | after each LLM turn | — | `{ agentId, runId, iteration }` |

Only the hooks you provide are registered — the plugin is inert when you pass none, so it adds no
overhead unless used.

---

## Veto a tool call

`beforeToolCall` returning `{ block, message }` stops the tool; the SDK surfaces `message` as the
tool result and the model reasons about the denial. Returning nothing allows the call.

```ts
createToolHooksPlugin({
  beforeToolCall: ({ name, args }) => {
    if (name === 'send_email' && !isBusinessHours()) {
      return { block: true, message: 'Email sending is disabled outside business hours.' }
    }
  },
})
```

For a human-gated version (pause and wait for approval), use
[human-in-the-loop](./human-in-the-loop.md) instead.

---

## How it works

`createToolHooksPlugin` registers on the SDK's native `pre_tool_call` / `post_tool_call` /
`pre_llm_call` / `post_llm_call` hooks — the same mechanism the HITL plugin uses. It observes and
vetoes; it does not reimplement the loop. LLM-turn hooks are **observability** (the SDK's LLM-call
context carries `agentId` / `runId` / `iteration`, not the mutable request body).

---

## Related

- [Human-in-the-loop](./human-in-the-loop.md) — pause a tool for a human decision
- [Guardrails](./guardrails.md) — boundary input/output moderation
- [Feature backlog](./feature-backlog.md) — parity tracker (M10)
