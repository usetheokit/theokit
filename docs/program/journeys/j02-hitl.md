# J2 — HITL

The second of the ten benchmark journeys (`../dx-benchmark.md`). Criteria written before either
implementation exists; a journey whose criteria change after code exists is void and must be re-run
from scratch.

**Scheduling status:** hold, and the hold shrank on 2026-08-20. `../dx-benchmark.md` § Sequencing
holds J2 until the authorization ADR lands; ADR 0001's core guarantee has since been implemented and
verified, and § Current state and blockers below re-measures what that leaves.

## What the journey requires

Copied from `../dx-benchmark.md` § The ten journeys, unchanged. Rewording it requires an ADR,
because a movable target measures nothing.

| # | Journey | What must work |
| --- | --- | --- |
| J2 | **HITL** | A tool call pauses for human approval; approving resumes it, rejecting does not run it |

Three obligations, and the third is the one that is easy to fake: **rejecting does not run it**. A
system that runs the tool and discards the result satisfies the first two and fails the journey, so
the criteria below grade the tool's side effect rather than the response body.

## Acceptance criteria

In the shape `ROADMAP.md` uses: observable, with an oracle, graded by `/acceptance` against the
released artifact rather than the working tree (`.claude/rules/cycle-acceptance.md` § Target kinds).

**Definition of done (all must hold):**

- [ ] a run that reaches a gated tool emits an approval-request event carrying an id, and the run
      does not complete while the decision is outstanding — observed as: the event is received, and
      no terminal event arrives within a window at least twice the observed latency of the same run
      with the gate removed
- [ ] approving resumes the same run: the tool's recorded side effect appears **after** the approval
      is posted and not before, ordered by timestamps captured on the client, and the final answer
      contains the tool's output
- [ ] rejecting does not run the tool: the side effect is absent for the whole life of the run, and
      the run terminates with a refusal the caller can read — asserted on the side effect, never on
      the response text alone
- [ ] the approval id is not sufficient to decide: a caller who did not start the run, holding a
      valid id, is refused, and the tool's side effect stays absent — replayed as a second client
      with its own session against an id captured from the first
- [ ] a decision that arrives after the timeout is refused by name rather than silently applied, and
      the run's own timeout outcome is the one the framework documents rather than a default the
      caller has to discover
- [ ] Applies to: Web, Tauri, TUI — each listed target is exercised in acceptance, not merely
      declared
- [ ] Tauri: the pause and the decision both travel the in-process path, and the ownership check of
      criterion 4 is the same check the HTTP path runs, not a second implementation behind IPC
- [ ] TUI: same seam, same shared check; the pause is rendered through the shared terminal
      presenter rather than a terminal-specific approval flow

**What resisted an oracle.** "The human understood what they were approving" is the thing that
actually matters and is not measurable by a run. The nearest gradeable substitute — the approval
event carries the tool name and the resolved input — is folded into criterion 1's payload rather
than claimed as a separate criterion, because a field being present is not comprehension and
pretending otherwise would inflate the score.

## The Next.js side

**An equivalent exists, but as a documented recipe rather than a framework primitive** — and that
distinction is itself part of what this journey measures.

The reference implementation: a tool declared **without** an `execute` function so the SDK surfaces
it as a pending call, a client that renders confirm/deny, and a resume path that submits the tool
result and continues the conversation. Vercel documents this as a human-in-the-loop cookbook entry
for Next.js. Where an official example exists it must be used and cited
(`../dx-benchmark.md` § Why the protocol comes before the measurement).

*To confirm at implementation time, because these are version-specific and this document is written
without access to that source:* the current name of the client-side function that submits a tool
result, whether the omit-`execute` mechanism is still the documented one, and whether the cookbook
entry addresses persistence of the pending state across a reload at all — if it does not, that is a
finding about the recipe, not a licence to build a stronger version on our side.

