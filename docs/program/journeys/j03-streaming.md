# J3 — Streaming

The third of the ten benchmark journeys (`../dx-benchmark.md`). Criteria written before either
implementation exists; a journey whose criteria change after code exists is void and must be re-run
from scratch.

**Scheduling status:** ready. `../dx-benchmark.md` § Sequencing lists J3 in the first batch to be
implemented and measured.

## What the journey requires

Copied from `../dx-benchmark.md` § The ten journeys, unchanged. Rewording it requires an ADR,
because a movable target measures nothing.

| # | Journey | What must work |
| --- | --- | --- |
| J3 | **Streaming** | Tokens reach the user progressively, not in one block at the end |

The load-bearing word is **user**. A server that streams into a proxy that buffers has not satisfied
this journey, which is why every criterion below is observed at the client and never at the
producer.

## Acceptance criteria

In the shape `ROADMAP.md` uses: observable, with an oracle, graded by `/acceptance` against the
released artifact rather than the working tree (`.claude/rules/cycle-acceptance.md` § Target kinds).

**Definition of done (all must hold):**

- [ ] the first chunk carrying assistant text is received by the client **before** the run
      terminates, recorded chunk by chunk with a client-side timestamp per chunk — the buffered
      failure mode produces exactly one text chunk at the end and this criterion is what
      distinguishes it
- [ ] at least two distinct text-bearing chunks arrive, separated by at least 50 ms of wall clock at
      the client, over a prompt whose answer is long enough to make that possible; the chunk
      timestamps are recorded in the transcript so the separation is auditable rather than asserted
- [ ] time-to-first-chunk is at most half of time-to-completion for the same run — a ratio rather
      than an absolute, so the criterion survives a slow model and still fails a buffered one
- [ ] the same assertions hold against the **published build served over the deployed adapter**, not
      only against the dev server: a stream that survives `dev` and dies behind the production
      handler is the failure this criterion exists to catch
      (`../../../ROADMAP.md` § M14 records the buffering shim as the live blocker across six targets)
- [ ] disconnecting mid-run and reconnecting resumes the same run from where it stopped rather than
      restarting it — asserted by the absence of duplicate text in the reassembled message
- [ ] Applies to: Web, Tauri, TUI — each listed target is exercised in acceptance, not merely
      declared
- [ ] Tauri: the same progressive delivery over the in-process path, with the same two-chunk
      separation oracle applied to the events the webview receives
- [ ] TUI: the same run rendered progressively through the shared terminal presenter — text visible
      before completion, asserted on the presenter's output stream rather than on the final frame

**What resisted an oracle.** "Feels responsive" has no instrument. The 50 ms in criterion 2 is a
declared floor, not a measured human threshold, and it is chosen to be far below any plausible
perception boundary so that it tests *mechanism* rather than *quality*: two chunks 50 ms apart prove
the pipe is incremental, and prove nothing about whether the experience is good.

## The Next.js side

**A direct and strong equivalent exists, and it is the journey where the Next.js side is most likely
to win or tie.** Streaming is native ground for that stack: React Server Components stream through
`<Suspense>` boundaries, and the AI SDK's `streamText` returns a response object built for a Route
Handler to return directly, with a matching client hook that accumulates deltas.

The reference implementation: `app/api/chat/route.ts` returning the SDK's streaming response, and a
client component rendering the hook's message list. Where an official example exists it must be used
and cited (`../dx-benchmark.md` § Why the protocol comes before the measurement).

*To confirm at implementation time, because these are version-specific and this document is written
without access to that source:* the current name of the method that converts a `streamText` result
into a `Response`, whether the deployed platform imposes any buffering on the default runtime, and
whether the official example still uses the same client hook.

**One asymmetry must be recorded before any number exists.** Criterion 4 grades the published build
behind a real adapter, and our own roadmap already records a buffering shim as a live blocker across
six deploy targets. The Next.js side's most common deployment target is the one its vendor operates.
That is not a rigged comparison — it is a real difference in what each side ships — but the report
must state which adapter each side was measured on, or the numbers will be compared across
different questions.

