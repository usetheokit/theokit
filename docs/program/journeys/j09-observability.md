# J9 — Observability

The ninth of the ten benchmark journeys (`../dx-benchmark.md`). Criteria written before either
implementation exists; a journey whose criteria change after code exists is void and must be re-run
from scratch.

**Scheduling status:** ready, and newly so. `../dx-benchmark.md` § Sequencing records J9 as
unblocked on 2026-08-20 and adds a caution this page repeats deliberately: *being possible to score
and being comfortable are different claims*.

## What the journey requires

Copied from `../dx-benchmark.md` § The ten journeys, unchanged. Rewording it requires an ADR,
because a movable target measures nothing.

| # | Journey | What must work |
| --- | --- | --- |
| J9 | **Observability** | An operator answers "what did this run do, how long, and what did it cost" from recorded telemetry |

Three questions and one constraint. The constraint is **from recorded telemetry** — not from a log
the developer added for this test, not from the response body, not by re-running with a debugger.
The criteria below therefore read everything back from an exporter, which is the only place an
operator would actually look.

## Acceptance criteria

In the shape `ROADMAP.md` uses: observable, with an oracle, graded by `/acceptance` against the
released artifact rather than the working tree (`.claude/rules/cycle-acceptance.md` § Target kinds).

**Definition of done (all must hold):**

- [ ] a completed run is represented by a span with a start and an end, recovered from the
      **exporter's output** rather than from process memory, and its duration is within a stated
      tolerance of the wall clock the client measured for the same run
- [ ] every tool call in that run has its own span, with the tool's name as an attribute — counted
      against the transcript, so a run with two calls yields two spans and a missing one is a
      failure rather than a rounding difference
- [ ] a HITL pause is a span whose duration reflects the time the human took, not the time the run
      took: with a scripted decision after a known delay, the pause span's duration is within
      tolerance of that delay and materially shorter than the run span
- [ ] token usage is present on the exported run span — input, output and total as numeric
      attributes — read back from the exporter, so a value that exists in memory but never reaches
      the wire fails
- [ ] cost is answerable: either a cost attribute is exported, or the exported token counts plus a
      recorded model identifier are sufficient to compute it — the criterion is that an operator can
      answer the question, and either route counts, but a run exporting neither fails
- [ ] a request carrying a W3C `traceparent` produces spans continuing that trace id rather than a
      freshly minted one, compared as strings against the id the client sent
- [ ] the exported signal comes from a production path: the same assertions hold against a published
      build started by the shipped CLI, with no test harness registering the exporter
- [ ] Applies to: Web, Tauri, TUI — each listed target is exercised in acceptance, not merely
      declared
- [ ] Tauri: the same spans are emitted over the in-process path and the trace continues across the
      IPC boundary rather than starting a new trace on the other side
- [ ] TUI: the same spans over the in-process path

**What resisted an oracle.** "An operator could debug an incident with this" is the real question and
has no instrument short of an incident. The criteria replace it with the four factual questions the
journey names — what, how long, how much — and a reader should not take a pass here as evidence that
the telemetry is *good*, only that it is *present and correct*.

Criterion 1's and 3's "within a stated tolerance" is deliberately not a number here: the number
belongs in the evidence directory alongside the run that set it, because a tolerance chosen before
seeing any timing distribution would be invented rather than measured. What this page fixes is that
a tolerance must be **declared before the grading run and recorded**, not chosen after seeing the
result.

## The Next.js side

**A strong equivalent exists on both halves, and this is one of the journeys where the Next.js side
starts ahead.** Next.js has first-class OpenTelemetry support through a reserved instrumentation
file and a vendor helper package, which gives HTTP-level spans without application code. The AI SDK
has an opt-in telemetry flag on its generate and stream calls that emits spans for model calls and
tool calls, carrying token counts as attributes.

The reference implementation: the instrumentation file registering the exporter, plus the telemetry
flag on the `streamText` call, plus whatever the developer must add to answer the cost question.
Where an official example exists it must be used and cited
(`../dx-benchmark.md` § Why the protocol comes before the measurement).

