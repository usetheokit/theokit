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

## Measured - TheoKit side, metrics 1-3 (2026-08-20)

**Three of four metrics, one side, and three of five criteria.** Criteria 1 to 3 - the chain itself -
were implemented and counted. Criteria 4 and 5 - the declared step ceiling - have no implementable
path, so they contribute no number and the reason is stated below rather than averaged away. Metric
4 and the whole Next.js side are unmeasured.

Obtained from a real diff, not an estimate: the scaffold template was copied verbatim and committed
as an untouched baseline, J1's implementation was applied on top as a second uncounted commit - per
§ How the four metrics are counted here, J1's first tool is reused unchanged and does not count here
- and J5 was implemented over that. The counts are `git diff --numstat` over the third commit.

| Metric | TheoKit | How it was counted |
| --- | --- | --- |
| Files touched | **2** | `agents/tools/shipment-eta.ts` added, `agents/chat.ts` edited to register it |
| Glue lines | **8** | of 15 added lines; 5 are business logic and 2 are blank |
| Concepts required | **5**, none of them new | `tool`, the builder's ordering rule, `z.object`, the agent builder's `.tool()`, and the `agents/<name>/tools/` folder convention |
| Time to first green run | **not measured** | needs a live model call; see below |

**Zero lines feed a tool result back to the model, and the counting rule asked for that zero
explicitly.** § How the four metrics are counted here says that a side whose runtime closes the loop
records a zero rather than an absence. Ours does: the per-turn loop is the SDK's
(`packages/agents/src/bridge/sdk-adapter.ts:357`), so the second call's dependency on the first
costs the developer a schema field and nothing else. The concepts count says the same thing from the
other direction - all five are the five J1 already required, so a developer who has done J1 learns
nothing new to chain a second call.

**The 15 added lines, classified.** Published because the glue split is the metric most open to
being argued after the fact, and a table nobody can check is not evidence.

Glue (8): the two imports in the tool file, `tool('shipment_eta')`, `.describe(...)`, `.input(...)`,
`.build()`, the import in `chat.ts`, and `.tool(shipmentEtaTool)`.

Business logic (5): the `ETA_DAYS` table and the `.execute` body - the data the second answer comes
from and the code that produces it.

**Four judgement calls, stated rather than buried.**

1. **J1's diff was applied as the baseline, and it is not counted.** § How the four metrics are
   counted here says J1's tool is reused unchanged, which only has meaning if it is present. It was
   reconstructed from J1's own published classification, and the reconstruction reproduces J1's
   published numbers exactly - 3 files, 15 added lines, 8 glue, 5 business logic - which is the check
   that it is faithful rather than convenient. Measuring J5 from the bare scaffold instead would add
   3 files and 15 lines already counted once, in another journey.
2. **`.input(...)` is glue.** The rule fixed this in advance: the schema field that carries the
   dependency is glue on both sides. Counting the expression of the dependency as business logic -
   arguable, since it is what makes the chain a chain - gives 7 glue and 6 logic.
3. **`const ETA_DAYS: Record<string, number>` is business logic despite its type annotation**, which
   the general rule lists as glue. Counted the same way J1 counted its own lookup table, for the same
   reason: the line's substance is the data, not the annotation. Counting it as glue gives 9 and 4.
   The call matters less than the fact that it is now the second journey to make it identically, and
   the Next.js side owes the same treatment.
4. **Concepts are what the diff uses, not what is new since J1.** Counting only the newly required
   ones gives 0, which is true and useless as a total; the 5 is the cost of reading this diff cold.

**Criteria 4 and 5 cost nothing to write because nothing can be written.** This is not a small
number, and it must not be reported as one. The fluent builder that the scaffold uses
(`packages/create-theokit/templates/default/agents/chat.ts:21`) has no step-ceiling method anywhere
in its surface (`packages/agents/src/bridge/agent-builder.ts:125` opens the interface,
`packages/agents/src/bridge/agent-builder.ts:291` closes it with `build`), so there is no declaration
for an application to make. The ceiling that does exist on the compiled agent
(`packages/agents/src/bridge/agent-compiler.ts:287`) is never read by the adapter that serves the
run, which builds its send options from scratch and sets only a tool choice and an event callback
(`packages/agents/src/bridge/sdk-adapter.ts:525`). So the criteria fail at zero developer cost, and
the honest entry for them is "no path", never "0 lines".

### What is still unmeasured, and why

**Metric 4 (time to first green run) needs a live model call**, at least three times, cold cache.
That spends real credits, and the number is only meaningful measured identically on both sides - so
running one side alone would produce a figure with nothing to compare it to. This journey's own rule
also requires reporting the retries when the model declines to chain, and a retry count cannot exist
without runs.

**Criteria 1 to 3 were implemented, not observed.** The diff registers a second tool whose input is
the first tool's output; whether a model actually chains them, and whether the randomized value
survives into the second call's recorded input, needs a run. § What resisted an oracle already
narrowed these criteria to data flow for exactly this reason, and data flow still has to be watched
flowing.

**Criteria 4 and 5 are graded from source, not from a run.** The reading above is that the declared
ceiling never reaches the served run; the run that would show it stopping at the framework default
instead of the declared number was not performed, and the SDK's default is itself unread.

**The Next.js side does not exist yet.** Until it does, nothing here is a comparison, and the
winning rule cannot be applied. § The Next.js side predicts this is where the other stack writes the
least code, so a 2-file, 8-glue-line count settles nothing on its own.

**The three-target criteria cannot be exercised in this repository.** The Tauri and TUI lines need
`@theokit/tui` and `@theokit/ui`, which live outside it (`.claude/rules/three-target-parity.md`
records the same limit). What settles them is the north-star app
(`.claude/rules/northstar-app.md`), which does not exist yet.

**So: J5 is not won, not tied, and not run.** Three of its five criteria have a measured cost on one
side; the other two have no path at all, which is a finding about the framework rather than a number
about the benchmark.

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