The comparison is fair because both sides must produce the same four things: a way to mark a tool as
gated, a pause the client can see, a decision channel, and a resume. It is also where the Next.js
side is likely to pay in glue lines and where ours is likely to pay in the criterion-4 check —
which is exactly the trade the benchmark exists to price.

## How the four metrics are counted here

The general counting rule is in `../dx-benchmark.md` § The four metrics. What follows is that rule
landed on this journey.

**Files touched.** Counted: the agent declaration that marks the tool as gated, the tool itself if
it had to change, any approval handler or route, the client component that renders the decision,
and any store the pending state needed. Not counted: the tool's business body, reused from J1
unchanged — if it had to change to be gatable, that change **is** counted, and the reason is
recorded.

**Glue lines.** Business logic here is only the decision **policy** — which tools are gated, and
what the timeout does. Everything else is glue: the pause plumbing, the id threading, the client
component, the resume call, the ownership check. The ownership check is glue even though it is
security-relevant; the metric measures cost, and a check the framework should have supplied costs
lines on whichever side has to write it.

**Concepts required.** Derived mechanically from the imports and APIs the diff uses. Ours currently
includes the approvals map on the agent declaration
(`packages/agents/src/bridge/define-agent.ts:70`) or its builder equivalent
(`packages/agents/src/bridge/agent-builder.ts:324`), the approval id, the approve endpoint's path
shape, and the timeout semantics. The timeout counts as a concept because it changes behaviour
silently if unknown — see the current-state note below.

**Time to first green run.** Wall clock from `npx create-theokit` to the first run where all five
assertions pass. Cold cache, at least three runs, mean and standard deviation. The human decision
is scripted, not typed by a person: an unautomated pause would measure typing speed.

## The deliberately broken state

Per `../dx-benchmark.md` § The fifth, which is pass/fail and not a number. The break for J2 is the
one the benchmark names in its own sentence: **absent approval** — the decision never arrives.

| | |
| --- | --- |
| Names the action | `approval "ap_9f2" for tool "sendEmail" expired after 300s with no decision; the run was aborted. Decide within the window, or raise timeoutMs on the tool's approval options.` — names the id, the tool, the elapsed budget, the outcome that was applied, and the knob |
| Does not name the action | `Error: aborted`, or a run that simply ends with no explanation, or — worst here — a run that **proceeds** and reports success |

**A second break, because it is the one this journey is held on: a decision posted by the wrong
caller.** Today that is not an error at all, so the transcript will record a silent success (see
below). Once the ADR lands, the message that names the action reads like
`approval "ap_9f2" belongs to a run this caller did not start.` and the message that does not reads
`403 Forbidden` with an empty body.

**As in J8, absence of an error is graded as a failure of this metric, not as unmeasurable.** The
worst outcome of an absent approval is not an unhelpful message; it is the tool running anyway.

## Current state and blockers

Measured against the working tree on 2026-08-20; every claim is read from source.

**The mechanism works. The authorization does not exist.**

What is wired end to end:

- Declaration is an `approvals` map on the agent, compiled to a lookup with fail-fast on an unknown
  tool name (`packages/agents/src/bridge/define-agent.ts:70`, compiled at `:301`), with builder
  equivalents (`packages/agents/src/bridge/agent-builder.ts:324`).
- The pause is an awaited `pre_tool_call` hook that mints an id and blocks
  (`packages/agents/src/bridge/hitl-plugin.ts:78`, id at `:89`, the await at `:101`), and a denial
  returns a block rather than letting the call through (`:111`). It is wired into the production
  stream (`packages/agents/src/bridge/agent-endpoint.ts:258`).
- The decision arrives at a real handler on both servers — production
  (`packages/theo/src/cli/commands/start/handlers.ts:246`) and dev
  (`packages/theo/src/vite-plugin/agent-middleware.ts:83`), both reaching
  `packages/theo/src/server/agent/approve-agent.ts:83`.

**The blocker, stated precisely: the approve endpoint authenticates nobody — and as of 2026-08-20
that is no longer for want of a primitive.**