*To confirm at implementation time, because these are version-specific and this document is written
without access to that source:* the current name and shape of the SDK's telemetry option — it has
carried an experimental prefix, and whether it still does matters for the concepts count — which
span attributes it emits for token usage, whether it emits a cost attribute at all, and whether the
HITL pause of criterion 3 has any representation in that instrumentation.

**One asymmetry must be stated before any number exists.** Criterion 3 grades a HITL pause span. If
the AI SDK emits nothing for a human pause — plausible, since the pause is a recipe rather than a
primitive on that side (see `j02-hitl.md`) — then the Next.js reference implementation must add it
by hand, and those lines count. That is a fair outcome and not a trick: the journey asks what an
operator can answer, and a system where the human wait is invisible answers less.

## How the four metrics are counted here

The general counting rule is in `../dx-benchmark.md` § The four metrics. What follows is that rule
landed on this journey.

**Files touched.** Counted: the file that registers or configures the exporter, any configuration
key that enables telemetry, any per-call flag, and every file the developer edits to make a missing
signal appear. Not counted: the agent and tool from J1, reused unchanged.

**Glue lines.** Business logic here is the empty set — J9 changes no behaviour, only what is
recorded. Every line is glue, so the margin is reported as an **absolute count**, per the rule J8
states. One decision recorded so it is applied identically: a span the framework emits without the
developer asking counts as **zero** lines for that side, and the report says which signals were free
on which side. That is the whole point of the journey and must not be hidden inside a total.

**Concepts required.** Derived mechanically from the imports and APIs the diff uses. Expected on
ours: the config key, the adapter contract, the environment variables the resolution chain consults,
and the shutdown behaviour. Expected on the Next.js side: the instrumentation filename convention,
the vendor helper, the telemetry option, and the exporter's own configuration. A reserved filename
counts as a concept, exactly as a reserved folder does in J1.

**Time to first green run.** Wall clock from `npx create-theokit` to the first run where all seven
assertions pass against an exporter. Cold cache, at least three runs, mean and standard deviation.
The exporter is a local collector on both sides, and the same collector is used for both, so neither
side is measured against a vendor's hosted latency.

## The deliberately broken state

Per `../dx-benchmark.md` § The fifth, which is pass/fail and not a number. The break for J9 is
**telemetry configured but never exported** — an endpoint that is wrong, unreachable, or missing its
credential. It is the realistic one, and it is the one where silence is most expensive: the developer
believes they have observability until the day they need it.

| | |
| --- | --- |
| Names the action | `observability: 412 spans buffered, 0 exported. The configured endpoint https://otlp.example/v1/traces returned 401. Check the exporter credential, or set observability.enabled=false to stop buffering.` — names the count, the endpoint, the reason, and two exits |
| Does not name the action | Silence — the application runs perfectly and no trace ever arrives — or a single startup line saying "observability enabled" that is true and useless |

A second break is graded in the same transcript, and it is a defect measured in the tree rather than
an invention: **a signal whose producer and consumer disagree on shape**, so an attribute is silently
never set. The message that names the action reads like
`observability: token usage was reported by the run but not recorded on the span; expected inputTokens at the top level, found it under usage.`
The message that does not exist today at all — the attribute is simply absent, and an operator
reading the trace concludes the run used no tokens. Graded **fail**, per the rule J8 states about
silent wrong outcomes.

## Current state and blockers

Measured against the working tree on 2026-08-20; every claim is read from source. This section is
the most changed of the ten, and two of the repository's own standing claims are **out of date in our
favour** — recorded rather than quietly relied on.

**J9 is unblocked, and more of it is wired than the roadmap currently says.**

- **The config key exists.** `../../../ROADMAP.md` § Wave 0.5 states that the `observability` key
  *"does not exist in the config schema at all"*. It does now:
  `packages/theo/src/config/schemas/observability.ts:15`, composed into the top-level config at
  `packages/theo/src/config/schema.ts:198`, exported at
  `packages/theo/src/config/schemas/index.ts:24`. The module's own header records why it was
  missing and which issue closed it (`packages/theo/src/config/schemas/observability.ts:6`).
- **The observability plugin is loadable.** The same roadmap section states that
  `createObservabilityPlugin` returns a shape the plugin loader rejects. It no longer does: the
  loader requires a name and a `register` function
  (`packages/theo/src/server/plugins/load-plugins.ts:17`, `:20`), and the plugin now returns exactly
  that (`packages/theo/src/server/observability/middleware.ts:84`, `:86`), with its own header
  recording the previous shape and the failure it caused (`:13`, `:16`).
