# Human-in-the-loop

Some agent actions need a human to approve them before they run — deploying to production,
sending emails, deleting data. Human-in-the-loop (HITL) lets you pause the agent at specific
tool calls and wait for an explicit approve/deny from your interface.

---

## How it works

When a gated tool is about to run:

1. The agent emits an `approval_required` event on the SSE stream.
2. The run pauses — the agent holds its context and waits.
3. Your UI surfaces the question to the human.
4. The human approves or denies via `POST /api/agents/<name>/approve/<approvalId>`.
5. If approved, the tool runs and the agent continues normally.
6. If denied or timed out, the agent receives an error result and can reason about it.

The agent's LLM loop is genuinely paused (not polling) — the SSE connection stays open and the
run resumes from exactly the same state.

---

## Gating a tool

Use `@HumanInTheLoop` on any `@Tool` method in an `@Agent` class:

```ts
import { Agent, Tool, Toolbox } from '@theokit/agents'
import { HumanInTheLoop } from '@theokit/agents'
import { z } from 'zod'

@Agent({ model: 'anthropic/claude-sonnet-4-6' })
export class OpsAgent {
  @Tool({
    name: 'deploy',
    description: 'Deploy the app to production. Requires human approval.',
    input: z.object({
      environment: z.enum(['staging', 'production']),
      version: z.string(),
    }),
  })
  @HumanInTheLoop({
    question: 'Confirm deployment to production?',
    timeout: 300_000,        // 5 minutes (default)
    onTimeout: 'abort',      // 'abort' | 'proceed' | 'retry'
    showInput: true,         // show the tool arguments to the approver (default: true)
  })
  async deploy({ environment, version }: { environment: string; version: string }) {
    return deployToEnvironment(environment, version)
  }
}
```

`@HumanInTheLoop` options:

| Option | Type | Default | Description |
|---|---|---|---|
| `question` | `string` | required | Text shown to the human approver |
| `timeout` | `number` | `300_000` | Timeout in milliseconds before `onTimeout` fires |
| `onTimeout` | `'abort' \| 'proceed' \| 'retry'` | `'abort'` | Action when timeout expires |
| `showInput` | `boolean` | `true` | Whether to show the tool input to the approver |

---

## The approval event

When the agent hits a gated tool, the stream emits an `approval_required` event before
the tool executes:

```json
{
  "type": "approval_required",
  "callId": "abc-123",
  "toolName": "deploy",
  "question": "Confirm deployment to production?",
  "input": { "environment": "production", "version": "1.4.2" },
  "callbackUrl": "approve/abc-123",
  "timeoutMs": 300000
}
```

- `callId` — the unique ID for this approval request.
- `callbackUrl` — relative path for the approve/deny POST (relative to the agent endpoint).
- `input` — the tool arguments the model wants to pass, visible to the approver when `showInput: true`.

---

## Responding to an approval request

**Approve** — the tool runs and the agent continues:

```ts
await fetch(`/api/agents/ops-agent/approve/abc-123`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ approved: true }),
})
```

**Deny** — the tool is skipped and the agent receives an error result it can reason about:

```ts
await fetch(`/api/agents/ops-agent/approve/abc-123`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ approved: false, reason: 'Not during business hours.' }),
})
```

---

## Handling HITL events in `useAgent`

On the client side, `useAgent` surfaces the approval request as a message part. Listen for it
and render an approval UI:

```tsx
import { useAgent } from 'theokit/client'

function AgentChat() {
  const { messages, send } = useAgent('ops-agent')

  const pendingApprovals = messages
    .flatMap(m => m.parts ?? [])
    .filter(p => p.type === 'tool-invocation' && p.state === 'approval-required')

  return (
    <div>
      {pendingApprovals.map(approval => (
        <ApprovalCard
          key={approval.callId}
          question={approval.question}
          input={approval.input}
          onApprove={() => fetch(`/api/agents/ops-agent/approve/${approval.callId}`, {
            method: 'POST',
            body: JSON.stringify({ approved: true }),
          })}
          onDeny={() => fetch(`/api/agents/ops-agent/approve/${approval.callId}`, {
            method: 'POST',
            body: JSON.stringify({ approved: false }),
          })}
        />
      ))}
      {/* chat messages */}
    </div>
  )
}
```

