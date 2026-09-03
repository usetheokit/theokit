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

## Measured - TheoKit side, metrics 1-3 (2026-08-20)

> **Superseded, and read no sentence below as current.** Its central claim — that criteria 3 and 6
> are *"not reachable from an application at all"* — is **half true and half out of date**, and the
> half that is out of date is the half a reader is most likely to quote. Criterion 6 does not fail
> any more: `SpanData` gained `traceId` / `spanId` / `parentSpanId`, the OTLP serializer reads those
> ids instead of minting one per span, and `extractW3CTraceContext` carries the caller's parent, so
> the trace continues on the plain POST, the thread route and the gated path — **observed against a
> collector twice, on 2026-08-20 and again on 2026-08-21**. The accurate sentence is: *criterion 3
> is not reachable from an application, and criterion 6 never needed an application line — the
> framework closed it, at the same two lines of configuration.* Criterion 5 also flipped. The
> current grades live in § Re-measured a second time and § Criteria 3 and 6 re-exercised against the
> tree. This section stays as the record of what was true when it was written.

**Three of four metrics, one side, and the journey does not pass.** What follows is the smallest
number in this batch attached to the largest gap: two lines of configuration buy every signal the
framework emits, and two of the seven criteria are not reachable from an application at all. Metric 4
and the whole Next.js side are unmeasured.

Obtained from a real diff, not an estimate: the scaffold template was copied verbatim, committed as
an untouched baseline, and the journey implemented on top. The counts are `git diff --numstat` over
that commit.

**Read the number with the failure attached to it.** The diff below satisfies criteria 1, 2, 4 and 7
as far as source can, leaves criterion 5 conditional on the model provider, and does not satisfy
criteria 3 and 6 - neither of which an application can fix, because both live behind seams it cannot
reach. A cost of 1 file for a journey that fails two criteria is a different fact from a cost of 1
file for a journey that passes, and reporting the first as the second would be the failure this
programme exists to stop.

| Metric | TheoKit | How it was counted |
| --- | --- | --- |
| Files touched | **1, and criteria 3 and 6 still fail** | `.env.local` - the two variables that select the OTLP exporter. Nothing else: the run span, the per-tool spans, the pause span and the token attributes are emitted by the framework without being asked |
| Glue lines | **2** of 2 added | this journey declares business logic the empty set; the diff did not contradict it |
| Concepts required | **3** | `THEO_CLOUD_INGEST_URL`, `THEO_CLOUD_API_KEY`, and `.env.local` as a file the production CLI loads (`packages/theo/src/config/load-env.ts:42`, loaded at `packages/theo/src/cli/commands/start/index.ts:55`) |
| Time to first green run | **not measured, and there is no green run to time** | see below |

**The 2 added lines, classified.** Both glue, and the classification is not interesting; what is
interesting is what they do not need to be accompanied by. Setting an ingest URL and a key is what
makes the environment half of the documented resolution chain fire (`packages/theo/src/server/observability-bootstrap.ts:73`),
after which the adapter is resolved once and shared by the HTTP hooks and by the agent-run
translator - which is why nothing else has to be written.

**This diff is invisible to git in a real application.** `.env.local` is ignored by the scaffold's
own gitignore (`packages/create-theokit/templates/default/_gitignore:12`); the baseline copy tracks
it only because that file is not renamed into place until `create-theokit` runs. So the file was
counted by hand rather than by the diff, and a reader checking the numbers should expect `git diff`
on a scaffolded app to show nothing at all.

**Five judgement calls, stated rather than buried.**

1. **The environment route was measured, not a configuration-file route, and the alternative is not
   equivalent.** `observability: {}` in `theo.config.ts` is the obvious move and it produces no
   telemetry in a published build: the chain's console branch is gated on `NODE_ENV=development`
   (`packages/theo/src/server/observability/adapter-registry.ts:40`), the fallback is a noop
   (`:45`), and the bootstrap then returns no plugin at all, silently
   (`packages/theo/src/server/observability-bootstrap.ts:83`). A configuration key that validates
   and does nothing is the exact failure shape `j07-rate-limit.md` § The deliberately broken state
   describes for a budget, and it is worth naming here as its own finding.
2. **Writing an adapter instead was measured rather than estimated.** The other honest route is
   `observability.provider` with an adapter the application writes - which is also the only way to
   read spans back without running a collector. Measured on the same baseline: 2 files and 45 added
   lines, against 1 file and 2. It buys a readable file and it does not buy either failing criterion.
3. **`.env.local` was counted as one file touched**, although a real application already has one for
   the model key. Counting it as an edit rather than an addition gives the same 1.
4. **Comments were left out of the two lines.** A commented version is 3 lines; nothing else moves.
5. **The concepts list written in advance did not survive the measurement.** § How the four metrics
   are counted here named the config key, the adapter contract, the resolution-chain environment
   variables and the shutdown behaviour - four. Measured: only the environment variables appear, the
   config key is *the wrong door* for a production build per judgement call 1, and the adapter
   contract and the shutdown behaviour never surface because the framework owns both. Applying the
   list as written scores 4; applying the rule's own first sentence - derive it from the diff -
   scores 3.

### What is still unmeasured, and why

**Criterion 6 has no implementable path from an application, so its cost is not a large number - it
is not a number.** Two independent reasons, both read from source. First, the exported span's trace
id is minted per span (`packages/theo/src/server/observability/otlp-serializer.ts:65`), so each span
an operator receives belongs to its own trace no matter what arrived on the wire - and the incoming
`traceparent` *is* honoured for the request id
(`packages/theo/src/cli/commands/start/request-handler.ts:233`), which makes the loss happen at the
exporter rather than at the door. Second, an application that
writes its own adapter cannot recover it either: the HTTP span carries the resolved id as an
attribute (`packages/theo/src/server/observability/middleware.ts:94`), and the run and tool spans
carry only `{ agent }` (`packages/theo/src/server/agent/mount-agent.ts:224`) or
`{ agent, sessionId }` (`packages/theo/src/server/agent/build-agent-streamer.ts:85`), while
`startSpan` takes a name and attributes and nothing else
(`packages/theo/src/server/observability/adapters/types.ts:29`). So the request can continue a
trace and the run inside it cannot, which is the half of criterion 6 that matters.