## How the four metrics are counted here

The general counting rule is in `../dx-benchmark.md` § The four metrics. What follows is that rule
landed on this journey.

**Files touched.** Counted: any file the developer edits to turn a non-streaming answer into a
streaming one — handler, client component, transport option, config. On our side the scaffold
already streams, so as in J1 the journey is measured by the delta from a deliberately
non-streaming starting point, and the starting point is recorded in the evidence directory so the
delta is reproducible.

**Glue lines.** Business logic here is the empty set again — J3 changes no answer, only its
delivery. Every line is glue, so the margin is reported as an **absolute count**, not a multiple,
for the same reason J8 states.

**Concepts required.** Derived mechanically from the imports and APIs the diff uses. Ours currently
includes the wire protocol name, the response builder
(`packages/theo/src/server/agent/durable-ui-message-stream-response.ts:47`), the client transport
(`packages/agents/src/client/http-transport.ts:49`) and the React binding
(`packages/agents/src/client/use-agent.ts:75`). The reconnect header that criterion 5 exercises
counts as a concept: a developer who does not know it exists cannot satisfy that criterion.

**Time to first green run.** Wall clock from `npx create-theokit` to the first run where all five
assertions pass. Cold cache, at least three runs, mean and standard deviation. Note that this
journey's own subject — latency — is inside the measurement; the metric is developer wall clock, not
stream latency, and the two are reported separately so neither is mistaken for the other.

## Measured - TheoKit side, metrics 1-3 (2026-08-20)

**Three of four metrics, one side.** This is not the journey being won; it is the first number this
journey has. Metric 4 and the whole Next.js side are unmeasured, and the subsection below says why.

Obtained from a real diff, not an estimate: the scaffold template was copied verbatim, committed as
an untouched baseline, and the journey implemented on top. The counts are `git diff --numstat` over
that commit.

**The counting rule above does not survive contact with the framework, and the divergence is stated
rather than resolved quietly.** § How the four metrics are counted here says J3 is measured "by the
delta from a deliberately non-streaming starting point". There is no such starting point on this
side: the agent mount answers with fixed `text/event-stream` headers
(`packages/theo/src/server/agent/durable-ui-message-stream-response.ts:23`), nothing in
`packages/theo/src/server/agent/mount-agent.ts:98` branches to a buffered response, and the
scaffolded client already reads the result as a stream
(`packages/create-theokit/templates/default/app/hooks/use-transcript.ts:29`). A non-streaming
baseline would have to be hand-built - a plain server route that awaits the run and returns JSON -
and the delta from that would price a detour no developer takes. So the delta is taken from the
scaffold as it ships, the rule is reported as not applying rather than reinterpreted, and the
Next.js side must be measured from ITS shipped starting point for the same reason, with the report
naming both.

| Metric | TheoKit | How it was counted |
| --- | --- | --- |
| Files touched | **0** for criteria 1-3, **1** for criterion 5 | nothing is created, edited or deleted to make tokens arrive progressively; `app/hooks/use-transcript.ts` is edited to make a dropped stream resume |
| Glue lines | **0**, then **6** | this journey declares business logic the empty set, so every line of the criterion-5 edit is glue |
| Concepts required | **0**, then **3** | `useAgent`'s `reconnect`, the `status` value that reports the drop, and React's `useEffect` |
| Time to first green run | **not measured** | needs a live model call; see below |

**Zero is the result, and it is the result the counting rule was least prepared for.** Criteria 1
through 3 - a text chunk before the run terminates, two chunks separated by 50 ms, time-to-first-chunk
at most half of time-to-completion - are properties of the scaffold as generated. Per
`../dx-benchmark.md` § The four metrics, scaffolder output nobody edited counts on neither side, so
this is not a zero that was awarded to us: it is a zero that was found, and what it says is that the
developer does not participate in this part of the journey at all. A margin cannot be computed from
it until the other side is measured - `../dx-benchmark.md` § What counts as winning asks for a
factor or a stated absolute gap, and nothing is divisible by zero.