---

## Timeout behaviour

When the timeout expires, `onTimeout` determines what happens:

| `onTimeout` | Behaviour |
|---|---|
| `'abort'` | The tool call is cancelled. The agent receives an error result: `"Tool 'deploy' denied by human approver"`. The agent can reason about the denial. |
| `'proceed'` | The tool runs without approval — useful for low-risk actions where a timeout means "go ahead". |
| `'retry'` | The agent re-emits the approval request. The human gets another chance to respond. |

---

## Multiple gated tools

Gate as many tools as needed. Each gated tool produces a separate `approval_required`
event — the agent can only proceed with one at a time (it holds at the first tool that
requires approval until that approval resolves).

```ts
@Agent({ model: 'anthropic/claude-opus-4-8' })
export class AdminAgent {
  @Tool({ name: 'delete_user', ... })
  @HumanInTheLoop({ question: 'Delete this user account? This cannot be undone.', timeout: 120_000 })
  async deleteUser({ userId }: { userId: string }) { ... }

  @Tool({ name: 'send_email', ... })
  @HumanInTheLoop({ question: 'Send this email to the customer?', showInput: true })
  async sendEmail({ to, subject, body }: { to: string; subject: string; body: string }) { ... }

  @Tool({ name: 'list_users', ... })
  // No @HumanInTheLoop — this tool runs immediately without approval
  async listUsers() { ... }
}
```

---

## HITL in workflows

For workflow-level pause/resume (not just a single tool), use `Workflow.suspend()` and
`Workflow.resume()`:

```ts
import { Workflow } from '@theokit/sdk'

const approval = new Workflow('content-approval')
  .step('draft', async (ctx) => {
    return agentDraft(ctx.input)
  })
  .step('human-review', async (ctx) => {
    // Pause here — the workflow suspends and can be resumed later
    await ctx.suspend({ payload: { draft: ctx.prev } })
    // Execution continues here after ctx.resume() is called
    return { approved: ctx.resumePayload.approved }
  })
  .step('publish', async (ctx) => {
    if (ctx.prev.approved) await publish(ctx.prev.draft)
  })

// Suspend the workflow — returns a runId
const { runId } = await approval.run({ topic: 'AI trends 2025' })

// Later — resume with the human's decision
await approval.resume(runId, { approved: true })
```

`Workflow.suspend()` is for structured multi-step workflows. `@HumanInTheLoop` is for
per-tool approvals within a single agent run. Pick the right primitive for the job.

---

## Approvals on `defineAgent` (M14)

`@HumanInTheLoop` gates tools on the `@Agent` class surface; the `defineAgent` surface gates
them via the `approvals` map, keyed by tool name — reusing the same endpoint HITL wiring:

```ts
export default defineAgent({
  model: 'anthropic/claude-sonnet-4-6',
  tools: [deployTool],
  approvals: {
    deploy: { question: 'Confirm deployment to production?', timeout: 60_000, onTimeout: 'abort' },
  },
})
```

An approval that names an undeclared tool fails fast at compile time.

## Listing pending approvals (M14)

`GET /api/agents/<name>/approvals` lists the currently-pending approvals with their metadata
(`toolName`, `question`, `expiresAt`) — the `ApprovalRegistry` tracks them via `list()`. Useful
for a dashboard that surfaces everything awaiting a human decision.

Both shipped in `@theokit/agents@0.31.0` + `theokit@0.16.0`.

---

## Related

- [Using tools](./using-tools.md) — tools are the primitives HITL gates
- [Multi-agent](./multi-agent.md) — HITL composes naturally with supervisor patterns
- [Overview](./overview.md) — agent fundamentals