**Criterion 3 fails and an application cannot make it pass.** The pause span is opened on the HITL
plugin's approval id and closed on the tool-call id, which is a different id, so it never closes at
the resume; the end-of-run sweep now marks it `hitl.resume_observed: false` and gives it an error
status rather than reporting a duration it did not measure
(`packages/theo/src/server/agent/observe-agent-run.ts:169`). That is the honest behaviour and it is
still a fail: the criterion asks for the time the human took, and no span carries it
(usetheokit/theokit#361).

**Criterion 5 passes only when the provider reports a cost.** `cost.usd` is set from the finish
metadata's `cost` field (`packages/theo/src/server/agent/observe-agent-run.ts:74`), which the
producer includes only when the SDK reported one
(`packages/agents/src/bridge/agent-stream-events.ts:144`). The criterion's alternative route - token counts plus a recorded model identifier - is not available:
the run span's attributes are the agent name and the session id
(`packages/theo/src/server/agent/observe-agent-run.ts:139`), and no span records which model ran. So
the criterion hangs on a field this repository does not control, and the substitution it deliberately
allowed is closed.

**Metric 4 has no green run to time.** Even setting aside that it needs a live model call on both
sides, the run it would time does not exist on this one.

**Criteria 1, 2, 4 and 7 are read from source, not observed.** No collector was run, no span was
received, no duration compared against a client's wall clock. The token attributes in particular are
read as *correct in shape* since the producer's shape was adopted
(`packages/theo/src/server/agent/observe-agent-run.ts:76`); that they arrive at a collector was not
seen.

**The Next.js side does not exist yet.** Until it does, nothing here is a comparison, and the winning
rule cannot be applied. § The Next.js side already predicted this is a journey where the other stack
starts ahead, and a one-file count on our side does not settle a race whose other lane is empty.

**The three-target criteria cannot be exercised in this repository.** The Tauri and TUI lines need
`@theokit/tui` and `@theokit/ui`, which live outside it (`.claude/rules/three-target-parity.md`
records the same limit). What settles them is the north-star app
(`.claude/rules/northstar-app.md`), which does not exist yet.

**So: J9 is not won, not tied, and not run.** It is the journey where the framework gives away the
most for free, and the two things it does not give away are the two an application cannot build
itself.

## Re-measured — both sides, metrics 1-3, against a running exporter (2026-08-20)

**The section above is left standing as the record of what was true when it was written.** It was
written against a framework where the OTLP serializer drew a `traceId` per span, and it is out of
date by three commits landed the same day: `2ec9180ee` (a run is one trace), `3762c7d0f` (the
declared step ceiling reaches the served agent) and `5f90ddd95` (a truncated run says so). All three
were confirmed present in the tree under test rather than assumed. **The criteria did not move**
(`../dx-benchmark.md` § Why the protocol comes before the measurement); the target is the same and
the framework is not.

**What is new here beyond the re-run.** The earlier measurement graded criteria 1, 2, 4 and 7 "from
source, not observed", and said so. This one does not have to: both sides were driven end to end
against a **real local HTTP collector**, and every criterion below is graded against the bytes that
arrived there. Where a claim is still a source read it is labelled as one, and there are exactly two.

**Neither side ran against a real model, and no criterion grades one.** No API key was available. On
the TheoKit side the agent's wire-chunk stream was scripted; on the Next.js side the language model
was a scripted `MockLanguageModelV4` from the SDK's own `ai/test` entry point. Everything from the
span translator outward is production code on both sides. Metric 4 is unmeasured, on both sides,
deliberately.

### Versions and commits under test

| | |
| --- | --- |
| TheoKit | working tree at `5f90ddd95`; `2ec9180ee` and `3762c7d0f` confirmed as ancestors |
| Next.js side | `next@16.3.1`, `ai@7.0.70`, `@ai-sdk/react@4.0.73`, `@ai-sdk/otel@1.0.70`, `@vercel/otel@2.1.3`, `zod@4.4.3`, Node 22.22.2 |
| Collector | a `node:http` server accepting OTLP/JSON on `POST /v1/traces`, the same shape for both sides |

### The version-specific facts, confirmed against the source

§ The Next.js side above deferred four questions to implementation time. All four were read from the
installed packages' own declarations and from the docs page that publishes the recipe. **Two of them
came back against what the section supposed, and both change the count.**

| Deferred question | Answer | Read from | Diverged? |
| --- | --- | --- | --- |
| The current name and shape of the SDK's telemetry option, and whether it still carries an experimental prefix | **`telemetry`**. `experimental_telemetry` survives as a deprecated alias on the same type. Shape: `{ isEnabled, recordInputs, recordOutputs, functionId, includeRuntimeContext, includeToolsContext, integrations }` | the `streamText` and `generateText` option declarations in the installed `ai@7.0.70`, and the telemetry docs page | **Yes.** The prefix is gone, which the section flagged as mattering for the concepts count. It matters less than the next row |
| Which span attributes it emits for token usage | `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`, plus `cache_read` / `cache_creation`. **There is no `gen_ai.usage.total_tokens`** | the emitted attribute-key set of the installed `@ai-sdk/otel@1.0.70` | **Yes**, on the third of criterion 4's three numbers — see the grading below |
| Whether it emits a cost attribute at all | **No.** `cost` appears nowhere in the integration's emitted keys | the same key set | No — the section supposed as much |
| Whether the HITL pause of criterion 3 has any representation | **No, and it structurally cannot** — see § Criterion 3 below | the SDK's tool-approval documentation | No, and the reason is stronger than "not implemented" |

**A fifth fact nobody thought to defer, and it is the one that costs the most.** In `ai` v7 the SDK
**no longer emits OpenTelemetry spans at all**. Span emission moved to a separate package,
`@ai-sdk/otel`, whose `OpenTelemetry` integration must be handed to `registerTelemetry()` explicitly.
Registering `@vercel/otel` alone produces HTTP spans and **zero** AI spans. This was verified rather
than read: the first probe run, before `registerTelemetry(new OpenTelemetry())` was added, returned
no `invoke_agent`, `step` or `execute_tool` span at all.

**The official example for this journey exists and does not work.** `vercel/ai`'s
`examples/next-openai-telemetry` uses the current `telemetry` spelling in its route, but its
`instrumentation.ts` calls only `registerOTel` and pins `@vercel/otel@1.10.0` / `next@^15`. As
published it emits no AI spans under the versions above. `../dx-benchmark.md` § Why the protocol
comes before the measurement requires an official example be used where one exists; the working
official source is the AI SDK telemetry docs page's Next.js section, and that is what was copied
verbatim.

### The baselines, declared

**TheoKit.** The `create-theokit` default template, copied verbatim with `_gitignore`,
`package.json.tmpl` and `README.md.tmpl` renamed exactly as the scaffolder renames them, and
committed untouched. J9 is the delta from there. The scaffold ships a working agent and four tools,
none of which J9 edits — this journey adds no behaviour, only recording.

**Next.js.** The same three-commit ladder J1 and J5 declared, reused rather than rebuilt:
`create-next-app` plus `npm install ai @ai-sdk/react zod`, then the quickstart's pre-tools chat
stage, then J1's tool and J5's second tool. All three commits are **uncounted**, exactly as the
TheoKit side leaves its scaffold uncounted. J9 is the delta from the J5 commit. Both sides are
formatted with the `create-theokit` Prettier config (`printWidth: 100`, `semi: false`,
`packages/create-theokit/templates/default/.prettierrc`), so both are counted with one ruler; Prettier
left the pasted `instrumentation.ts` unchanged.

### Metrics 1-3

| Metric | TheoKit | Next.js + AI SDK | Better | Ratio | Verdict under § What counts as winning |
| --- | --- | --- | --- | --- | --- |
| Files touched | **1** | 3 | TheoKit | **3x** | outside the 2x bar |
| Glue lines | **2** | 14 | TheoKit | **7x** | outside the 2x bar |
| Concepts required | **3** | 7 | TheoKit | **2.33x** | outside the 2x bar |
| Time to first green run | not measured | not measured | - | - | not applicable |

This journey declares business logic the empty set, so every added line is glue and the margin is
reported as an absolute count as well as a ratio: **twelve lines and two files separate the two
sides.**

### The two diffs, published

**TheoKit — one new file, two lines.**

```diff
diff --git a/.env.local b/.env.local
new file mode 100644
--- /dev/null
+++ b/.env.local
@@ -0,0 +1,2 @@
+THEO_CLOUD_INGEST_URL=http://127.0.0.1:4318/v1/traces
+THEO_CLOUD_API_KEY=local-collector
```

Nothing else. The run span, the per-tool spans, the pause span, the token attributes and the stop
reason are all emitted by the framework without being asked: setting an ingest URL and a key is what
makes the environment half of the resolution chain fire
(`packages/theo/src/server/observability-bootstrap.ts:74`), after which the adapter is resolved once
and shared by the HTTP hooks and by the agent-run translator.

**This diff is invisible to `git` in a real application.** `.env.local` is ignored by the scaffold's
own gitignore (`packages/create-theokit/templates/default/_gitignore:12`); the baseline copy tracks
it only because that file is not renamed into place until `create-theokit` runs. It was counted by
hand, and a reader checking the numbers should expect `git diff` on a scaffolded app to show nothing.

**Next.js — two new files, one edited.**

```diff
diff --git a/instrumentation.ts b/instrumentation.ts
new file mode 100644
--- /dev/null
+++ b/instrumentation.ts
@@ -0,0 +1,10 @@
+import { registerOTel } from '@vercel/otel'
+import { registerTelemetry } from 'ai'
+import { OpenTelemetry } from '@ai-sdk/otel'
+
+export function register() {
+  registerOTel({
+    serviceName: 'my-ai-app',
+  })
+  registerTelemetry(new OpenTelemetry())
+}

diff --git a/.env.local b/.env.local
new file mode 100644
--- /dev/null
+++ b/.env.local
@@ -0,0 +1,2 @@
+OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318
+OTEL_EXPORTER_OTLP_PROTOCOL=http/json

diff --git a/package.json b/package.json
@@ -9,7 +9,9 @@
   "dependencies": {
+    "@ai-sdk/otel": "^1.0.70",
     "@ai-sdk/react": "^4.0.73",
+    "@vercel/otel": "^2.1.3",
     "ai": "^7.0.70",
```

**`app/api/chat/route.ts` is not in that diff, and that is a measured result rather than an
omission.** The telemetry option is documented as "enabled by default when a telemetry integration
is registered", and the probe confirmed it: spans for the run, every step, every model call and every
tool call arrived with no per-call flag anywhere. Adding `telemetry: { functionId: 'chat' }` buys
grouping, not signal, and it is counted in the judgements below rather than in the total.

**`package-lock.json` moved by 240 lines and is excluded**, on both sides and by the same rule: a
lockfile is generated, not authored. Counting it would make the metric a function of a package
manager's transitive closure — `@vercel/otel` declares seven required peer dependencies and no
dependencies of its own, so npm installs seventeen packages for two names.

### The concepts, derived from the diffs

**TheoKit (3):** `THEO_CLOUD_INGEST_URL`, `THEO_CLOUD_API_KEY`, and `.env.local` as a file the
production CLI loads (`packages/theo/src/config/load-env.ts:42`, loaded from
`packages/theo/src/cli/commands/start/index.ts:95`).

**Next.js (7):** the three structural parallels — `OTEL_EXPORTER_OTLP_ENDPOINT`,
`OTEL_EXPORTER_OTLP_PROTOCOL`, and `.env.local` as a file the framework loads — plus four the other
side has no counterpart for: the reserved `instrumentation.ts` filename and its `register()` export,
`registerOTel` from the vendor helper, `registerTelemetry` from `ai`, and the `OpenTelemetry`
integration class from `@ai-sdk/otel`. A reserved filename counts as a concept, exactly as a
reserved folder does in J1.

The fourth of those is the expensive one. It is not an import a reader can skip: without it the app
boots, the exporter runs, HTTP spans arrive, and **not one AI span is emitted**. That is the
concepts metric measuring exactly what it is for — a name you must already know, whose absence
produces a working application and no telemetry.

### The evidence, read back off the collector

Both payloads below are what the collector received, not what the process held.

**TheoKit — a two-tool run carrying an incoming `traceparent`:**

```
agent.tool  trace=aaaaaaaa…aaaa  id=329a53e63a1aac71  parent=a4527cfc34fc3638  dur=1.00
      agent=chat  tool=order_lookup  toolCallId=call-1
agent.tool  trace=aaaaaaaa…aaaa  id=16af2f9a4daf9569  parent=a4527cfc34fc3638  dur=2.00
      agent=chat  tool=shipment_eta  toolCallId=call-2
agent.run   trace=aaaaaaaa…aaaa  id=a4527cfc34fc3638  parent=None             dur=8.00
      agent=chat  tokens.input=1200  tokens.output=340  tokens.total=1540  stop.reason=step_limit
```

One trace, three spans, both tools parented on the run. Client wall clock for the same run: **8 ms**,
against a run span of **8 ms**.

The same thing through the real served entry point rather than the translator alone — `mountAgent`
called with a `Request` carrying `traceparent: 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01`:

```
{"sent":"4bf92f3577b34da6a3ce929d0e0e4736","spans":[
  {"name":"agent.tool","traceId":"4bf92f3577b34da6a3ce929d0e0e4736","spanId":"535ca6dce91c6465","parentSpanId":"7ffc784d9bdc4a41"},
  {"name":"agent.run","traceId":"4bf92f3577b34da6a3ce929d0e0e4736","spanId":"7ffc784d9bdc4a41"}]}
```

Byte-equal, compared as strings. The same request carrying an `x-request-id` instead of a
`traceparent` produced a freshly minted 32-hex trace, which is the correct refusal — a correlation
key exported as a `traceId` is a malformed span (`packages/theo/src/server/http/trace-context.ts:139`).

**Next.js — the same two-tool chain, through `next build` + `next start` on a published build, with
the same `traceparent` header:**

```
GET /                                trace=3e650aa29ac4a8  parent=None              dur=  64.80
resolve page components              trace=3e650aa29ac4a8  parent=badaf460d5f0f578  dur=   1.06
POST /api/chat                       trace=11112222333344  parent=9999aaaabbbbcccc  dur= 568.68
resolve page components              trace=11112222333344  parent=5e276551f96777dd  dur=   0.79
executing api route (app) /api/chat  trace=11112222333344  parent=5e276551f96777dd  dur=  26.36
invoke_agent mock-model-id           trace=11112222333344  parent=bae5a80ca17d66e0  dur= 309.53  model=mock-model-id in=450 out=75
start response                       trace=11112222333344  parent=bae5a80ca17d66e0  dur=   0.73
step 1                               trace=11112222333344  parent=69f70086610b0138  dur=  97.21
chat mock-model-id                   trace=11112222333344  parent=e9545fd0a145663b  dur=  81.01  model=mock-model-id in=100 out=20
execute_tool orderLookup             trace=11112222333344  parent=e9545fd0a145663b  dur=   3.35  tool=orderLookup
step 2                               trace=11112222333344  parent=69f70086610b0138  dur=  74.96
chat mock-model-id                   trace=11112222333344  parent=45a616b5440845e9  dur=  11.75  model=mock-model-id in=150 out=25
execute_tool shipmentEta             trace=11112222333344  parent=45a616b5440845e9  dur=   0.88  tool=shipmentEta
step 3                               trace=11112222333344  parent=69f70086610b0138  dur=   9.08
chat mock-model-id                   trace=11112222333344  parent=93c6d1fdf61aa0df  dur=   5.85  model=mock-model-id in=200 out=30
```

The sent trace id was `11112222333344445555666677778888` and the sent parent span id was
`9999aaaabbbbcccc`. The HTTP span carries both. Every one of the thirteen spans below it sits in that
trace. Two warm repeats gave run spans of 19.47 ms and 22.29 ms against client wall clocks of 34 ms
and 43 ms, with the HTTP span at 24.90 ms and 31.07 ms.

### The seven criteria, graded against those payloads

| # | Criterion | TheoKit | Next.js + AI SDK |
| --- | --- | --- | --- |
| 1 | run span, start and end, duration within tolerance of client wall clock | **pass**, observed | **pass**, observed |
| 2 | a span per tool call, tool name as an attribute | **pass** for an ungated tool; **fails for a HITL-gated one** | **pass**, observed |
| 3 | HITL pause span whose duration is the human's wait | **fail**, observed | **fail**, and structurally |
| 4 | token usage on the exported run span: input, output and total | **pass**, all three | **fails on the third**, substitutable at zero cost |
| 5 | cost answerable — a cost attribute, or tokens plus a model identifier | **fail**, both routes closed | **pass** |
| 6 | a `traceparent` produces spans continuing that trace id | **partial** — the run does, the HTTP span never does, the thread route never does | **pass**, observed on a production build |
| 7 | the signal comes from a production path, no test harness registering the exporter | **not verified** | **pass**, observed |

**Criterion 1's tolerance was not declared before the grading run, and that is a protocol miss.**
§ Acceptance criteria requires the number to be fixed before the run and recorded. It was not. Stated
rather than papered over: the tolerance that would have been declared is ±25% of the client wall
clock, and both sides clear it by margins large enough that the omission cannot have decided the
grade — TheoKit's delta is 0 ms of 8, and the Next.js HTTP span is within 27% and 28% of a wall clock
that includes `curl` process start and the full SSE body read.

**Criterion 2 fails on TheoKit for a gated tool, and the failure is an overcount rather than a
missing span.** With a `@HumanInTheLoop` tool, the approval synthesises a `tool-input-available`
chunk under the *approval* id (`packages/agents/src/bridge/present-ui-message-stream.ts:182`) and the
real execution later emits its own under the *runtime's* tool-call id, so one logical call produced
**two** `agent.tool` spans in the exported payload. The criterion's own sentence is "a run with two
calls yields two spans"; a run with one call yielding two is the same oracle failing in the other
direction. This is usetheokit/theokit#361, confirmed open before citing.

**Criterion 3 fails on both sides, and it fails differently.** On ours the pause span exists and is
honest about being useless: measured against a scripted 120 ms human delay, the pause span's duration
came back as **120.999936 ms and the run span's as 120.999936 ms** — identical to the nanosecond,
because the span never closes at the resume and survives to the end-of-run sweep, which marks it
`hitl.resume_observed: false` and gives it an error status
(`packages/theo/src/server/agent/observe-agent-run.ts:233`). The criterion asks for a duration
"materially shorter than the run span"; it is exactly equal.

On the Next.js side there is nothing to be honest about, and the reason is worth more than the
absence. The SDK **does not pause**: a tool requiring approval causes `generateText` / `streamText`
to complete and return `tool-approval-request` parts, and the human decision happens between two
independent calls. Those two calls produce **two unrelated root traces**. So where our side has one
trace containing a mislabelled pause, that side has no pause and no single trace either, and closing
the criterion means hand-written span stitching across an HTTP boundary.

**§ The Next.js side pre-committed that those hand-written lines would be counted, and they are not
counted here.** The reason is symmetry, not convenience: neither baseline has an approval flow at
all, J2 is held under an open security advisory on our side, and building one on the Next.js side
alone would compare an implemented feature against an absent one. Recorded as an open gap against
this file's own instruction rather than resolved by editing the instruction.

**Criterion 4 passes outright on ours and loses one number on theirs.** Our run span carries
`tokens.input`, `tokens.output` and `tokens.total`. The `@ai-sdk/otel` `OpenTelemetry` integration —
the one the docs recommend — emits `gen_ai.usage.input_tokens` and `gen_ai.usage.output_tokens` and
no total. The substitution is free and must be named: the same package's `LegacyOpenTelemetry`
integration does emit `ai.usage.totalTokens` and `ai.model.id`, and swapping it is one identifier in
the same line. So the criterion is reachable on that side at zero extra lines, by a route the docs
label legacy.

**Criterion 5 is the one that decides the journey, and it goes against us.** The complete attribute
set of our exported `agent.run` span is `agent`, `tokens.*`, `stop.reason`, and `cost.usd` when the
provider reported one — printed in full above. **No span records the model identifier**, so the
criterion's token route does not close (`B-019`, open on exactly this point). The cost route does not
close either, and for a second reason found during this measurement: `cost.usd` is a fractional
number and the serializer emits every number under OTLP's `intValue`
(`packages/theo/src/server/observability/otlp-serializer.ts:57`), so the one attribute that answers
the cost question is malformed on the wire — filed as usetheokit/theokit#380 with the collector
payload as evidence. Both of the criterion's alternatives are shut.

The Next.js run span carries `gen_ai.request.model` alongside the token counts, in the same payload,
with no application code. The operator has model and tokens and can compute cost. The criterion says
"either route counts", and that side has one.

**Criterion 6 is a pass on ours in one place and a fail in two others.** `mountAgent` continues the
incoming trace and the read-back above proves it end to end. Two other paths do not, and both were
found here:

- the `http.request` span passes no trace context at all
  (`packages/theo/src/server/observability/middleware.ts:89`), so it mints a fresh trace on every
  route. One request that runs an agent therefore reaches the collector as **two disconnected
  traces** — the caller's trace id is present on the HTTP span as the `requestId` *attribute* and not
  as its `traceId`. Reproduced against the serialized payload and filed as usetheokit/theokit#385.
- the thread route calls `observeAgentRun` without a `traceId`
  (`packages/theo/src/server/agent/build-agent-streamer.ts:85`) although
  `handleThreadMessage` holds the `Request` (`packages/theo/src/server/agent/handle-thread-routes.ts:86`),
  so a run's trace depends on which endpoint started it. Filed as usetheokit/theokit#381. **This half
  is a source read, not an observation** — the field is simply not passed and there is no other path
  by which it could arrive, but no thread run was executed.

The Next.js side passes this criterion completely, including the half ours does not reach: its HTTP
span carries the sent trace id **and** names the sent span id as its parent, so the run hangs under
the caller's span rather than beside it. Our `AgentRunSpanContext` has no parent field
(`packages/theo/src/server/agent/observe-agent-run.ts:201`), so even where the trace id is continued
the waterfall's shape is lost.

**Criterion 7 is observed on one side and unverified on the other, and the asymmetry favours them.**
The Next.js grade comes from `next build` followed by `next start`, an exporter registered only by
the reserved `instrumentation.ts`, and a `curl` from outside the process — no test runner anywhere.
The TheoKit probes call `mountAgent` and the middleware plugin directly under vitest with the adapter
injected. The wiring from `theo start` to that adapter is read from source
(`packages/theo/src/cli/commands/start/index.ts:95`) and not exercised. Recorded as unverified rather
than inferred from the two ends being correct.

### Counting judgements, stated rather than buried

Seven, each with the effect of deciding it the other way. **None of them changes which side wins a
metric**, which is stated because it is the check that matters: a margin a single decision can flip
is not a margin.

| # | The judgement | Decided as | The other way |
| --- | --- | --- | --- |
| 1 | Does `package.json` count as a file touched, when TheoKit installs nothing? | **Counted.** The install is work the developer does, and that the framework ships its exporter in the box is the design difference this journey measures | Files 3 to **2**, glue 14 to **12**. Ratios 2x and 6x — both still outside the bar |
| 2 | Does `package-lock.json` count? | **No**, on both sides. Generated, not authored | Next.js glue 14 to **254**, which would make the metric a report on npm's transitive closure |
| 3 | Is the second `.env.local` line (`OTEL_EXPORTER_OTLP_PROTOCOL`) chargeable, or an artefact of using one JSON collector for both sides? | **Charged.** § How the four metrics are counted here requires the same collector on both sides, and `@vercel/otel` defaults to protobuf | Glue 14 to **13**. Ratio 6.5x |
| 4 | Should the route have been edited to add `telemetry: { functionId: 'chat' }`, as the docs' usage example shows? | **No** — measured, not assumed: spans arrive without it. This is the judgement most favourable to the Next.js side in the whole count | Files 3 to **4**, glue 14 to **17**. Moves further from TheoKit, not toward it |
| 5 | Is `.env.local` one file touched on the TheoKit side, when a real app already has one for the model key? | **One.** Counting it as an edit rather than an addition gives the same 1 | No effect |
| 6 | Are the four Next.js-only names really four concepts, or is "the instrumentation setup" one? | **Four.** Each is a separately importable symbol or a reserved name, and the `OpenTelemetry` one in particular has a silent failure mode all its own | Concepts 7 to **4**. Ratio 2.33x to **1.33x** — *this is the only judgement that would move a metric inside the bar*, and it is the least defensible of the seven: collapsing four imports into one concept is not a rule J1 or J5 applied to anything |
| 7 | Is TheoKit's HITL double-span a criterion-2 failure, when the transcript it is read from also contains two calls? | **A failure.** The criterion's oracle is the transcript, but its sentence is about the run: "a run with two calls yields two spans" | Criterion 2 would read **pass** on both sides, and the criteria tally would move from 5-3 to 6-3 in the Next.js side's favour rather than away from it |

Judgement 6 is the honest weak point of the concepts number and is flagged as such. Files and glue
lines do not depend on it.

### The verdict

**TheoKit wins all three countable metrics, by 3x, 7x and 2.33x — every one outside the bar
§ What counts as winning sets. And the journey is not won.**

Both halves of that sentence are load-bearing, and the second is the one this programme exists to
protect. § What counts as winning defines a win by the three metrics; it presupposes that both
implementations satisfy the journey's criteria, because a benchmark comparing the cost of arriving is
meaningless between one side that arrived and one that did not. TheoKit satisfies **three** of the
seven criteria outright, against the Next.js side's **five**. It fails criterion 5 entirely, fails
two thirds of criterion 6, fails criterion 2 for gated tools, and criterion 7 is unverified on our
side and observed on theirs.

So the number to report is not 3x. It is this: **two lines of configuration buy a trace that is
missing the model, missing its HTTP span, and missing the thread route — and fourteen lines on the
other side buy one that has all three.** § How the four metrics are counted here anticipated exactly
this shape when it wrote that a span the framework emits for free counts as zero lines and "that is
the whole point of the journey and must not be hidden inside a total". It is not hidden here: the
free signals are real, they are cheaper by a wide margin, and three of them are wrong.

**What would change the verdict, and what would not.** Every one of the four defects behind the
criteria failures is a **framework** defect — #361, #380, #381, #385, plus B-019's model attribute.
Closing all five costs the application **zero lines**: the model id is an attribute the run span
already has the metadata to set, the HTTP span needs a third argument at one call site, the thread
route needs a value passed at one call site, and the serializer needs an `Number.isInteger` check. So
the plausible end state is a framework that satisfies every criterion **at the same two lines** — and
that is a prediction, recorded as one, not a result. It is also the strongest argument the framework
has on this journey, and it is worth exactly nothing until the issues close.

**One thing this must not be read as.** § Sequencing warned that J9 being newly scoreable does not
mean it will score well, and half of that warning held: the framework's costs are the lowest of any
journey measured so far, and it satisfies fewer criteria than the alternative. A cheap implementation
of an incomplete thing is not a win, and reporting the 3x without the 3-of-7 would be the precise
failure the protocol was written to stop.

### Where the comparison is not apples to apples

Named rather than adjusted for, because adjusting a count until it evens out is what the protocol
forbids.

- **The two sides do not buy the same telemetry.** The same two-tool run produced **3** spans on
  ours and **15** on theirs. Theirs includes the HTTP request, the route execution, a span per agent
  step, a span per model call and a span per tool execution, all in one trace with the caller's.
  Ours has the run and its two tools. Seven times the lines bought roughly five times the spans and
  two criteria we do not reach; the glue-line ratio alone would hide that entirely.
- **The free signals are free on both sides.** After registration, neither side writes a line per
  span. What differs is the registration, which is what metrics 1-3 measure here and all they
  measure.
- **The evidence is not of equal strength.** Criteria 6 and 7 were observed against a real production
  server on the Next.js side and against the framework's own entry points under a test runner on
  ours. That is a real difference in what has been proven, and it is not in our favour.
- **Neither side ran against a real model**, so nothing here depends on a model having answered — and
  metric 4 is unmeasured on both, which the winning rule's "not worse on time to green" clause leaves
  untested.
- **The three-target criteria cannot be exercised in this repository.** The Tauri and TUI lines need
  `@theokit/tui` and `@theokit/ui`, which live outside it. The comparison above is TheoKit's Web path
  only, and a route handler serves one target — a dimension the Next.js side does not have at all and
  which this measurement silently gives away.
- **Neither application is committed.** `../dx-benchmark.md` § Evidence asks for both under
  `docs/program/evidence/jN-<journey>/`; that directory still does not exist and this measurement did
  not create it. The diffs and the collector payloads are published here instead, which satisfies the
  checkability the clause exists for and does not satisfy the clause.

### Four issues filed from this measurement

Each carries a repro and the collector payload it was found in; none was filed on a source read
alone.

- usetheokit/theokit#380 — a fractional attribute is exported under OTLP `intValue`, so `cost.usd` is
  malformed on the wire. New.
- usetheokit/theokit#381 — the thread route drops the incoming `traceparent`. New.
- usetheokit/theokit#385 — the `http.request` span joins no trace, so one request that runs an agent
  arrives as two disconnected traces. New.
- usetheokit/theokit#361 — a HITL-gated tool appears twice under two ids. Pre-existing, confirmed
  open, and confirmed to break criteria 2 and 3 at the exporter rather than only on the wire.

## Re-measured a second time — TheoKit against a published build, on a real collector (2026-08-20)

**The section above is left standing as the record of what was true when it was written**, and it is
out of date by four commits landed the same evening. Each of them touched something that section
recorded as failing, and **none of their authors graduated their own fix** — all four said, in those
words, that what grades a telemetry change is a re-measurement against a real collector. This is that
re-measurement. **The criteria did not move** (`../dx-benchmark.md` § Why the protocol comes before
the measurement); the target is the same and the framework is not.

**The Next.js side was not re-run.** Nothing changed on it, and re-measuring an unchanged lane would
manufacture noise. Its counts, its version facts and its criteria grades are reused verbatim from
§ Re-measured — both sides above, and every before/after table below marks them as carried over.

### What changed under the measurement

| Commit | What it claimed | Graded here |
| --- | --- | --- |
| `0e9e6dc04` | a gated tool is one call under one id, so the pause span closes at the resume instead of surviving to the end-of-run sweep (#361) | criterion 2 **now passes** for a gated tool; criterion 3's *close* is fixed and its *duration* is not |
| `d15f8888e` | a fractional attribute goes out as OTLP `doubleValue` instead of `intValue` (#380) | **not observed here** — see § What this run did not exercise |
| `2893c8997` | the `http.request` span continues the incoming trace and names the caller's span as parent (#385); both served routes go through one `observeServedRun` (#381); the run span carries `gen_ai.request.model` | criteria **5 and 6 now pass**, both observed |
| `91fce4761` | an agent endpoint refuses a caller no declared policy admits. **Breaking:** an agent without `export const policy` fails the scanner | **costs this journey nothing** — see below |

**The breaking change costs zero lines, and that was measured rather than assumed.** The scaffold
template now ships the declaration itself
(`packages/create-theokit/templates/default/src/server/agents/chat.ts:42`), so the untouched baseline
already satisfies the new gate: the app was built and served from the verbatim template and the agent
endpoint answered `200`. J9 adds no agent, so it writes no policy. The honest caveat is that a journey
which *adds* an agent would now pay a line for it, and J9 is not that journey.

### The instrument, and why this run reaches further than the last one

The previous measurement graded criterion 7 **not verified** on our side and observed on theirs, and
called that asymmetry "a real difference in what has been proven, and it is not in our favour". It is
closed here. Every TheoKit payload below comes from:

```
theokit build && theokit start        # the shipped CLI, a published build
```

with the exporter selected only by the two counted `.env.local` lines, driven by an out-of-process
HTTP client. No vitest, no injected adapter, no framework entry point called by hand.

**The model is local and keyless**, reusing the instrument `j06-retry.md` § The instrument declared:
`@theokit/sdk@4.52.1` ships an `ollama` provider profile with `authType: "none"` speaking Ollama's own
`POST /api/chat` NDJSON, so a scripted server on `127.0.0.1:11434` is a complete model as far as the
framework is concerned. Runs go through the real `theokit start`, the real scanner, the real
`mountAgent`, the real `streamAgentUIMessages` and the real span translator. The one instrument line
that is *not* free is recorded as a finding rather than hidden: the framework's provider registry has
no keyless entry, so `ollama/*` still demands an unrelated cloud key
(usetheokit/theokit#407), and the run was unblocked by setting `OPENAI_API_KEY` to a placeholder the
run never uses.

**The collector** is the same `node:http` server accepting OTLP/JSON on `POST /v1/traces` the previous
measurement used, so both sides and both runs are read with one instrument.

### Versions and commits under test

| | |
| --- | --- |
| TheoKit | `workspace` @ `91fce4761`; `0e9e6dc04`, `d15f8888e` and `2893c8997` confirmed as ancestors |
| App | the `create-theokit` default template, copied verbatim with `_gitignore`, `package.json.tmpl` and `README.md.tmpl` renamed as the scaffolder renames them, committed untouched, then built and served |
| Model | a local Ollama-protocol server, scripted; `@theokit/sdk@4.52.1` |
| Next.js side | **carried over unchanged** — `next@16.3.1`, `ai@7.0.70`, `@ai-sdk/react@4.0.73`, `@ai-sdk/otel@1.0.70`, `@vercel/otel@2.1.3`, Node 22.22.2 |

### The TheoKit diff, unchanged

```diff
diff --git a/.env.local b/.env.local
new file mode 100644
--- /dev/null
+++ b/.env.local
@@ -0,0 +1,2 @@
+THEO_CLOUD_INGEST_URL=http://127.0.0.1:4318/v1/traces
+THEO_CLOUD_API_KEY=local-collector
```

`git show --numstat` on the commit: `2  0  .env.local`. **Both lines classified as glue**, as this
journey's own rule requires — it declares business logic the empty set, and the diff did not
contradict it. Line 1 and line 2 together are what makes the environment half of the resolution chain
fire (`packages/theo/src/server/observability/adapter-registry.ts:33`, read by
`packages/theo/src/server/observability-bootstrap.ts:74`), after which the adapter is
resolved once and shared by the HTTP hooks and by the agent-run translator. Neither line is
independently useful: one without the other produces no adapter.

Nothing else. The run span, the per-tool spans, the pause span, the token attributes, the stop reason
and the model id are emitted by the framework without being asked. **This diff is still invisible to
`git` in a real application** — `.env.local` is ignored by the scaffold's own gitignore, so it was
committed with `-f` and a reader checking the numbers should expect `git diff` on a scaffolded app to
show nothing.

### Metrics 1-3, before and after

| Metric | TheoKit, first re-run | TheoKit, this run | Next.js *(carried over)* | Better | Ratio | Verdict under § What counts as winning |
| --- | --- | --- | --- | --- | --- | --- |
| Files touched | 1 | **1** | 3 | TheoKit | **3x** | outside the 2x bar |
| Glue lines | 2 | **2** | 14 | TheoKit | **7x** | outside the 2x bar |
| Concepts required | 3 | **3** | 7 | TheoKit | **2.33x** | outside the 2x bar |
| Time to first green run | not measured | not measured | not measured | - | - | untested on both sides |

**No metric moved.** Twelve lines and two files still separate the two sides. What moved is
underneath: the same two lines now buy a trace that answers the cost question, joins the caller's
trace on every served route, and counts a gated tool once.

The concepts are the same three the previous run derived and they were re-derived rather than copied:
`THEO_CLOUD_INGEST_URL`, `THEO_CLOUD_API_KEY`, and `.env.local` as a file the production CLI loads
(`packages/theo/src/config/load-env.ts:42`, called from
`packages/theo/src/cli/commands/start/index.ts:56`).

### The evidence, read back off the collector

Every payload below is what the collector received from a `theokit start` process, not what any
process held.

**A two-tool run carrying `traceparent: 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01`:**

```
agent.tool   trace=4bf92f3577b34da6a3ce929d0e0e4736 id=06cc25f79cbf2bcb parent=a78871e5a3af02b5 dur=75.000ms
             agent=<path> tool=current_time toolCallId=call-c003f41f-8e85-40ac-9578-84ab297356d2
agent.tool   trace=4bf92f3577b34da6a3ce929d0e0e4736 id=c59c253ccdf20975 parent=a78871e5a3af02b5 dur=25.000ms
             agent=<path> tool=current_time toolCallId=call-13796f3c-ce15-4a07-b279-97c73a05de77
agent.run    trace=4bf92f3577b34da6a3ce929d0e0e4736 id=a78871e5a3af02b5 parent=00f067aa0ba902b7 dur=163.000ms
             agent=<path> cost.usd=int:0 tokens.input=int:3600 tokens.output=int:1020 tokens.total=int:4620
             tokens.reasoning=int:0 tokens.cache_read=int:0 tokens.cache_write=int:0
             gen_ai.request.model=ollama/j9-local
http.request trace=4bf92f3577b34da6a3ce929d0e0e4736 id=1e629085f5edeb68 parent=00f067aa0ba902b7 dur=167.000ms
             method=POST path=/api/agents/chat requestId=4bf92f3577b34da6a3ce929d0e0e4736 status=int:200
```

Four spans, **one trace**, byte-equal to the id sent. `<path>` is quoted literally rather than
elided in usetheokit/theokit#406 — it is the agent module's absolute filesystem path, which is a
finding of its own and is not the agent's name.

**A HITL-gated run**, scripted human decision of 1200 ms, model answering in 20 ms:

```
agent.hitl   trace=4bf92f35… id=3015e8ab6df33d2d parent=79b9c07e38287743 dur=1241.000ms status=1
             tool=send_notification approvalId=347a50cb-… toolCallId=347a50cb-… hitl.resume_observed=bool:true
agent.tool   trace=4bf92f35… id=87c055260dcbd49d parent=79b9c07e38287743 dur=1242.000ms status=1
             tool=send_notification toolCallId=347a50cb-…
agent.run    trace=4bf92f35… id=79b9c07e38287743 parent=00f067aa0ba902b7 dur=1321.000ms status=1
```

One gated call, **one** `agent.tool` span, and a pause span that closed at the resume with
`hitl.resume_observed=true` and an `ok` status.

**The thread route**, carrying `traceparent: 00-cccc…cccc-dddddddddddddddd-01` and answered `202`
before the run started:

```
agent.tool   trace=cccccccccccccccccccccccccccccccc id=eb0dc187c9a40b91 parent=dbd700d9426bea6f dur=72.000ms
agent.tool   trace=cccccccccccccccccccccccccccccccc id=8988b188d3ce43be parent=dbd700d9426bea6f dur=24.000ms
agent.run    trace=cccccccccccccccccccccccccccccccc id=dbd700d9426bea6f parent=dddddddddddddddd dur=147.000ms
             agent=agent "chat" sessionId=… gen_ai.request.model=ollama/j9-local
```

The trace survives a `202` and reaches a run that starts after the request is gone. **And no
`http.request` span arrived for it at all** — usetheokit/theokit#405.

**The same request with no `traceparent` at all** — the browser case:

```
agent.tool   trace=929a6ed14ed0636214eacc881996ae0d id=8ed0ffbb56dd3b20 parent=1cff54f4be6edbd6 dur=80.000ms
agent.tool   trace=929a6ed14ed0636214eacc881996ae0d id=70acb0862aeb846c parent=1cff54f4be6edbd6 dur=29.000ms
agent.run    trace=929a6ed14ed0636214eacc881996ae0d id=1cff54f4be6edbd6 parent=(root)            dur=156.000ms
http.request trace=d5d549523b395d8049614ea7116a2aa6 id=eef1898d1bda1f64 parent=(root)            dur=159.000ms
             requestId=96721fb5-6f33-436a-85d3-a8cf591afb0b status=int:200
```

**Two disconnected traces.** This is usetheokit/theokit#404, reproduced on a production build rather
than read from source, and § The limit the criteria do not see below says why it is recorded here
even though it changes no grade.

### Criterion 1's tolerance, declared before the grading run

**±25% of the client's wall clock for the same run**, which is the number
§ Re-measured — both sides wrote down before this run existed. Recording it here as inherited rather
than newly chosen is the point: the previous section admitted the omission and fixed the value in
writing, so this run is graded against a tolerance that predates it.

Four runs from **one warm client process**, so the client's own start-up is not inside the wall clock:

| run | client wall clock | `agent.run` span | delta | `http.request` span |
| --- | --- | --- | --- | --- |
| 1 (warm-up, excluded) | 188 ms | 143 ms | −23.9% | 146 ms |
| 2 | 145 ms | 137 ms | **−5.5%** | 138 ms |
| 3 | 141 ms | 137 ms | **−2.8%** | 139 ms |
| 4 | 142 ms | 134 ms | **−5.6%** | 139 ms |

The warm-up is reported rather than dropped silently, and it is the row that shows what the
instrument costs: three quarters of its 45 ms gap is the client process reaching its first socket.

### The seven criteria, graded against those payloads

| # | Criterion | TheoKit, first re-run | TheoKit, this run | Next.js *(carried over)* |
| --- | --- | --- | --- | --- |
| 1 | run span, start and end, duration within tolerance of client wall clock | pass, observed | **pass**, observed on a published build | pass, observed |
| 2 | a span per tool call, tool name as an attribute | pass ungated, **fail** for a HITL-gated one | **pass**, both | pass, observed |
| 3 | HITL pause span whose duration is the human's wait | **fail** | **fail**, for a new and narrower reason | fail, and structurally |
| 4 | token usage on the exported run span: input, output and total | pass | **pass**, all three | fails on the third |
| 5 | cost answerable — a cost attribute, or tokens plus a model identifier | **fail**, both routes closed | **pass** | pass |
| 6 | a `traceparent` produces spans continuing that trace id | **partial** — one path of three | **pass**, all three paths | pass |
| 7 | the signal comes from a production path, no test harness | **not verified** | **pass**, observed | pass, observed |
| | **Total** | **3 of 7** | **6 of 7** | **5 of 7** |

**Criterion 2 passes on both sides now, and the change is the one #361 bought.** A `@HumanInTheLoop`
tool crossed as two `tool-input-available` chunks under two ids; it now crosses as one. On the wire:
`tool-input-available(347a50cb-…)`, `tool-approval-request(347a50cb-…)`,
`tool-output-available(347a50cb-…)` — one id throughout. At the collector, one `agent.tool` span for
the one call, with `tool=send_notification`. The ungated case was re-checked in the same session and
is unchanged: a transcript with two `tool-input-available` chunks produced exactly two spans.

**Criterion 3 still fails, and the reason moved from "the span never closes" to "the span measures
the wrong interval".** The pause span now closes at the resume and says so
(`packages/theo/src/server/agent/observe-agent-run.ts:250`), which is a real improvement over
a span that survived to the end-of-run sweep and reported the whole run. What it does not do is
measure the human. `closeToolSpan` keys on `tool-output-available`, and that chunk is not flushed when
the tool returns — it is flushed when the *next model turn* produces output. Varying only the model's
post-resume latency, with the same instantaneous gated tool:

| model latency after resume | scripted human wait | exported `agent.hitl` | excess | run span |
| --- | --- | --- | --- | --- |
| 20 ms | 1200 ms | **1241 ms** | +41 ms | 1321 ms |
| 700 ms | 250 ms | **969 ms** | +719 ms | 3084 ms |
| 1500 ms | 251 ms | **1761 ms** | +1510 ms | 6276 ms |

The excess tracks the model's latency 1:1 across a 75x change in the ratio. The criterion asks for a
duration "within tolerance of that delay **and** materially shorter than the run span", and the two
halves cannot both hold with this implementation: row 1 is within tolerance of the human wait and is
94% of the run; rows 2 and 3 are comfortably shorter than the run and are 3.9x and 7x the human wait.
Posted to usetheokit/theokit#389, which had attributed the excess to the tool's own execution — the
tool here is a string echo and the error was still 1510 ms, so the diagnosis in that issue is
sharpened rather than confirmed.

**Criterion 4 passes, and this run adds nothing to the last one's grade** beyond that the three
numbers were now read off a published build: `tokens.input=3600`, `tokens.output=1020`,
`tokens.total=4620`, plus reasoning and cache counters nobody asked for.

**Criterion 5 flips, and it is the criterion the previous run said "decides the journey".** That run
found no span recording the model, so the criterion's token route was closed and the cost route hung
on a provider. `gen_ai.request.model` is now on the exported run span, in the OpenTelemetry GenAI
registry's own spelling (`packages/theo/src/server/agent/observe-agent-run.ts:143`), beside
the three token counts, in the same payload, for zero application lines. An operator has the model and
the tokens and can price the run. The criterion says "either route counts"; ours now has one.

**Criterion 6 passes on all three paths, having passed on one.** The plain POST continues the trace
*and* names the caller's span as parent, which is the half the previous run said was lost even where
the id was carried. The `http.request` span joins the same trace rather than minting its own (#385).
The thread route continues it too (#381), across a `202` and a run that outlives the request. All
three were compared as strings against what the client sent.

**Criterion 7 is the asymmetry closed.** Every payload above came from `theokit build` +
`theokit start`, an exporter selected by nothing but the two counted lines, and an HTTP client outside
the process. The previous run's honest "not verified" is spent.

### The limit the criteria do not see

**A request with no `traceparent` still arrives as two disconnected traces**, and the payload is
above. Both sides mint independently: the plugin's `inboundContext` calls `newTraceId()` when no
usable header arrived (`packages/theo/src/server/observability/middleware.ts:95`), and
`observeAgentRun` calls `newTraceId()` for the same reason
(`packages/theo/src/server/agent/observe-agent-run.ts:274`). Neither knows about the other.

**A browser does not send `traceparent`.** So the criterion grades the minority path and passes, while
the path almost every request of almost every application takes fails. That is recorded here because
a criterion satisfied by a minority path is information the next reader needs, and because the grade
above would otherwise read as stronger than the thing it measures. It changes no grade:
usetheokit/theokit#404, filed before this run and reproduced during it.

**Two further gaps were found by running the production build and are invisible to all seven
criteria.** The agent *aux* routes — the thread message and stream, the approve route, the approvals
listing, MCP, the agent card — never reach the plugin runner in production
(`packages/theo/src/cli/commands/start/handlers.ts:217`, against the agent branch's
`runOnRequest` at `:405`), so none of them emits an `http.request` span, a request counter or an error
counter. Two of those spend tokens and one settles a human decision (usetheokit/theokit#405). And the
`agent` attribute — the dimension an operator groups by — is the module's **absolute filesystem path**
on the plain route (`packages/theo/src/cli/commands/start/handlers.ts:423`, reaching the span
at `packages/theo/src/server/agent/mount-agent.ts:246`) and the string `agent "chat"` on the
thread route (`packages/theo/src/server/agent/serve-aux-routes.ts:263`, reaching the span at
`packages/theo/src/server/agent/build-agent-streamer.ts:91`). One agent, two series, and the
server's directory layout exported to a telemetry backend on every span
(usetheokit/theokit#406). Neither would have been found from source alone, and neither was found by
the previous run, which passed `source: 'chat'` from its own probe and so never saw what production
passes.

### Counting judgements, re-decided rather than carried over

The previous run's seven were re-taken against this run's diff rather than copied; six land where they
landed, and judgement 6 is re-argued from scratch because that section flagged it as the weakest and
it is the one that decides a metric. Three more are new, and the first of them is the one the breaking
change forced.

| # | The judgement | Decided as | The other way |
| --- | --- | --- | --- |
| 1 | Does `package.json` count as a file touched, when TheoKit installs nothing? | **Counted.** That the framework ships its exporter in the box is the design difference this journey measures, and an install is work | Next.js files 3 → **2**, glue 14 → **12**. Ratios 2x and 6x — both still outside the bar |
| 2 | Does `package-lock.json` count? | **No**, both sides. Generated, not authored | Next.js glue 14 → **254**, making the metric a report on npm's transitive closure |
| 3 | Is `OTEL_EXPORTER_OTLP_PROTOCOL` chargeable, or an artefact of using one JSON collector for both sides? | **Charged.** § How the four metrics are counted here requires the same collector on both sides, and `@vercel/otel` defaults to protobuf | Next.js glue 14 → **13**. Ratio 6.5x |
| 4 | Should the Next.js route have been edited to add `telemetry: { functionId: 'chat' }`? | **No** — measured, not assumed: spans arrive without it | Next.js files 3 → **4**, glue 14 → **17**. Moves away from TheoKit |
| 5 | Is `.env.local` one file touched on our side, when a real app already has one for the model key? | **One.** Counting it as an edit rather than an addition gives the same 1 | No effect |
| 6 | Are the four Next.js-only names four concepts, or is "the instrumentation setup" one? | **Four**, and re-argued below | Concepts 7 → **4**, ratio 2.33x → **1.33x** — *still the only judgement that moves a metric inside the bar* |
| 7 | *(new for this run)* Does the policy gate of `91fce4761` cost this journey a line? | **No**, measured: the scaffold ships `export const policy = 'public'` and the untouched baseline builds, starts and answers `200` | If the declaration had to be written, TheoKit files 1 → **2** and glue 2 → **3**. Ratios 1.5x and 4.67x — *files would fall inside the bar and the journey would not be won* |
| 8 | *(new)* Is the model change from `openai/gpt-4o-mini` to the local model a counted edit, and the placeholder `OPENAI_API_KEY` a counted line? | **Neither.** Both lanes script their model; `j06-retry.md` set the precedent that the model is instrument on both sides and counted on neither. J9 changes what is *recorded*, not what runs | Counting instrument would have to be symmetric, and it is more expensive on the other side: theirs imports `MockLanguageModelV4` and `simulateReadableStream` and scripts the turns *inside the measured route file*, where ours is one string in an agent file plus one environment line. Charging both moves the ratios **further** from parity, not toward it |
| 9 | *(new)* Are the two `.env.local` lines two glue lines or one configuration act? | **Two**, counted as the diff counts them, and symmetric with the two `OTEL_EXPORTER_OTLP_*` lines charged on the other side by judgement 3 | One on each side. Glue 1 against 13 — ratio 7x → **13x**, further outside the bar |

**Judgement 6, re-argued rather than inherited.** The four names are the reserved `instrumentation.ts`
filename with its `register()` export, `registerOTel` from `@vercel/otel`, `registerTelemetry` from
`ai`, and the `OpenTelemetry` integration class from `@ai-sdk/otel`. Three points decide it, and the
third is new:

1. **The rule as written says to derive concepts mechanically from the imports and APIs the diff
   uses.** Mechanically there are three imported symbols from three packages plus a framework file
   convention. § How the four metrics are counted here anticipated exactly this list — "the
   instrumentation filename convention, the vendor helper, the telemetry option, and the exporter's
   own configuration" — before either implementation existed.
2. **J1 counted a reserved folder as its own concept.** Collapsing a setup block into one concept is a
   rule this programme has applied to nothing.
3. **The symmetric version of the collapse is not symmetric.** If "the instrumentation setup" is one
   concept, then "the exporter env pair" is one on our side too, giving 2 against 3 and a ratio of
   1.5x — also inside the bar. But collapsing four names across three packages is a larger act of
   hiding than collapsing two variables of one framework that share a prefix and one documentation
   page. A convention that blurs 4→1 and 2→1 and calls the result even is a judgement dressed as
   arithmetic.

It stays at four, and it stays flagged. **Files and glue lines do not depend on it.**

### The verdict

**RETRACTED 2026-08-20, later the same day: J9 is not won.** The paragraph below was written with
metric 4 unmeasured on both sides, and § What counts as winning requires the three countable metrics
**and** "not worse on time-to-green". Metric 4 has since been measured, and TheoKit is worse by the
document's own test. The full measurement is in § Metric 4 below; the verdict as originally written is
preserved here because a retraction that edits away what it retracts teaches nobody what went wrong.

**Original verdict, superseded:**

> **TheoKit wins all three countable metrics — 3x, 7x and 2.33x, every one outside the bar
> § What counts as winning sets — and, for the first time on this journey, the criteria do not
> disqualify it: 6 of 7 against the Next.js side's 5 of 7. Under the rules as written, J9 is won.**

The three countable metrics and the criteria still stand exactly as measured — nothing below is
withdrawn except the conclusion, which rested on a metric nobody had run. What it rested on was stated
rather than implied, and that is why the retraction is one measurement rather than an argument:

- **Files (3x) and glue lines (7x) rest on no judgement that could flip them.** Every alternative in
  the table above leaves both outside the bar — the worst case for files is judgement 1 at exactly 2x,
  which is the bar and not inside it.
- **Concepts (2.33x) rests on judgement 6, and that judgement is one reading away from 1.33x, which is
  inside the bar.** Decide it the other way and the concepts metric is a tie, the winning rule's "all
  three" is not met, and **J9 is not won**. Judgement 6 has now been argued twice, by two
  measurements, and both landed on four — but it is a judgement, and if the programme later rules that
  a copied setup block is one concept, this verdict is withdrawn rather than defended.
- **Metric 4 is unmeasured on both sides**, so the winning rule's "not worse on time to green" clause
  is untested rather than satisfied. Every journey measured so far has the same hole; this is the first
  one where it matters, because it is the first win.
- **The criteria half no longer goes against us, and it also is not a rout.** The one criterion
  TheoKit fails, the Next.js side fails too and fails harder — it has no pause at all, and its two
  halves of an approval land in two unrelated root traces. And the one criterion the Next.js side
  fails alone, criterion 4's `total_tokens`, was recorded as substitutable at zero cost via that
  package's `LegacyOpenTelemetry` integration. **If the programme ever accepts that substitution, the
  criteria are level at 6 and 6** — which does not change the verdict, because the verdict rests on the
  three metrics and on the criteria not disqualifying, not on winning them.

**And the number is not the whole result.** Two lines of configuration now buy a trace that answers
what a run did, how long it took, what model ran it and what it cost — joined to the caller's trace on
every served route. The same two lines buy a trace whose `agent` label is a build machine's file path,
whose thread and approval requests are invisible at the HTTP layer, and which splits in two the moment
a browser rather than a service makes the request. Three of those are filed
(#404, #405, #406), all three are framework defects, and closing all three costs the application
**zero lines** — which is the strongest thing that can be said for the 3x and is worth nothing until
they close. The previous run made the same prediction about #361, #380, #381, #385 and B-019; four of
those five have since closed at exactly the predicted cost, which is why the prediction is repeated
rather than retired.

### What this run did not exercise

Named rather than absorbed.

- **`d15f8888e`'s fractional `doubleValue` is not in any payload here.** `cost.usd` was exported on
  every run and its value was integer `0`, because the local provider reports no price — so
  `intValue` is the *correct* encoding for what was measured and the fixed branch was never taken. The
  fix is real in source (`packages/theo/src/server/observability/otlp-serializer.ts:68`) and
  has its own test; it is not graduated by this collector. Criterion 5 passes on the token+model route
  regardless, so the grade does not depend on it.
- **Metric 4 remains unmeasured**, on both sides, deliberately — and it is now the only untested clause
  of the winning rule for this journey.
- **The Next.js side was not re-run.** Its 3 / 14 / 7 and its 5 of 7 are carried over from
  § Re-measured — both sides. Nothing changed on that side; the reuse is stated so a reader knows the
  two halves of every comparison above are of different ages.
- **The three-target criteria still cannot be exercised in this repository.** Tauri and TUI need
  `@theokit/tui` and `@theokit/ui`, which live outside it. The comparison is TheoKit's Web path only,
  and a route handler serves one target — a dimension the Next.js side does not have and which this
  measurement again gives away.
- **Neither application is committed** under `docs/program/evidence/j9-observability/`, which
  `../dx-benchmark.md` § Evidence asks for. The diff, the collector payloads and the instrument are
  published here instead. That satisfies the checkability the clause exists for and not the clause.
- **Neither side ran against a real model.** Ours ran against a local Ollama-protocol server; theirs,
  in the carried-over measurement, against `MockLanguageModelV4`. No criterion grades one.

### Four issues filed and four verified from this re-measurement

Each carries a repro against the published build and the collector payload it was found in. None was
filed on a source read alone, and each was deduplicated against the tracker before filing.

- usetheokit/theokit#405 — the agent aux routes bypass the plugin runner in production, so the thread,
  approve and MCP endpoints emit no `http.request` span. New.
- usetheokit/theokit#406 — the `agent` span attribute is the module's absolute filesystem path on one
  route and a quoted label on another. New.
- usetheokit/theokit#407 — a local model cannot run: the provider registry has no keyless entry, so
  `ollama/*` demands an unrelated cloud key and the error names the wrong action. New.
- usetheokit/theokit#408 — the scaffold's `.env.example` documents `LLM_MODEL`, which nothing reads.
  New.
- usetheokit/theokit#389 — the HITL pause span's duration is not the human's wait. Pre-existing;
  commented with the measurement that shows the excess is the model's next-turn latency rather than
  the tool's execution, which is what that issue supposed.

And three were verified fixed with the payloads above, on the build rather than by reading:
usetheokit/theokit#361, #381 and #385. usetheokit/theokit#404 was reproduced on the production build
and remains open.

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

**Superseded in part by § Re-measured — both sides, and left standing as the record of what was true
when it was written.** Three of its predictions were tested by that section and two of them are now
wrong in the framework's favour: criterion 4's token attributes *are* set (the producer/consumer shape
mismatch was fixed in `b512e60ce`), and criterion 6's trace continuation *does* work on the plain POST
path (`2ec9180ee`). The third prediction held exactly: criterion 3's HITL pause span does not close at
the resume. Three further defects the section did not anticipate were found by reading the exporter's
output rather than the source — usetheokit/theokit#380, #381 and #385.

**And superseded again by § Re-measured a second time**, which is where the current grades live. Its
third prediction has since fallen too: the pause span now closes at the resume (`0e9e6dc04`), and what
remains is the interval it measures rather than whether it closes. Read the predictions below as the
record of what was expected on 2026-08-20 morning, not as the state of the framework.

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

## Metric 4 — measured 2026-08-20, and it retracts the win

Metric 4 was unmeasured on all ten journeys. The winning rule does not treat it as optional: a
journey is won when TheoKit is better on the three countable metrics **and not worse on
time-to-green**, the test for which is *"non-overlapping intervals at ±1σ over ≥ 3 runs"*. J9 was
declared won with half of its own winning condition untested.

### What was timed

A clean copy of each side's committed source — the same two applications this journey was measured
on — with no `node_modules` and no build output, through install → build → start → first successful
HTTP response. Three runs each. Harness at `scratchpad/metric4.sh`, results written line by line so a
partial run survives.

**Warm cache, stated rather than hidden.** The npm cache is not cleared between runs: clearing it
measures this connection's throughput to the registry more than it measures either framework, and it
would be the same tax on both sides. The numbers are comparable to each other, not to a first-ever
install on a new machine.

**The journey delta is not re-applied.** It is 2 lines against 14 and cannot move a number whose unit
is tens of seconds; both sides carry their own already.

### The numbers

| run | Next.js | TheoKit |
| --- | --- | --- |
| 1 | 14.8 s | 36.7 s |
| 2 | 14.1 s | 22.1 s |
| 3 | 15.9 s | 32.4 s |
| **mean ± 1σ** | **14.93 ± 0.91** → [14.03, 15.84] | **30.40 ± 7.50** → [22.90, 37.90] |

**The intervals do not overlap.** By § What counts as winning's own test, TheoKit is **worse** on
time-to-green — 2.04x on the means — so the "not worse" clause fails and **J9 is not won**.

The conclusion survives the most charitable reading available. Discarding run 1 as the least-warm
leaves [19.97, 34.53] against [14.03, 15.84]: still non-overlapping, still worse.

### Where the time goes, and the part that is not what anyone would guess

| phase, mean | Next.js | TheoKit |
| --- | --- | --- |
| install | 4.2 s | **19.6 s** |
| build | 10.2 s | **7.8 s** |
| start | 0.6 s | 2.9 s |

**TheoKit builds faster — 7.8 s against 10.2 s.** The entire loss is install: 4.7x, and it is what
dominates the total. That is a dependency-tree cost, not a compiler cost, and it is invisible to
files, glue lines and concepts — which is precisely why the goal lists four metrics and not three.
A framework can be cheaper to write in every countable way and still make a person wait twice as
long to see the first thing work.

TheoKit's variance is also eight times Next.js's (σ 7.50 against 0.91). A number that unstable is
itself a finding: the first-run experience is not reliably any particular length.

### Three runs were lost to a framework defect before any number existed

The first three TheoKit runs recorded `NEVER_ANSWERED`. The server was up and listening on 3000 while
the probe knocked on the port it had been told to use: **`theokit start` does not read `PORT`** on the
published version — the second half of usetheokit/theokit#402, confirmed earlier the same day, fix
unreleased. `next start` reads it.

So metric 4 is not symmetrically measurable on the published artifact without knowing that in advance,
and the harness now tells each side its port the way that side accepts it. This is the third distinct
activity that defect has obstructed in one day: J10 found a container that starts and serves nobody,
the bind regression exposed the same missing read, and now a measurement. A defect that blocks three
unrelated activities is not peripheral.

### What this does not say

It does not withdraw the three countable metrics or the criteria — those were measured against a real
collector and stand. It says the journey is not won, because winning has four parts and the fourth was
never run. And it applies beyond this journey: **metric 4 is still unmeasured on the other nine**, and
the install cost measured here is a baseline both sides pay on every one of them.

### Annotation, 2026-08-21: the protocol above was asymmetric, and the number is not re-run

J7's re-measurement ran this same harness on its own two applications and found something about the
protocol rather than about either framework: **the two source trees here are not symmetric.**
`j09-next` carries a `package-lock.json`; `j09-theo` does not. A tree with a lockfile installs from
it; a tree without one re-resolves the whole dependency graph against the registry on every run.
Both scaffolders write a lockfile, so the tree without one is the anomaly.

Measured on J7's pair, three runs per cell: removing the lockfile costs TheoKit **8.97 s** of install
and Next.js **5.15 s**. Roughly 3.8 s of the gap this section reports was therefore charged to one
side only.

**The number above is not corrected here, and the win is not restored.** Nothing in J7's run
re-executes J9's applications, and editing a measurement by inference is the move this programme
refuses everywhere else. What is recorded is that the protocol had a handicap in it, that the
handicap is worth about 3.8 s of the 15.4 s install gap, and that J9's metric 4 needs re-running
symmetrically before its verdict means what it says. J7's own metric 4, measured both ways, does not
reproduce this gap on either protocol — see [J7's criteria file](j07-rate-limit.md) § Metric 4.

Two further caveats found the same way, both of which cut against the decomposition rather than
against the totals. First, `node-pty@1.1.0` ships prebuilt binaries for `darwin-*` and `win32-*` and
**none for `linux-x64`**, so `node-gyp rebuild` really does run on this platform — and takes about
two seconds once the node-gyp header cache is warm, not the ten-plus a cold machine would pay.
Second, with lockfiles present the whole script cost re-measures at about **2.1 s**, against the
19.8 s recorded in `../evidence/b025-install-decomposition-2026-08-20.txt`. The decomposition's
shape holds — TheoKit pays for lifecycle scripts and Next.js declares none — and its magnitude is
protocol-dependent in a way that measurement did not previously state. Neither figure was ever taken
on a cold machine, which is where a new developer actually stands.

### Re-measured, 2026-08-21: cold cache, symmetric lockfiles, and the number moves the other way

The annotation above said J9's metric 4 needed re-running symmetrically before its verdict meant
what it says, and refused to correct the number by inference. This is the re-run. It uses **J9's own
two applications**, so nothing here is inferred from another journey.

Two defects were fixed before timing anything. `j09-theo` was given the `package-lock.json` it
lacked (`npm install --package-lock-only` — resolution only, nothing installed, untimed), which
removes the asymmetry the annotation identified. And the run is **cold**, which
[`../dx-benchmark.md`](../dx-benchmark.md) § The four metrics has required since the metric was
defined and which no measurement in this programme had ever done: a private empty npm cache per run,
rather than `npm cache clean --force`, so the machine's own cache survives.

| protocol | TheoKit | Next.js | intervals |
| --- | --- | --- | --- |
| **cold** (the stated definition) | **14.50 ± 0.72** → [13.78, 15.22] | **24.33 ± 1.55** → [22.78, 25.88] | disjoint, TheoKit 1.68x faster |
| warm (what every earlier run did) | **11.23 ± 1.64** → [9.59, 12.88] | **16.33 ± 1.27** → [15.06, 17.60] | disjoint, TheoKit 1.45x faster |

**The fear this run was built to test is refuted.** The worry was that a cold cache would expose a
lifecycle-script penalty paid only on our side — `node-pty` compiles on `linux-x64`, `esbuild`
fetches a binary — and would drop the eight journeys measured warm. Measured: a cold cache costs
TheoKit **+3.27 s** and Next.js **+8.00 s**. It costs them 2.4x what it costs us.

The premise was checked rather than assumed: after a real install the TheoKit lane holds
`node_modules/node-pty/build/Release/pty.node`, with prebuilds for `darwin-x64` and `win32-x64` and
none for `linux-x64`. The native compile is inside every TheoKit number above.

**What this does not do is restore the win.** Metric 4 was the clause that retracted it, and metric 4
now clears in our favour on both protocols — but a journey is won on four metrics and its criteria,
and the three countable metrics have not been re-derived today. Declaring it here, from one metric,
is precisely the move that made this section necessary: J9 was declared won and lost the win hours
later to this exact clause. The published `30.40 ± 7.50 s` is left standing rather than edited, and
[`../evidence/j09-metric4-cold-2026-08-21.txt`](../evidence/j09-metric4-cold-2026-08-21.txt) is what
a reader compares it against — including the six discarded runs and the harness defect that caused
them.

The swing from `30.40` to `11.23` is **not decomposed**. Three things differ between the two runs —
the missing lockfile, the machine's warmth, and whatever produced a σ of 7.50 on a 30 s measurement
— and no run here isolates them.

## Criteria 3 and 6 re-exercised against the tree, 2026-08-21 — and the release limit that makes them ungraded

**This is not an acceptance run, and no criterion below is closed by it.**
[`../../../.claude/rules/cycle-acceptance.md`](../../../.claude/rules/cycle-acceptance.md)
§ Target kinds grades a criterion against the **released** artifact, and nothing here is released.
`develop` and `origin/main` carry the identical tree `46ac4204`, the newest `theokit` tag is
`theokit@0.48.14` (2026-08-19), and each of the four commits that move criteria 5 and 6 —
`2ec9180ee`, `0e9e6dc04`, `2893c8997`, `e39ce9831` — answers `NOT in develop` to
`git merge-base --is-ancestor`. `workspace` is 88 commits ahead. So what follows says
**the capability is present in the tree and ungraded**, and never that a criterion is satisfied.

**Criterion 7 is unmeasurable here for the same reason, and is not graded.** Its wording asks for a
*published* build started by the shipped CLI. The app below is a real build started by the real CLI —
`theokit build && theokit start`, no vitest, no injected adapter, an HTTP client outside the process —
but the `theokit` and `@theokit/agents` it loads are symlinks into the working tree rather than
packages installed from a registry. A built artifact is not a published one, and stretching the word
would be the substitution the acceptance rule exists to refuse.

Everything below is bytes that arrived at a local OTLP collector over HTTP. Nothing is read from
process memory and nothing is read from source. The instrument, the commands and the full span
payloads are in
[`../evidence/j09-criteria-3-and-6-tree-2026-08-21.txt`](../evidence/j09-criteria-3-and-6-tree-2026-08-21.txt),
and the harness itself is committed beside it at
[`../evidence/j09-harness/`](../evidence/j09-harness/) — the scratch app is not, per
[`../../../.claude/rules/northstar-app.md`](../../../.claude/rules/northstar-app.md)'s split between
what travels and what is disposable.

### The tree under test

| | |
| --- | --- |
| TheoKit | `workspace` @ `66964c89e`, clean tree; `theokit` 0.49.0, `@theokit/agents` 10.1.0 |
| Since the last graded run | six commits on `packages/`, one of them observability (`e39ce9831` — #405 and #406) |
| App | the `create-theokit` default template committed verbatim, plus the two J9 `.env.local` lines |
| Model | a scripted Ollama-protocol server on 127.0.0.1:11533 reached through `OLLAMA_HOST`; `@theokit/sdk` 4.53.1 |
| Collector | a `node:http` server accepting OTLP/JSON on `POST 127.0.0.1:4318/v1/traces` |

`@theokit/sdk` is **4.53.1 here and 4.52.1 in § Re-measured a second time**. The drift is recorded
rather than corrected: it is the app's own dependency, it was not pinned, and saying so is cheaper
than a re-run that would change nothing about the two ids compared below.

### Criterion 6 — the trace ids, compared as strings

Three paths, three requests, each carrying a `traceparent` chosen so the comparison is unambiguous.

| path | trace id sent | trace id on every exported span | spans | distinct traces | run span's parent |
| --- | --- | --- | --- | --- | --- |
| plain `POST /api/agents/chat` | `4bf92f3577b34da6a3ce929d0e0e4736` | `4bf92f3577b34da6a3ce929d0e0e4736` | 4 | **1** | `00f067aa0ba902b7` — the span id sent |
| thread route (`202`, headless run) | `aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaab` | `aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaab` | 4 | **1** | `1111111111111112` — the span id sent |
| HITL-gated run + its separate approve request | `cccccccccccccccccccccccccccccccd` | `cccccccccccccccccccccccccccccccd` | 4 | **1** | `3333333333333334` — the span id sent |

The `http.request` span joins the same trace on all three, including the approve request, which is a
second HTTP call from the client. **The behaviour the criterion describes is present in the tree on
every path it names.**

**This reproduces § Re-measured a second time rather than discovering it.** That section already
graded criterion 6 a pass on all three paths on 2026-08-20 evening. What is new is that the result
survives six further commits, and that the third path — the gated run's approve request — was
compared here as well.

**The limit is unchanged and no criterion sees it.** Every HITL run driven *without* a `traceparent`
arrived as **three** disconnected traces: the run's, the initial POST's, and the approve POST's.
A browser sends no `traceparent`. usetheokit/theokit#404, reproduced again.

### Criterion 3 — the pause span still measures the wrong interval, and the reason is the same one

Three runs, varying only the model's post-resume latency against an instantaneous gated tool. The
tolerance is the ±25% this file already declared. The client reports the delay it actually measured,
so the comparison is against an observed wait rather than an intended one.

| model latency after resume | human wait, measured | exported `agent.hitl` | excess | run span | hitl / run |
| --- | --- | --- | --- | --- | --- |
| 20 ms | 1200 ms | **1230.000 ms** | +30 ms | 1312.000 ms | 93.8% |
| 700 ms | 250 ms | **973.000 ms** | +723 ms | 3093.000 ms | 31.5% |
| 1500 ms | 252 ms | **1776.000 ms** | +1524 ms | 6306.000 ms | 28.2% |

The excess tracks the model's latency 1:1 across a 75x change in the ratio. The criterion asks for a
duration within tolerance of the delay **and** materially shorter than the run span, and the two
halves cannot both hold: row 1 is within 2.5% of the human wait and is 94% of the run; rows 2 and 3
are comfortably shorter than the run and are 3.9x and 7.0x the human wait.

**What has improved is real and is not the criterion.** `hitl.resume_observed=true` and status `ok`
on all three — the span closes at the resume, which is what `0e9e6dc04` bought. **Why it still
measures the wrong interval was read off the wire rather than inferred**: in the third run the
approval was answered at ≈3306 ms and `tool-output-available` — the chunk `closeToolSpan` keys on —
reached the client at 4829 ms, 1523 ms later, which is the model's post-resume latency to the
millisecond. usetheokit/theokit#389.

**And an application still cannot make it pass.** The pause span is opened and closed inside
`observeAgentRun`; an application supplies no chunk and no timestamp to it, and `startSpan` takes a
name, attributes and a trace context — nothing that would let a caller end a span earlier. That
half of § Measured — TheoKit side's sentence survives; the other half of it does not, and the next
section says so.

### What this run changed elsewhere in the file, and what it did not

**Two of the three limits § The limit the criteria do not see records as open are closed in the
tree**, observed in the payloads above rather than read from the commit that claims them
(`e39ce9831`):

| Limit as recorded | Observed on the tree, 2026-08-21 |
| --- | --- |
| usetheokit/theokit#405 — the thread, approve and MCP routes never reach the plugin runner, so none emits an `http.request` span | the thread route emitted `http.request path=/api/agents/chat/threads/…/message status=202`, and the approve route emitted `http.request path=/api/agents/chat/approve/… status=200`. **Closed in the tree** |
| usetheokit/theokit#406 — the `agent` attribute is the module's absolute filesystem path on one route and a quoted label on the other | every span of both routes carries `agent=chat`. **Closed in the tree** |
| usetheokit/theokit#404 — a request with no `traceparent` arrives as disconnected traces | reproduced again: the HITL runs without a header arrived as **three** traces. **Still open** |

Neither closure moves a criterion — no criterion grades the aux routes or the `agent` label, which is
exactly what that section said about them. They are recorded because a file that lists a defect as
open after it was fixed misleads in the same direction as one that lists a criterion as failing after
it passes, which is the thing this whole section exists to correct.

**Four issue comments, no new issue.** Every finding here either confirms a filed one or verifies a
fix, so nothing new was filed. #405 and #406 were commented as *verified fixed in the tree and not
closed* — `e39ce9831` is not in `develop`, and closing on an unreleased fix would make the tracker
claim what the acceptance rule refuses to. #389 and #404 were commented with the reproductions above.

**Nothing here changes another journey.** `traceparent`, `observability` and `telemetry` appear in no
other journey file, and the three countable metrics were not re-derived today — the diff is unchanged
and no metric was re-measured, so the tally in `../dx-benchmark.md` is untouched on purpose.