**The 6 added lines for criterion 5, classified.** Published because the glue split is the metric
most open to being argued after the fact, and a table nobody can check is not evidence.

Glue (6): `import { useEffect } from 'react'`; the two lines the widened destructure now occupies,
one of which replaces the single line that was there; `useEffect(() => {`;
`if (status === 'error') reconnect()`; and `}, [status, reconnect])`.

Business logic (0): J3 changes no answer, only its delivery. The counting rule fixed that in advance
and the diff did not contradict it.

**Four judgement calls, stated rather than buried.**

1. **Criterion 5 was counted as needing an edit at all.** The client exposes `reconnect`
   (`packages/agents/src/client/use-agent.ts:124`) and the store settles into `error` when the
   stream drops (`packages/agents/src/client/agent-client.ts:221`), but nothing in the scaffold
   calls it. A capability nobody invokes is not a satisfied criterion, so the wiring is counted.
   Deciding the other way makes J3 a flat zero on all three metrics.
2. **The reflowed destructure was counted as `numstat` reports it.** Six lines are added and one
   removed; the substance is five new lines plus a reflow forced by the 100-column formatter.
   Counting substance rather than lines gives 5.
3. **The retry shape is the minimal one.** Reconnecting on every transition into `error` will retry
   against a permanently failing endpoint. A guarded version - one attempt per run - adds about two
   lines, for 8.
4. **Concepts were derived from the diff, not from the list written above.** § How the four metrics
   are counted here names the wire protocol name, the response builder, the client transport, the
   React binding and the reconnect header. None of the first four appears in the measured diff,
   because the framework supplies all of them. The reconnect header does not appear either:
   `HttpTransport.reconnectToStream` sends no `Last-Event-ID`
   (`packages/agents/src/client/http-transport.ts:104`), so the server falls back to replaying the
   whole run (`packages/theo/src/server/agent/handle-agent-run-reconnect.ts:54`) and the developer
   never names the header. Applying the list as written scores 5; applying the rule's own first
   sentence - derive it from the diff - scores 3. The 3 is reported and the list's items are named
   here so the choice can be checked rather than trusted.

### What is still unmeasured, and why

**Metric 4 (time to first green run) needs a live model call**, at least three times, cold cache.
That spends real credits, and the number is only meaningful measured identically on both sides - so
running one side alone would produce a figure with nothing to compare it to.

**The Next.js side does not exist yet.** Until it does, nothing here is a comparison, and the
winning rule cannot be applied. A journey is won or tied; a one-sided count is neither. On this
journey that matters more than on most: § The Next.js side already predicts this is where the other
stack is most likely to win or tie, and a zero on our side does not settle a race whose other lane
is empty.

**Criterion 4 was not exercised at all.** It grades the published build behind a deploy adapter, and
`../../../ROADMAP.md` § M14 records the buffering shim as a live blocker across six targets. Nothing
above was run behind an adapter, so the criterion is neither passed nor failed here - it is
untouched, and the diff says nothing about it.

**Criterion 5's behaviour under real loss was not observed.** The edit was written; a lossy run was
not performed. Whether replay-from-start plus id-keyed upsert really yields no duplicate text in the
reassembled message is read from source and unverified, which is the same limit § Current state and
blockers already recorded.

**Which SSE encoder a measured build uses is still unrecorded.** § Current state and blockers found
two encoders emitting different event shapes; this measurement produced no run, so it did not settle
which one a benchmark run would exercise.

**The three-target criteria cannot be exercised in this repository.** The Tauri and TUI lines need
`@theokit/tui` and `@theokit/ui`, which live outside it (`.claude/rules/three-target-parity.md`
records the same limit). What settles them is the north-star app
(`.claude/rules/northstar-app.md`), which does not exist yet.