- **Boot is wired on both servers.** Production start calls it
  (`packages/theo/src/cli/commands/start/index.ts:94`) and so does the dev config resolve
  (`packages/theo/src/vite-plugin/config-resolve.ts:77`), stashing the adapter for later retrieval
  (`packages/theo/src/server/observability-bootstrap.ts:50`).
- **The four run signals exist and are reached from production.** `observeAgentRun` opens a run span
  (`packages/theo/src/server/agent/observe-agent-run.ts:121`), a span per tool call (`:77`), and a
  HITL pause span (`:86`) — wrapped in from the plain agent mount
  (`packages/theo/src/server/agent/mount-agent.ts:164`) and from the thread streamer
  (`packages/theo/src/server/agent/build-agent-streamer.ts:85`).
- **The exporter drains on an interval and on shutdown.** A five-second unref'd timer
  (`packages/theo/src/server/observability/adapters/theo-cloud.ts:57`, whose comment records that
  nothing drained before it) and an awaited shutdown on SIGTERM and SIGINT
  (`packages/theo/src/cli/commands/start/graceful-shutdown.ts:62`, registered at `:83` and `:86`).
  The buffer is bounded with counted drops
  (`packages/theo/src/server/observability/adapters/theo-cloud.ts:47`, drop counter at `:39`).

**Three measured defects, each of which a criterion above will catch.** Recording them here is not
pre-empting the run — it is stating what the run is expected to find, so that finding it is
confirmation rather than discovery.

- **Criterion 4 will fail: token attributes are never set.** The recorder reads the token fields at
  the top level of the run metadata (`packages/theo/src/server/agent/observe-agent-run.ts:48`,
  read at `:58`), and the producer nests them under a `usage` object
  (`packages/agents/src/bridge/present-ui-message-stream.ts:41`, type at
  `packages/agents/src/bridge/agent-stream-events.ts:141`). Producer and consumer disagree, so
  nothing is written and nothing complains. This is the second break in § The deliberately broken
  state, and it is real.
- **Criterion 5 will fail on the cost half.** The metadata carries a cost field
  (`packages/agents/src/bridge/present-ui-message-stream.ts:41`) that the span recorder never reads,
  and the entire cost module — the one that would record usage durably — has zero production callers
  (`packages/theo/src/server/cost/track-agent-run.ts:49`, exported at
  `packages/theo/src/server/cost/index.ts:11`) and no configuration key to enable it. So the run
  currently exports neither a cost nor the token counts that would let one be computed, which is
  precisely the pair criterion 5 allows to substitute for each other.
- **Criterion 3 will likely fail: the HITL pause span does not close at the resume.** The pause span
  is keyed on the HITL plugin's own generated id (`packages/agents/src/bridge/hitl-plugin.ts:89`,
  surfaced at `packages/agents/src/bridge/present-ui-message-stream.ts:172`), which is not the
  runtime's tool-call id, so the close path
  (`packages/theo/src/server/agent/observe-agent-run.ts:95`) never matches and the span survives to
  the end-of-run sweep (`:135`). The consequence is that a pause span's duration approximates the
  whole run's — the exact confusion criterion 3 is written to detect. *Confidence: high on the id
  mismatch, which was read at both emission sites; a run was not executed to confirm it end to end.*

**And the caution the sequencing section attaches to this journey is worth repeating in its own
words:** J9 being unblocked means it can be scored, not that it will score well. Three of seven
criteria are expected to fail on the first run. That is the benchmark working.

**Not measured:** whether existing tests already cover the two shape mismatches. The test tree was
not read.

## Cross-references

- The benchmark this journey belongs to: `../dx-benchmark.md`
- The milestone whose criteria overlap these: `../../../ROADMAP.md` § M8
- The journey whose pause criterion 3 measures: `j02-hitl.md`
- The journey whose tool calls criterion 2 counts: `j05-multi-step.md`
- Acceptance contract that grades these criteria: `../../../.claude/rules/cycle-acceptance.md`
- Criterion shape these follow: `../../../ROADMAP.md` § Wave 1