Its only controls are CSRF, a path parse and a body-shape check
(`packages/theo/src/server/agent/approve-agent.ts:89`), and the pending record has no owner field to
check against — it is `{ approvalId, toolName?, question?, expiresAt, payloadSchema? }`
(`packages/theo/src/server/agent/approval-registry.ts:50`), settled by id alone (`:70`, implemented
at `:123`). The listing endpoint returns every pending approval in the process with no filter
(`packages/theo/src/server/agent/list-approvals-handler.ts:19`). A repository-wide search of that
handler for a caller identity finds none. So criterion 4 fails today.

**What changed, and it changed the shape of the blocker rather than removing it.** ADR 0001's first
three decision points are implemented and verified: a route may declare a policy
(`packages/theo/src/core/contracts/route-config.ts:69`), the framework supplies the owner check it
previously lacked (`packages/theo/src/core/contracts/route-policy.ts:84`), and one evaluation
function is called by all three transports — the Node executor
(`packages/theo/src/server/http/execute.ts:268`), the Web executor
(`packages/theo/src/server/web-handler.ts:260`) and the in-process caller
(`packages/theo/src/server/http/in-process-caller.ts:103`) — with a parity test asserting an
identical decision for the same subject across them
(`tests/unit/access-decision-parity.test.ts:12`). The ADR records the split status on its own status
line (`docs/adr/0001-authorization-is-transport-independent.md:3`) and in a dedicated section
(`:53`).

**The approve endpoint is not a route, so none of that reaches it.** It is dispatched directly by
each server rather than through the executors that evaluate a policy
(`packages/theo/src/cli/commands/start/handlers.ts:246`,
`packages/theo/src/vite-plugin/agent-middleware.ts:83`), and no policy is declared for it. The
sentence the ADR wrote about this endpoint — *"an endpoint whose only control was CSRF, which
authenticates nobody"* (`docs/adr/0001-authorization-is-transport-independent.md:19`) — still
describes it exactly.

So J2's blocker is now **small and specific rather than undecided**: give the approve and list
endpoints a subject and an owner, using the primitive that now exists. That is code, not a decision —
the same category of blocker as J4's, and a materially smaller one than it was this morning.

Two further findings that change how J2 will score once it runs, recorded now so they are not
discovered mid-measurement:

- **Pending state is a process-local map** (`packages/theo/src/server/agent/approval-registry.ts:96`),
  by explicit YAGNI decision recorded in the module (`:11`). A reload survives it only because the
  server process does; a second instance shares nothing. This is the same durability boundary J4
  hits from the other side.
- **The timeout default auto-settles**, and which way it settles depends on the configured
  `onTimeout` (`packages/theo/src/server/agent/approval-registry.ts:107`), with a 300-second default
  (`packages/theo/src/server/agent/build-agent-streamer.ts:38`). Criterion 5 grades this
  deliberately: a gate that silently proceeds on timeout is a gate that fails open.

**Three implemented-and-unwired surfaces sit next to this journey and none of them is on its path** —
recorded so the benchmark does not mistake them for the mechanism: the pending ledger
(`packages/agents/src/ask/pending-ledger.ts:76`, whose own header records that it shipped unused at
`:41`), the ask bridge (`packages/agents/src/ask/ask-bridge.ts:139`), and the hook approval store
(`packages/agents/src/hooks/approval-store.ts:89`).

**Not measured:** whether the advisory GHSA-g94h-459g-rjhj is still open upstream. The repository
references it; the tracker was not queried.

## Cross-references

- The benchmark this journey belongs to: `../dx-benchmark.md`
- The decision this journey waits on: `../../adr/0001-authorization-is-transport-independent.md`
- The journey whose isolation property is a strict superset of criterion 4: `j08-tenant.md`
- The journey whose durability boundary this shares: `j04-thread.md`
- Acceptance contract that grades these criteria: `../../../.claude/rules/cycle-acceptance.md`
- Criterion shape these follow: `../../../ROADMAP.md` § Wave 1
