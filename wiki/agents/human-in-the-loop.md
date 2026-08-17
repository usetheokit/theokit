---
type: Agent Guide
title: Human-in-the-loop
description: Gating agent actions behind a human approval before they run.
tags: [agents, hitl, safety]
status: stable
generated: { by: theokit-agent/unrecorded, at: 2026-07-24T00:00:00Z }
migrated: { by: claude-opus-5/okf-skill, at: 2026-08-06T00:00:00Z, from: pre-wiki documentation tree }
sources:
  - id: origin
    resource: pre-wiki documentation tree
    title: Original document, absorbed into this bundle verbatim
    last_modified: 2026-07-24
---

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

Declare `hitl` on the tool in the toolbox's `static tools`:

```ts
import {
  applyCapabilities,
  ModelCapability,
  ToolboxCapability,
  type ToolDeclaration,
} from '@theokit/agents'
import { z } from 'zod'

export class OpsTools {
  static readonly tools: ToolDeclaration[] = [
    {
      name: 'deploy',
      description: 'Deploy the app to production. Requires human approval.',
      input: z.object({
        environment: z.enum(['staging', 'production']),
        version: z.string(),
      }),
      method: 'deploy',
      hitl: {
        question: 'Confirm deployment to production?',
        timeout: 300_000,   // 5 minutes (default)
        onTimeout: 'abort', // 'abort' | 'proceed' | 'retry'
        showInput: true,    // show the tool arguments to the approver (default: true)
      },
    },
  ]

  async deploy({ environment, version }: { environment: string; version: string }): Promise<string> {
    return deployToEnvironment(environment, version)
  }
}

export const opsAgent = applyCapabilities([
  new ModelCapability('anthropic/claude-sonnet-4-6'),
  new ToolboxCapability(new OpsTools(), { namespace: 'ops' }),
])
```

`hitl` options:

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
// (toolbox declaration — abbreviated)
export class AdminAgent {
  { name: 'delete_user', ..., method: 'deleteUser',
    hitl: { question: 'Delete this user account? This cannot be undone.', timeout: 120_000 } },
  async deleteUser({ userId }: { userId: string }) { ... }

  { name: 'send_email', ..., method: 'sendEmail',
    hitl: { question: 'Send this email to the customer?', showInput: true } },
  async sendEmail({ to, subject, body }: { to: string; subject: string; body: string }) { ... }

