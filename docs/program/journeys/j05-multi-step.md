# J5 — Multi-step

The fifth of the ten benchmark journeys (`../dx-benchmark.md`). Criteria written before either
implementation exists; a journey whose criteria change after code exists is void and must be re-run
from scratch.

**Scheduling status:** ready. `../dx-benchmark.md` § Sequencing lists J5 in the first batch to be
implemented and measured.

## What the journey requires

Copied from `../dx-benchmark.md` § The ten journeys, unchanged. Rewording it requires an ADR,
because a movable target measures nothing.

| # | Journey | What must work |
| --- | --- | --- |
| J5 | **Multi-step** | The agent chains two tool calls where the second depends on the first |

The word doing the work is **depends**. Two calls that happen to occur in sequence prove nothing;
the second call's *input* must carry a value that only the first call's *output* could have
supplied, and the criteria below are built so that a coincidence cannot satisfy them.

## Acceptance criteria

In the shape `ROADMAP.md` uses: observable, with an oracle, graded by `/acceptance` against the
released artifact rather than the working tree (`.claude/rules/cycle-acceptance.md` § Target kinds).

**Definition of done (all must hold):**

- [ ] the transcript contains two tool-call events, in order, and the second call's recorded input
      contains a value that the first call's recorded output contained — where that value is
      randomized by the test before the run, so it cannot have come from the prompt, the system
      instructions, or the model's training
- [ ] the second tool's body observes the dependency at execution time, not only in the transcript:
      the tool records the input it actually received, and the recorded value matches the first
      call's randomized output
- [ ] the final answer contains a value produced by the **second** call, so the chain is used rather
      than merely performed — asserted against a second randomized token that only the second tool
      returns
- [ ] a declared step ceiling is honoured: with the ceiling set to one, the run stops after the first
      tool call and reports a step-limit outcome the caller can read, rather than silently completing
      or silently continuing
- [ ] the ceiling declared by the application is the one the served run uses, verified by observing
      the stop at the declared number rather than at a framework default — this criterion exists
      because § Current state records that it does not hold today
- [ ] Applies to: Web, Tauri, TUI — each listed target is exercised in acceptance, not merely
      declared
- [ ] Tauri: the same two-call chain over the in-process path, with the criterion-1 randomized-value
      oracle applied unchanged
- [ ] TUI: the same chain rendered through the shared terminal presenter, with both tool-call events
      visible in that rendering

**What resisted an oracle.** "The agent decided to chain" is not observable — a model may chain for
reasons the transcript cannot expose, and a prompt engineered hard enough turns any single-step
system into an apparent chainer. The criteria therefore grade **data flow**, which is mechanical,
and say nothing about reasoning. That is a real narrowing and it is deliberate: the alternative is a
criterion whose result depends on prompt wording, which would make the benchmark measure the prompt.

## The Next.js side

**A direct equivalent exists, and on this journey it is likely the shortest code on either side.**
The AI SDK treats multi-step as a first-class option: a single generate/stream call takes a stopping
condition, and the loop that feeds tool results back to the model is the SDK's, not the developer's.

The reference implementation: the same Route Handler as J1, with a stop condition set to allow more
than one step, and a second tool whose schema takes a field the first tool returns. Where an official
example exists it must be used and cited
(`../dx-benchmark.md` § Why the protocol comes before the measurement).

*To confirm at implementation time, because these are version-specific and this document is written
without access to that source:* the current spelling of the step ceiling — the option was a plain
maximum-steps number in one major version and a composable stopping condition in the next — and
whether the default permits more than one step without configuration. That default matters for this
journey's fifth-metric transcript and must be read, not remembered.

The comparison is fair because both sides delegate the loop to a runtime and both sides express the
ceiling as configuration. The measurable difference is how many places the developer has to touch to
make the declaration take effect — which, on our side, is currently more than zero more than it
should be.

## How the four metrics are counted here

The general counting rule is in `../dx-benchmark.md` § The four metrics. What follows is that rule
landed on this journey.

**Files touched.** Counted: the second tool's file, the agent declaration that registers it and
declares the ceiling, and anything else the ceiling required touching. Not counted: J1's first tool,
reused unchanged — and if it had to change to be chainable, that change is counted and the reason is
recorded.

**Glue lines.** The second tool's body is business logic. The schema field that carries the
dependency is glue, on both sides. The ceiling declaration is glue. Any code the developer writes to
feed a tool result back to the model is glue — and if a side needs none because its runtime does it,
that is the finding, recorded as a zero rather than as an absence.