**So: J3 is not won, not tied, and not run.** It has one side of three metrics, one of which is a
zero whose meaning depends entirely on a number nobody has produced.

## The deliberately broken state

Per `../dx-benchmark.md` § The fifth, which is pass/fail and not a number. The break for J3 is a
**client that consumes the response as a whole body** — calling the JSON/text accessor on a
`text/event-stream` response instead of reading it as a stream. It is the most common real mistake
and the one where a good error saves the most time.

| | |
| --- | --- |
| Names the action | `this endpoint returns text/event-stream; reading it as a whole body buffers the run. Consume it with the agent client, or read response.body as a stream.` — names the content type, the consequence, and both ways out |
| Does not name the action | `Unexpected token 'd', "data: {"ty"... is not valid JSON` — technically the truth, and it points at the parser rather than at the decision |

A second break is recorded in the same transcript because criterion 4 exists for it: **a deploy
adapter whose handler buffers.** The message that names the action reads like
`adapter "netlify" buffers the response body; this route declares streaming. Choose a streaming-capable target or remove the streaming declaration.`
The message that does not name it is the current behaviour under the shim — no error at all, a
correct answer, arriving all at once. That silent case is graded as **fail**, per the rule J8
establishes: an absent error on a wrong outcome is worse than an unhelpful one.

## Current state and blockers

Measured against the working tree on 2026-08-20; every claim is read from source.

**Nothing blocks J3 at the framework layer. Criterion 4 has a known live blocker at the adapter
layer, and it is deliberately inside the journey rather than excused from it.**

What is wired end to end:

- The server mounts an agent as an SSE endpoint (`packages/theo/src/server/agent/mount-agent.ts:98`),
  called from the dev middleware (`packages/theo/src/vite-plugin/agent-middleware.ts:329`) and from
  the production server (`packages/theo/src/cli/commands/start/handlers.ts:372`).
- The response is `text/event-stream` with per-frame monotonic ids
  (`packages/theo/src/server/agent/durable-ui-message-stream-response.ts:22`, frame builder at
  `:33`, response at `:47`), which is what makes reconnect possible at all.
- Chunks are produced by a shared presenter rather than a per-target encoder
  (`packages/presenter/src/presenters/ui-message-stream.ts:45`, text deltas at `:140`), reached
  through the generator at `packages/agents/src/bridge/present-ui-message-stream.ts:144`.
- The client reads it as a stream, not a body
  (`packages/agents/src/client/http-transport.ts:79`, decode at
  `packages/agents/src/client/consume-ui-message-stream.ts:44`), and the React binding subscribes to
  a store rather than re-rendering per token
  (`packages/agents/src/client/use-agent.ts:113`).
- Reconnect exists and is a real route (`packages/theo/src/server/agent/handle-agent-run-reconnect.ts:38`,
  `Last-Event-ID` at `:31`), which is what criterion 5 grades.

**The one finding that will shape the measurement: there are two SSE encoders in the tree, emitting
different event shapes.** The production path uses the durable one above; a second encoder
(`packages/agents/src/bridge/agent-sse-handler.ts:21`) is reachable only through the agents plugin's
route generator (`packages/agents/src/bridge/agent-route-generator.ts:58`), which has no caller
inside `packages/theo/src`. The benchmark must record which encoder the measured build used, because
a reader comparing two runs across the two encoders would be comparing two protocols.

**Not measured:** whether criterion 5's reconnect actually resumes without duplication under real
loss. The route and the header parsing were read; a lossy run was not performed. Recorded as a
measurement to make during implementation, not as a claim.

## Cross-references

- The benchmark this journey belongs to: `../dx-benchmark.md`
- The milestone whose blocker criterion 4 inherits: `../../../ROADMAP.md` § M14
- The journey that streams the same run to a terminal: `j10-deploy.md` for the target, `j01-tool.md` for the run
- Acceptance contract that grades these criteria: `../../../.claude/rules/cycle-acceptance.md`
- Criterion shape these follow: `../../../ROADMAP.md` § Wave 1