  // No `hitl` — this tool runs immediately without approval
  { name: 'list_users', ..., method: 'listUsers' },
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

`Workflow.suspend()` is for structured multi-step workflows. `hitl` is for
per-tool approvals within a single agent run. Pick the right primitive for the job.

---

## Approvals on `defineAgent` (M14)

`hitl` gates tools declared on a toolbox; the `defineAgent` surface gates
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

## Custom approval payload (M20)

Beyond `approved: boolean`, the approver may attach a `reason` (string) and a `payload` (object).
`POST /api/agents/<name>/approve/<id>` accepts `{ approved, reason?, payload? }` (payload capped at
16 KiB). On **denial**, the veto message folds in the reason + payload so the model self-corrects.

```ts
// Approve/deny with extra context
await fetch(`/api/agents/support/approve/${callId}`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'X-Theo-Action': '1' },
  body: JSON.stringify({ approved: false, reason: 'daily limit exceeded', payload: { maxAllowed: 100 } }),
})
```

A gated tool may declare an optional `payloadSchema` (`hitl: { payloadSchema }` or
`approvals: { <tool>: { payloadSchema } }`) that flows into the `approval_required` event +
`GET /approvals` so the UI knows what to collect. Backward-compatible with `{ approved, reason? }`.
`theokit@0.17.0` + `@theokit/agents@0.32.0`.

## Auto-approve requires evidence, not a promise (M77)

`auto-approve` is the most consequential decision a coding agent makes — "run commands without
asking". Until M77 its type asked for a sentence:

```ts
{ kind: 'auto-approve', reason: 'the sandbox confines it' }   // ← unverifiable
```

A sentence cannot be checked at the seam: nothing distinguished *"confined by bwrap,
kernel-enforced"* from *"trust me"*. So every consumer implemented the refusal itself — and the one
that prompted this milestone implemented it **twice**, in its interactive path and its headless path,
with the same rule in both. A security rule written at two call sites is a rule that will eventually
disagree with itself.

The posture now carries the sandbox's own answer:

```ts
import { resolveSandboxPosture } from '@theokit/agents/sandbox'

const confinedBy = resolveSandboxPosture({ mode: 'workspace-write' })

approvals: {
  kind: 'auto-approve',
  confinedBy,                        // SandboxPosture — { mode, enforced, detail }
  reason: 'sandboxed CI runner',
}
```

`applyPosture` **refuses** when `confinedBy.enforced === false`, and the refusal quotes `detail`:
"unconfined" sends an operator hunting, while `bwrap unavailable: no user namespaces` sends them to
the fix.

This is a **breaking** change, and that is the point: a surface that cannot prove confinement should
not be auto-approving. The two postures that carry no confinement claim — `auto-reject` and
`owned-by-surface` — are untouched.

## Asking the human a question (M77)

Approval answers *"may I run this?"*. Its sibling — the agent asking *"which branch?"* mid-turn —
had a tool (`createQuestionTool`) and, until M77, **no channel**: the tool takes an `askUser`
callback and nothing in the framework ever supplied one. A tool that cannot reach a human is a tool
that times out five minutes later with no diagnosis.

`@theokit/agents/ask` is that channel, modelled on the approval registry above:

```ts
import { askUserVia, createAskBridge } from '@theokit/agents/ask'

const bridge = createAskBridge()

// the agent side — one line of context
defineAgent({ context: { askUser: askUserVia(bridge) }, /* … */ })

// the surface side — render the prompt, send the answer back
const off = bridge.setListener(threadId, (q) => showPrompt(q.id, q.question), {
  onAbandon: () => clearPrompt(),
})
// later: bridge.answer(id, 'workspace')
// at turn end / on cancel: bridge.abandon(threadId)
```

| Behaviour | Why |
|---|---|
| One question per thread, refused with `ConcurrentQuestionError` | Two prompts at once cannot attribute an answer to either. |
| One listener per thread, refused with `ConcurrentListenerError` | Two listeners render twice and race; silently replacing makes the first surface go deaf with no signal. |
| Asking with no listener **rejects** instead of waiting | Waiting means the turn dies at the tool's own timeout, saying nothing about why. |
| `abandon()` **rejects** the captured promise | This is the bug it was built for: cancelling a run used to drop the question on the floor and hang the turn until the builtin timed out. |

### The pending ledger — for the surface, not the framework

`list()` is stateless: it reports what is pending *now*, and nothing remembers what a surface already
showed or answered. Two defects fall out — the dismissed card comes back on the next poll, and a
second click sends a second answer to an already-settled request. Memory belongs to the surface:

```ts
import { createPendingLedger } from '@theokit/agents/ask'

const ledger = createPendingLedger()
ledger.ingest(await fetchPending())     // additive; never resurrects a settled id
const next = ledger.findNext()          // oldest by message index, one at a time
if (ledger.settle(next.id)) send(next)  // `false` ⇒ already answered, do not send
ledger.pruneBefore(firstLiveMessageIndex)
```

It holds no policy: it never decides whether to approve, never talks to the registry, and never
learns what an approval means. That is why it is a pure function of its own state.

## Related

- [Using tools](./using-tools.md) — tools are the primitives HITL gates
- [Multi-agent](./multi-agent.md) — HITL composes naturally with supervisor patterns
- [Overview](./overview.md) — agent fundamentals

# Related
* [overview](/agents/overview.md) — the agent overview.