**Concepts required.** Derived mechanically from the imports and APIs the diff uses. The ceiling's
name counts as a concept on both sides. On ours, so does whichever loop surface the developer ends
up on — the repository currently ships two, and § Current state explains why that matters for the
count.

**Time to first green run.** Wall clock from `npx create-theokit` to the first run where all five
assertions pass. Cold cache, at least three runs, mean and standard deviation. Runs where the model
declines to chain are retried and the retries are reported: a flaky journey is a finding about the
journey, and hiding retries would turn it into a finding about the framework.

## The deliberately broken state

Per `../dx-benchmark.md` § The fifth, which is pass/fail and not a number. The break for J5 is a
**step ceiling of one on a prompt that needs two** — the exact configuration that makes a chain
impossible.

| | |
| --- | --- |
| Names the action | `run stopped at the step limit (1) with a tool call still pending; "lookupOrder" returned but its result was never sent back to the model. Raise the step ceiling to at least 2.` — names the limit, names what was left undone, names the fix |
| Does not name the action | A finish reason the caller has to decode, an answer that confidently invents the second tool's result, or a run that ends with no signal that anything was cut short |

The invented-answer case deserves its own line, because it is the realistic one: a model cut off
mid-chain will often produce a fluent, wrong answer. That outcome is graded **fail** on this metric —
not because the model hallucinated, which is not the framework's fault, but because the framework
had the information that the run was truncated and did not surface it.

A second break is graded in the same transcript: **the second tool's schema does not accept the
first tool's output shape.** Names the action: `tool "createShipment" rejected input: expected "orderId" to be a string, received object — "lookupOrder" returns { order: { id } }.`
Does not: a schema-library error dump with a path array and no mention of either tool.

## Current state and blockers

Measured against the working tree on 2026-08-20; every claim is read from source.

**Nothing blocks J5 from running. Criterion 5 fails today, and the failure is a measured defect
rather than a missing feature.**

What is wired:

- The served agent's per-turn loop is delegated to the underlying SDK — a single declared runtime,
  by rule (`packages/agents/src/bridge/sdk-adapter.ts:4`), reached through
  `createSdkAgentStream` (`:357`) and the SDK's own agent and run objects (`:512`, `:537`, `:546`).
  Chaining therefore works without the developer writing a loop, which is what criteria 1 to 3 will
  measure.

**The defect, stated precisely: an application's declared step ceiling never reaches the served
run.** The compiled agent carries `maxIterations`
(`packages/agents/src/bridge/agent-compiler.ts:287`), and capabilities populate it
(`packages/agents/src/capability/agent-capabilities.ts:210`). But the adapter builds its send
options from scratch (`packages/agents/src/bridge/sdk-adapter.ts:525`) and only ever sets a tool
choice and an event callback (`:526`, `:530`) — the ceiling is never read. The effective limit for
`POST /api/agents/<name>` is therefore the SDK's own default, silently, whatever the application
declared. Criterion 5 exists to grade exactly this, and it will fail on the first run.

**A second, independent loop exists in the repository and is not on the served path.** There is a
reflective loop with an explicit strategy, a step-limit finish reason, and a validated ceiling
(`packages/agents/src/loop/loop-strategy.ts:102`, finish reason at `:23`, continue rule at `:129`),
driven by `packages/agents/src/loop/run-reflective-loop.ts:460`. Its barrel states outright that it
is internal and never imported by consumers (`packages/agents/src/loop/index.ts:5`), and it is
reachable only through delegation (`packages/agents/src/bridge/agent-orchestrator.ts:244`), which
has no caller in `packages/theo/src`.

That matters for the benchmark in a way worth stating before the run: **the framework has two
answers to "how do I cap the steps", one of which is unreachable from the journey and the other of
which is currently ignored.** The concepts count will reflect whichever one the developer lands on,
so the report must record which surface was used and why.

**Not measured:** what the SDK's default ceiling actually is, and whether it applies per send or per
agent. That lives outside the two source packages and was not read; the criteria are written so the
number does not need to be known in advance — criterion 5 grades that the *declared* value is the
one observed, whatever the default happens to be.

## Cross-references

- The benchmark this journey belongs to: `../dx-benchmark.md`
- The journey whose tool this chain reuses: `j01-tool.md`
- The journey that gates one of these calls on a human: `j02-hitl.md`
- Acceptance contract that grades these criteria: `../../../.claude/rules/cycle-acceptance.md`
- Criterion shape these follow: `../../../ROADMAP.md` § Wave 1
