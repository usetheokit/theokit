# agent-saas

Ship an agent your team can actually approve. This example is the **cohesive harness** in two files:
an agent that pauses for a human before it does something risky, and a page where you approve it.

## What you get

- **A human gate on a tool.** `ops.deploy` is marked "needs a human" — before it runs, the agent
  stops and asks. You approve or deny from the dashboard; the agent picks up where it left off.
- **Resume across requests.** The conversation is checkpointed, so a follow-up in the same session
  continues from the last turn instead of starting over.

Both come from decorators on the agent — no orchestration code, no second runtime. `@theokit/sdk`
runs the agent; the framework only wires its output onto the wire and back.

## How it works

- [`agents/ops.ts`](agents/ops.ts) — an `@Agent` whose `ops.deploy` tool carries `@HumanInTheLoop`
  (the gate) and `@Checkpoint({ storage: 'filesystem' })` (resume). Dropping it at `agents/ops.ts`
  mounts `POST /api/agents/ops`.
- [`app/page.tsx`](app/page.tsx) — `useAgent('/api/agents/ops')` streams the run. When the gate
  fires, the stream carries a `tool-approval-request`; the page POSTs the decision to
  `POST /api/agents/ops/approve/<approvalId>`, which resolves the paused run.

### The pause, precisely

The pause is the SDK's own async `pre_tool_call` hook (the framework's HITL plugin returns a Promise
the SDK loop `await`s). No polling, no second connection: one open stream, paused mid-run, resumed by
the approve request. On approve the tool runs; on deny or timeout the model receives the denial and
the run continues coherently.

## Status

Pattern reference, not a published package. The end-to-end behavior (pause → approve → run → done,
the deny path, and resume) is covered by the deterministic harness E2E in
`packages/agents/tests/integration/hitl-harness.test.ts`.
