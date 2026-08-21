# The DX benchmark — ten journeys, measured against Next.js

The second of the program's two obligations. Parity (`ROADMAP.md`) is the price of entry; this is the claim that justifies the framework existing. It is stated as a number so it can be wrong.

**The claim under test:** building an agent-executed application in TheoKit costs less than building the same thing in the best idiomatic Next.js equivalent — across all ten journeys, by a margin outside measurement noise.

## Why the protocol comes before the measurement

A benchmark written by the vendor of one side is worthless unless its rules make cheating visible. The three ways this measurement would lie, and what stops each:

| How it would lie | What stops it |
|---|---|
| Choose journeys TheoKit happens to be good at | The ten journeys are fixed **here, before any implementation exists**, and come from what an agent application actually does — not from a feature list |
| Write a strawman on the Next.js side | Where an official example exists it **must** be used and cited. Where none does, the implementation is written to *win*, and the reviewer's job is to make it shorter |
| Shape the journey until our version looks good | **Acceptance criteria are written before either implementation.** A journey whose criteria change after code exists is void and must be re-run from scratch |

The protocol is the deliverable. The numbers are a consequence.

## The ten journeys

Fixed. Adding, removing or rewording one requires an ADR, because a movable target measures nothing.

| # | Journey | What must work |
|---|---|---|
| J1 | **Tool** | An agent calls a typed tool and uses its result in the answer |
| J2 | **HITL** | A tool call pauses for human approval; approving resumes it, rejecting does not run it |
| J3 | **Streaming** | Tokens reach the user progressively, not in one block at the end |
| J4 | **Thread** | A conversation survives a page reload and continues with its history |
| J5 | **Multi-step** | The agent chains two tool calls where the second depends on the first |
| J6 | **Retry** | A tool that fails transiently is retried with backoff; a permanent failure is not |
| J7 | **Rate limit** | A caller exceeding a declared budget is refused, and told so |
| J8 | **Tenant** | Two tenants' threads and approvals are invisible to each other |
| J9 | **Observability** | An operator answers "what did this run do, how long, and what did it cost" from recorded telemetry |
| J10 | **Deploy** | The application runs on a target that is not the developer's machine |

Each journey gets acceptance criteria written before implementation, in the same shape `ROADMAP.md` uses — observable, with an oracle.

## The four metrics

| Metric | Definition | Counting rule |
|---|---|---|
| **Files touched** | Files created or edited to satisfy the criteria | Scaffolder output not edited by hand does not count on either side |
| **Glue lines** | Lines that are not the journey's business logic | Counted from the committed diff. Config, wiring, type ceremony and boilerplate are glue; the tool's actual behaviour is not. The rule is applied identically to both sides and the diffs are published |
| **Concepts required** | Named things a reader must already know to understand the code | Derived mechanically from the imports and APIs used, not from opinion. `useState` is one concept; so is `AgentBuilder` |
| **Time to first green run** | Wall clock from the create command to the first run meeting the criteria | Cold cache, ≥3 runs, mean ± σ reported. A single run is not a measurement |

### The fifth, which is pass/fail and not a number

**When it fails, does the error name what to do?** Each journey is run once in a deliberately broken state (missing key, wrong signature, absent approval). The error either names the action or it does not. This is non-negotiable and it is scored on both sides — the baseline already measured on our side is 72% of error sites naming the action, sampled 29 of 179.

## What counts as winning

A journey is **won** when TheoKit is better on the three countable metrics and not worse on time-to-green — with a margin **outside noise**:

- Files, glue lines, concepts: a difference of **≥ 2×**, or a stated absolute gap large enough that a plausible re-implementation of the loser could not close it.
- Time to first green: non-overlapping intervals at ±1σ over ≥ 3 runs.

A journey where the margin is inside noise is a **tie**, and a tie is reported as a tie. The goal states "win all ten by a margin outside noise"; anything softer than that is not the goal being met, and reporting it as met would be the exact failure this program was created to stop.

## Evidence

Both implementations of every journey are committed under `docs/program/evidence/jN-<journey>/` — they are small, and a comparison nobody can re-run is an assertion. Each carries:

- the acceptance criteria, dated **before** the first commit of either implementation
- both diffs
- the metric counts with the counting rule applied line by line
- the failure-mode transcript for the fifth metric
- the Next.js source cited: the official example used, or why none applied

## Relationship to the north-star app

Different instruments, different questions. The north-star app (`northstar-app.md`) asks *does the framework do what it claims, across three targets*. The benchmark asks *is it less work than the alternative*. The app exercises 55 capabilities; the benchmark exercises ten journeys deeply, twice each.

They share no code. An app tuned to make the benchmark look good would corrupt both.

## Sequencing

The benchmark cannot run credibly yet, and pretending otherwise would waste it:

- **J9 (observability) was unmeasurable and now is not — re-measured 2026-08-20.** The blocker was
  real: no signal existed for a run, a tool call, an approval or a token, and scoring it then would
  have measured wiring rather than design. All four now exist and reach an exporter from a
  production path (`packages/theo/src/server/agent/observe-agent-run.ts`, wired in `mount-agent.ts`
  and `build-agent-streamer.ts`; the exporter drains on its interval and on SIGTERM). **J9 is
  unblocked.** What it will measure is the framework's design, which is what the journey is for.
- **J2 (HITL) was under an open security advisory, and was measured anyway on 2026-08-20.** The
  advisory (GHSA-g94h-459g-rjhj) is still open, and the hold assumed the authorization was about to
  change under the measurement. It has not: the endpoint still authenticates nobody, so criterion 4
  was graded as the failure it is rather than waited out, and the end-to-end reproduction went to the
  advisory rather than to a public issue. **J2 is measured and lost** — see below.
- **J10 (deploy) depended on #350, and the hold is discharged — measured 2026-08-20.** The condition
  this line set was a tracker query, not a memory; the query was run and **#350 is closed**
  (`2026-08-20T12:45:57Z`). The criterion it guarded was then exercised rather than inferred: three
  consecutive builds on each side, all producing a deployable artifact. **J10 is measured and lost**
  — see below.

So the honest order is: define the criteria for all ten now (this document plus ten criteria files),
implement and measure J1, J3, J4, J5, J7, **J9** after Wave 0.5 wires what exists, and hold J8 until
its own blocker is named. J2's hold expired for the reason above — the authorization did not change
under it, so waiting longer would have withheld a result rather than protected one. **J8's hold was
discharged on 2026-08-20, and not by the blocker clearing.** The blocker was named — the framework has
no tenant — and holding for it would have waited on a primitive nobody is building. What its own
criteria file said instead is that the fair comparison is hand-rolled against hand-rolled, so both
sides were hand-rolled and both were run. **J8 is measured and lost** — see below.

**J1 has both sides now, and it is a tie — measured 2026-08-20.** It is the first real contrast this
document has, and it does not go our way: TheoKit touches *more* files than the best idiomatic
Next.js equivalent (3 against 2, the third being a deletion its own scaffold forces), and its wins on
glue lines (8 against 14) and concepts (5 against 6) are 1.75x and 1.2x — both inside the 2x bar
§ What counts as winning sets. A single declared counting decision moves four of the six glue lines,
and moves them the wrong way. The full measurement, the confirmed AI SDK version facts, the chosen
baseline and the published diffs are in [J1's criteria file](journeys/j01-tool.md). One journey is
not the benchmark, and a tie on the simplest of the ten is the kind of early number this protocol
exists to make visible rather than to absorb.

**J5 has both sides now, and it is also a tie - measured 2026-08-20.** Two of ten, and the second
contrast lands harder than the first. On the three countable metrics the two sides are level: 2
files against 2, 8 glue lines against 8, 5 concepts against 6 - 1.0x, 1.0x and 1.2x, every one of
them inside the bar § What counts as winning sets, and three declared counting decisions each move a
metric to the Next.js column. Worse, the journey's own criteria are not symmetric: TheoKit satisfies
three of five, because **an application's declared step ceiling never reaches a served run from
either authoring path** - the fluent builder has no method for it, the decorator's value is dropped
before the adapter builds its options, and the loop that enforces one is not on the served path at
all. Next.js satisfies all five, and the option that satisfies them is the same one that enables the
chain. The full measurement, both published diffs, the six declared judgements and the confirmed AI
SDK version facts are in [J5's criteria file](journeys/j05-multi-step.md).

**J5 was re-measured the same day, because the capability it lost on shipped — still a tie, and now
a more expensive one.** The paragraph above is left standing as the record of what was true when it
was written; hours after it, `3762c7d0f` gave the fluent builder, `defineAgent` and the decorator
path a step ceiling that reaches the served run. Re-run against that framework, TheoKit satisfies
**four** of five criteria instead of three — and the three countable metrics move the other way:
glue lines 9 against 8, concepts **6 against 6**. The framework spent the only metric it led on this
journey to stop failing two criteria, because a ceiling nobody can declare is also a name nobody has
to learn. The margins are 1.0x, 1.125x and 1.0x, so it is still a tie, and criterion 4 is still open
for a narrower reason: the declaration now travels, and the step-limit outcome still does not come
back to the caller (usetheokit/theokit#379). The re-measurement, the re-run judgements and the before-and-after table are in
[J5's criteria file](journeys/j05-multi-step.md).

**J3 has both sides now, and it is the first journey where every countable metric goes our way by a
margin outside the bar - and it is still not a win, for a reason worth stating plainly: the numbers
price an implementation that was run and does not work.** Measured 2026-08-20. The journey splits in
two. On criteria 1 to 3 - tokens arriving progressively - both sides are **zero on all three
metrics**: neither developer writes anything, because both shipped starting points already stream,
and § The four metrics excludes untouched scaffold output on both sides. On criterion 5 - reconnect
after a mid-run drop - TheoKit touches 1 file, 6 glue lines and 3 concepts against Next.js's 5, 53
and 12: 5x, 8.8x and 4x. Then the criterion was exercised, and our six lines never fire. A mid-run
disconnect settles the client store in `'done'`, not `'error'`, so the wired trigger is never
reached (usetheokit/theokit#384), and the run id lives only in memory, so a reload cannot reconnect
at all. J5 already fixed the rule this falls under - "the honest entry for them is 'no path', never
'0 lines'" - and a cost paid for an unsatisfied criterion is the same kind of entry. The Next.js
version was exercised against a live Redis and works.

**J3's criteria go the other way, 5-3 on what each side satisfies, and criterion 4 is the sharp
one.** Ours passes criteria 1 to 3 on the served path, measured with a client-side chunk timer: 8
text chunks 120 ms apart, first text at 0.26 of the run. Behind the deploy shim the same run arrives
as **one chunk at the instant it completes** (ratio 0.999) - the buffered failure mode criterion 1
was written to catch, now reproduced rather than inferred (usetheokit/theokit#382). And beneath that
sits a deeper failure of the same criterion: no adapter serves an agent at all, in any of the
fourteen files under `packages/theo/src/adapters/`. The full measurement, both published diffs, the
six declared judgements, the instrument, and the four confirmed AI SDK version facts are in
[J3's criteria file](journeys/j03-streaming.md).

**J9 has both sides now, and it is the first journey where TheoKit wins every countable metric — and
it is still not won.** Measured 2026-08-20 against a real local OTLP collector on both sides, with the
three observability commits of that day confirmed present. Files 1 against 3, glue lines 2 against 14,
concepts 3 against 7 — 3x, 7x and 2.33x, every one outside the bar § What counts as winning sets. The
journey is not won because the criteria are not: TheoKit satisfies **three** of the seven, the Next.js
side **five**. No span records the model identifier, so criterion 5's cost question has no answer on
our side and does on theirs; the `http.request` span joins no trace and the thread route drops the
incoming `traceparent`, so criterion 6 holds on one path of three; and a HITL pause span reports the
run's duration rather than the human's. Every one of those is a framework defect an application cannot
fix and none of them costs the application a line to close — which is the strongest thing that can be
said for the 3x, and it is worth nothing until usetheokit/theokit#361, #380, #381, #385 and B-019 do
close. The measurement, both diffs, the collector payloads and seven declared judgements are in
[J9's criteria file](journeys/j09-observability.md).

**J9 was re-measured the same day and reported as the first won journey of the ten. Later the same
day metric 4 was measured, and it is not won** — the winning rule requires "not worse on
time-to-green", and TheoKit is worse by the rule's own test: 30.40 ± 7.50 s against 14.93 ± 0.91 s
over three runs each, intervals non-overlapping, 2.04x on the means. The whole loss is install (19.6 s
against 4.2 s); TheoKit's **build is faster**, 7.8 s against 10.2 s. The measurement, its harness and
its caveats are in [J9's criteria file](journeys/j09-observability.md) § Metric 4. The paragraph below
is left standing as the record of what was concluded before that number existed, because a retraction
that edits away what it retracts teaches nobody what went wrong.

**Metric 4's number is a baseline, and that changes what it means for the other nine.** What was
timed is the scaffold each journey starts from — install, build, start, first response — and every
journey's delta is single-digit lines of source against a gap of 15.5 seconds. The delta cannot move
it. So the honest reading is not "metric 4 is unmeasured on nine journeys"; it is that **the same
baseline gap applies to all ten, and a journey can only escape it if the Next.js side's own delta
costs more than 15.5 s of install** — and none measured so far comes close. The dependencies that
side adds are pure JavaScript: `p-retry` on J6, `resumable-stream` and `redis` on J3,
`@upstash/ratelimit` on J7. Seconds, not fifteen.

The consequence is worth stating plainly rather than leaving to be inferred: **until the install cost
is resolved, no journey can satisfy the winning rule's fourth clause, so no journey can be won.** J9
did not lose metric 4 because of anything J9 does. It lost the scaffold's, and so would the other
nine.

**Correction, measured the same evening: the native dependency is the largest single cost and it is
not the whole cost.** The paragraph originally read "the cause is one native dependency", which was a
step further than the evidence went — the 6.7 s → 1.4 s figure was for installing `@theokit/agents`
alone, and what metric 4 times is the whole application. Measured on the scaffolded app, two runs
each: **26.1 s as it ships against 15.5 s with `node-pty` out of the tree**, its absence verified
rather than assumed. That is between 2.6 s and 10.6 s saved depending on which pair of runs is
trusted — the variance is real and it is mostly on the current side, which is itself the native
build's signature.

Projected onto the total, TheoKit lands somewhere between 19.8 s and 27.8 s against Next.js's 14.9 s:
**still 1.33x to 1.86x worse, still the wrong side of "not worse".** So `B-025` is necessary and not
sufficient. Resolving it removes the largest term and leaves an install that is still roughly 15 s
against 4.2 s, which is a second question nobody has asked yet: what the remaining eleven seconds are.

**And the remaining eleven seconds turned out to be measurable in one command.** With
`--ignore-scripts` the two applications install in 10.5 s against 5.4 s, so **78% of the 23.5 s gap
is lifecycle scripts and 22% is the tree itself**. Exactly two packages in the whole TheoKit tree
declare one — `node-pty` and `esbuild` — and the Next.js side declares **none**, because it ships its
platform binary as `@next/swc-*` optionalDependencies that npm resolves without executing anything.
That is the difference in one sentence: one stack downloads or compiles in a hook, twice; the other
picks a prebuilt package by platform.

So metric 4's loss is not a diffuse "TheoKit is heavier". It is two lifecycle hooks and a five-second
tree, and both hooks have a shape the comparison already solved. `B-025` covers the larger one and
its DoD now names the second rather than leaving it for the next person to rediscover.

`B-025` carries the measurement, the attempted fix and the reason that fix was reverted — two
well-argued rules conflict, and resolving them is a decision rather than a repair.

This also inverts the order of the remaining work. Closing defects a journey names and re-measuring
is what produced J9's six-of-seven criteria, and it is the right method; it simply cannot produce a
win on its own from here. One dependency decision gates all ten.

**What is genuinely unmeasured on the other nine is the per-journey delta**, which is bounded above by
the difference between each side's added dependencies and is small on every journey measured. Timing
them individually would refine the number and cannot change its sign. The
install cost measured here is a baseline both sides pay on every one of them, and it is invisible to
files, glue lines and concepts — which is why the goal names four metrics and not three. A framework
can be cheaper to write in every countable way and still make a person wait twice as long to see the
first thing work.

The paragraph above
stands as the record of what was true when it was written; hours after it, four commits closed four of
the five defects it named. Re-run at `91fce4761` against the same local OTLP collector — and this time
against a **published build started by the shipped CLI**, which closes the criterion-7 asymmetry the
first run recorded against us — TheoKit satisfies **six** of the seven criteria against the Next.js
side's five. The model identifier is on the exported run span under the OpenTelemetry GenAI spelling,
so criterion 5's cost question now has an answer; the `http.request` span and the thread route both
continue the caller's trace and name the caller's span as parent, so criterion 6 holds on all three
paths; and a gated tool produces one span rather than two. **The three countable metrics did not move
— files 1 against 3, glue lines 2 against 14, concepts 3 against 7, or 3x, 7x and 2.33x** — because
the breaking policy gate of `91fce4761` costs this journey nothing: the scaffold ships the declaration
and the untouched baseline builds, starts and answers `200`.

**What the win rests on, stated where it will be contested.** Files and glue lines rest on no
judgement that could flip them — every declared alternative leaves both outside the bar. **Concepts
at 2.33x rests on one judgement**, re-argued from scratch here and decided the same way twice: whether
the Next.js side's four instrumentation names are four concepts or one setup block. Read as one, the
ratio is 1.33x, the concepts metric is a tie, the winning rule's "all three" is not met, and J9 is not
won. And **metric 4 is unmeasured on both sides**, so the rule's "not worse on time to green" clause
is untested rather than satisfied — every journey so far has that hole, and this is the first one
where it matters. The one criterion TheoKit still fails, criterion 3, the Next.js side fails too and
fails harder: its pause span does not exist, and its two halves of an approval land in two unrelated
root traces. Ours exists, closes at the resume, and measures the human's wait **plus the model's
next-turn latency** (measured excess of 41, 719 and 1510 ms against model latencies of 20, 700 and
1500 ms) — usetheokit/theokit#389.

**And the trace the two lines buy is still incomplete in ways no criterion sees.** A request with no
`traceparent` — which is every request a browser makes — arrives as two disconnected traces
(usetheokit/theokit#404, reproduced on the production build). The thread, approve and MCP endpoints
emit no `http.request` span at all, because the aux branch never reaches the plugin runner
(usetheokit/theokit#405). And the `agent` attribute an operator groups by is the module's absolute
filesystem path on one route and a quoted label on another (usetheokit/theokit#406). All three are
framework defects that cost the application zero lines to close, and all three were found only by
running the shipped CLI rather than by reading. The re-measurement, the collector payloads from a
published build, the re-argued judgements and the before-and-after tables are in
[J9's criteria file](journeys/j09-observability.md).

**J6 has both sides now, and it is the first journey run end to end without a live model on either
side — a tie on cost, and a criterion lost to a defect only a run could find.** Measured 2026-08-20.
The three countable metrics are the narrowest set this programme has produced: files 1 against 1,
glue lines 10 against **9**, concepts 5 against 5 — 1.0x, 1.11x and 1.0x, with TheoKit the worse side
on the only metric that is not level. Both sides get the retry loop from a primitive they did not
write (`Retry.create` on ours, `p-retry` on theirs), which refutes this journey's own premise that
neither side has one, and produces the tie it predicted for a different reason. The criteria go 4 of
5 against 5 of 5. Retry itself works on our side, measured rather than read — transient failures
retried with strictly increasing jittered delays, a permanent failure not retried, a custom error
type honoured by the shipped predicate with nothing configured. What fails is criterion 2's second
half: **a tool that throws — including one that throws after exhausting every retry — reaches the
caller as a successful tool result on a run that ends `done`**, because the SDK's `exitCode: 1` is
discarded and `isError` is hardcoded `false` (usetheokit/theokit#388). That is the fourth instance in
one day of abnormal termination reported as normal, after #379, #384 and #382. The measurement, both
published diffs, the eleven declared judgements, the local-model instrument and the wire payloads
from both sides are in [J6's criteria file](journeys/j06-retry.md).

**J2 has both sides now, and it is the first journey the framework outright loses — on the journey its
own criteria file called the one where Next.js does not compete.** Measured 2026-08-20, both lanes run
end to end against a local scripted model. Files 4 against **2**, glue lines 62 against **38**,
concepts 7 against **6** — every countable metric goes to Next.js, and files at exactly the 2x bar
§ What counts as winning sets, so metric 1 is a loss rather than a tie. The criteria are level at 3 of
5 each and fail in opposite halves. The capability premise held and was measured: our run genuinely
pauses (gate removed, 42-102 ms to the terminal frame; gate in place with a scripted 1000 ms decision,
1053-1056 ms), and `streamText` cannot — it returns the approval request and completes in 20 ms. That
difference is worth zero on the three metrics, and what cost the lines was elsewhere: **`ai@7.0.70`
ships tool approval as a first-class primitive** (`toolApproval`, `addToolApprovalResponse`, and
HMAC-signed approval requests), which retires this journey's premise that the Next.js side has only a
recipe; and **our client store drops the approval chunk**, so an application on `useAgent` gets
`approve(approvalId, …)` with no way to obtain the id (usetheokit/theokit#392). Criterion 4 fails to
the tool's side effect — a separate process, holding nothing, read the id from an unauthenticated
listing and the gated tool ran; that is recorded against GHSA-g94h-459g-rjhj, not in a public issue.
Criterion 5 is the one thing that goes our way, and the same behaviour fails the fifth metric: an
approval that **expires** is reported as `denied by human approver`, byte-identical to a human pressing
Deny (usetheokit/theokit#393) — the fifth instance of the family after #379, #384, #382 and #388. The
measurement, both published diffs, the seven declared judgements, the confirmed AI SDK version facts
and the instrument are in [J2's criteria file](journeys/j02-hitl.md).

**J2 was re-measured the same day, because the defect that priced the loss was fixed — and it is
still lost.** The paragraph above stands as the record of what was true when it was written; hours
after it, `4411a59be` gave the client store `pendingApprovals` and put the paused tool in
`state: 'approval-requested'` with its id, closing usetheokit/theokit#392 and #394. Re-run against
that framework the counted client stops polling: **glue lines 62 → 42** and **concepts 7 → 5**, so
the client half of the diff is now 26 lines against the AI SDK's 27 — one line shorter. TheoKit also
satisfies **four** of five criteria instead of three, because the approval the surface renders now
names the tool, its resolved input and the question. **Files touched did not move — 4 against 2, the
2x bar — so metric 1 is a loss for the second time and the journey is not won.** Unlike J5, gaining
the capability cost nothing here: the missing thing was not a declaration but a discovery, and its
whole price was paid by the application. Criterion 4 still fails to the tool's side effect against
GHSA-g94h-459g-rjhj, unchanged, and the re-measurement corrects one arithmetic slip in the first
one's judgement table. The re-run counts, the re-graded criteria, the two new judgements and the
before-and-after table are in [J2's criteria file](journeys/j02-hitl.md).

**J4 has both sides now, it is a tie, and it is the first journey where every criterion is satisfied
on both sides — measured 2026-08-20, in a real browser, against a local model on both stacks.** Files
4 against 5, glue lines 59 against 74, concepts 13 against 13 — 1.25x, 1.25x and 1.0x, every one
inside the 2x bar § What counts as winning sets. What makes this one different from the five before
it is the row underneath: **5 of 5 criteria against 5 of 5**, exercised rather than inferred — a full
document reload, a follow-up turn whose answer quotes a marker sent before the reload, a cleared
browser store, and two threads whose message ids do not intersect. The framework is not cheaper here,
and for the first time it is not short of the thing the criteria describe either.

**J4's first measurement was published this morning and did not survive the afternoon, which is worth
recording rather than editing away.** It reported criterion 1 as having *no implementable path* on the
grounds that reading a transcript back means inventing a reader over a format that lives outside this
repository. The format is re-exported by this repository — `loadJsonl`, `transcriptPath` and the
`TranscriptMessage` type are public on `@theokit/agents/persistence`, a subpath a scaffolded app
already depends on — so the history endpoint is 27 lines of ordinary route. usetheokit/theokit#364
still describes the code it cites exactly, and its claim that no supported path exists is now refuted;
that correction is posted on the issue, which stays open because the identity workaround is still
ceremony an application should not write. The measurement, both published diffs, the nine declared
judgements, the four confirmed AI SDK version facts and the local-model instrument are in
[J4's criteria file](journeys/j04-thread.md).

**J7 has both sides now, and it is the framework's best result so far — three countable metrics won by
a margin outside the bar, on an implementation that was run and works on both sides, and it is still
not a win.** Measured 2026-08-20, both lanes exercised end to end against published builds: `theokit
build` + `theokit start` on ours, `next build` + `next start` on theirs, with the Next.js limiter
against a real Redis. Files 1 against 3, glue lines 2 against **26**, concepts 3 against 9 — 3x, 13x
and 3x, every one outside the 2x bar § What counts as winning sets. And unlike J3 and J9, the numbers
price something that works: **5 of 5 criteria against 5 of 5**, exercised rather than inferred, with
the wait in criterion 3 actually performed and a side-effect log in a third process proving the
refused request did no work. Two things stop it. **Metric 4 is unmeasured on both sides**, and the
win condition requires "not worse on time-to-green" — unmeasured is not "not worse". And the margins
are not pricing the same purchase: 26 lines buy a Next.js application a limiter on every target it
deploys to, shared across instances; 2 lines buy a TheoKit application a limiter on one target,
private to one process, on a server where a plain `POST` with a JSON body to the protected route
never returns at all. The journey also settled two questions the criteria never asked: **the limit is
per-caller on both sides, and only ours is not client-writable** — `x-forwarded-for` bypasses the
official Next.js idiom twice out of two attempts off-platform and is ignored by our limiter by
default; and **neither side speaks the current rate-limit specification**
(draft-ietf-httpapi-ratelimit-headers-11), though both emit a conformant `Retry-After`. No sixth
instance of the abnormal-ending family here: a refused request is reported as refused on both sides.
The measurement, both published diffs, the eleven declared judgements, the confirmed Vercel and
Upstash version facts — including that Vercel's own in-code answer, `@vercel/firewall`, is a client
for a dashboard rule that fails open and is a no-op outside production — are in
[J7's criteria file](journeys/j07-rate-limit.md).

**J7 was re-measured on 2026-08-21, and metric 4 stopped being what holds it open.** Both lanes
rebuilt, metrics 1-3 re-derived from fresh diffs (unchanged: 1/3, 2/26, 3/9), criteria re-exercised
(unchanged: 5 of 5 both sides, over nine runs), and metric 4 measured for the first time on this
journey: **13.00 ± 1.23 s against 14.72 ± 2.04 s over six runs each, intervals overlapping** — so the
"not worse on time-to-green" clause is satisfied, and it is satisfied under a no-lockfile protocol
too. Of the two reasons the paragraph above gives, one is now measured away and the other splits:
the `POST`-with-a-body clause is **fixed in the tree and unreleased**, still reproducing 3 of 3 on
the artifact npm serves; the store asymmetry is **withdrawn as a reason**, because § How the four
metrics are counted here pre-committed to recording it rather than scoring it. What remains is a
third claim the old sentence folded into the second: the two lines protect `node`, the one target
`theokit start` serves, and the six adapters built on the Web-standards handler parse the same budget
and hand it to nobody. That is J3's shape, and it is what J7 is still reported on. The
re-measurement, the lockfile asymmetry it found in metric 4's protocol, and the Vite 7 result are in
[J7's criteria file](journeys/j07-rate-limit.md) § Re-measured.

**All ten journeys are measured — four ties, three losses, one unresolved, one metric sweep and one
that wins every countable metric, every criterion it needs, and still loses on the fourth metric
nobody had run — and the framework has not won a single one. The program's second obligation is now
measured in full, and it is not met.**

**J9 was reported as won for a few hours and the report was withdrawn**, by the measurement it was
missing rather than by an argument: metric 4, unmeasured on all ten, puts TheoKit at 30.40 ± 7.50 s
against 14.93 ± 0.91 s, intervals non-overlapping, and the winning rule's fourth clause is "not worse
on time-to-green". The retraction is recorded rather than edited away because the way it happened is
the useful part — three metrics and seven criteria all agreed, and the one nobody had run disagreed. This paragraph read "eight"
while ten of the paragraphs around it existed, because the count was updated one journey late twice
running; a closing tally that lags the sections it summarises is the one sentence a reader trusts and
should not, so it is corrected here rather than incremented again. The goal states "win all ten by a
margin outside noise". Ten of ten are in, and the
three that produced the largest margins are the three that did not win. J5's re-measurement
could not change that sentence because shipping the missing capability moved a criterion, not a
margin. J3 and J9 could not change it for opposite reasons: J3's margins price six lines whose
trigger never fires, and J9's margins are real while the criteria they were meant to serve stay
unsatisfied. A journey is won by costing less to build *the thing the criteria describe*; costing
less to build something short of it is a different sentence, and this document will keep them apart.
J4 is the first journey to which that sentence does not apply — both sides built the thing the
criteria describe — and it is still a tie, which is the other half of the goal and the half no
journey has met yet. J7 is the second, and it is the closest any journey has come: both sides built
the thing the criteria describe, and the margins are 3x, 13x and 3x. What holds it open is an
unmeasured fourth metric and a reach the cheap side does not have.

**J10 has both sides now, both were containerised and run, and it is the second journey the framework
outright loses — on the journey its own criteria file predicted it would.** Measured 2026-08-20. The
hold this document placed on #350 was discharged by the tracker query it demanded (#350 closed
`2026-08-20T12:45:57Z`). Against Next.js's best target — its vendor's platform, zero files and zero
lines by documented inference — TheoKit's only target that can serve an agent costs **3 files, 12 glue
lines, 9 concepts**, and there is no deploy command in the framework at all. Against Next.js's
*container*, the numbers invert to 3/3, **12 against 247** and 9 against 13; that 20.6x is the most
fragile margin this programme has produced, and it was tested rather than argued: a 9-line Dockerfile
of the same shape as ours was **written, built and run** on the Next.js side, and it serves — at which
point the three metrics read 1.0x, 1.08x, 1.0x. § The Next.js side forbids the container-only
comparison in advance, so the verdict is the loss. Criteria go **4 of 6 against 5 of 6**: both sides
serve the agent turn, the tool call and the progressive stream from a container, and both fail
criterion 1 for the same reason — no platform account was obtainable non-interactively on either side.
The fifth metric goes our way, and it is the first time: a missing key at the target reaches our caller
as `OPENAI_API_KEY is not set. Set OPENAI_API_KEY, or change the model's provider prefix`, and reaches
theirs as `An error occurred.` with the actionable text left in a server log. **The finding is a
seventh instance of the family, and it is the first that is a deploy**: a container built from the
documented path starts, logs `→ http://localhost:3000`, and refuses every request, because
`config.host` defaults to loopback — and the success line is byte-identical whether the container
serves everyone or nobody (usetheokit/theokit#402). That default is a regression from a fix that landed
the same day. The measurement, both published diffs, the six declared judgements and the shim,
container and proxy runs are in [J10's criteria file](journeys/j10-deploy.md).

**J8 has both sides now, and it is the third journey the framework outright loses — the first one
where both sides satisfy every gradeable criterion and the framework loses anyway.** Measured
2026-08-20 against published builds on both lanes, with two tenants, a signed session on each side and
a side-effect recorder in a third process. Files 9 against 9 — level; concepts 13 against **11** —
1.18x, inside the bar; glue lines 193 against **147**, and this journey's own counting rule fixed in
advance that glue is scored as an **absolute gap** here, because business logic is the empty set and a
ratio over zero is undefined. Forty-six lines is the three files ours has and theirs does not: the
agent route, the owner map, and the approve route — all three forced, because the framework's own
agent, thread and approval endpoints are dispatched ahead of application routes
(`packages/theo/src/cli/commands/start/request-handler.ts:255-257`) and expose no policy seam, and
`mountAgent` — the one function that accepts a `policy` — is exported only from a file whose header
says it is not the public API. **ADR 0001's primitive is not in the published artifact at all**:
`requireOwner`, `evaluateRoutePolicy`, `subjectFromContext` and `route().policy(…)` appear nowhere in
`theokit@0.48.14`, npm `latest`. Adding them would cost six more lines here, not fewer, because a
route policy answers "may this subject call this route" and J8 asks "which records may this subject
see" — a question the key answers, and there is no key contract. **The criteria are 5 of 5 against 5
of 5 and the property they protect is not**: the same published build that serves the isolated
application returns one tenant's conversation to an unauthenticated caller, with a `200` and no log
line — an eighth instance of the family, and the first that is a cross-tenant read. That went to a
security advisory rather than to a public issue; the source-level version is already public as #365,
opened by the maintainers and explicitly never exercised. The measurement, both published diffs, the
twelve declared judgements, the four confirmed Vercel / Next.js / AI SDK version facts and the two
injected breaks are in [J8's criteria file](journeys/j08-tenant.md).

**One thing this re-measurement should not be read as.** J9 being unblocked means it can be scored;
it does not mean it will score well. A journey that is newly possible and a journey that is
comfortable are different claims, and the second is exactly what the benchmark exists to test rather
than to assume.

Reporting a partial run as the benchmark is forbidden. Ten journeys or a stated subset with the reason — never a subset presented as the whole.

## Metric 4 — the sweep, 2026-08-21

Metric 4 had been run on exactly two of the ten: J9 (2026-08-20) and J7 (2026-08-21). It is the
clause that retracted J9's win after it had been declared, so a journey whose metric 4 is unmeasured
cannot be called won — and eight journeys were in that state. This section records the sweep that
closed them, journey by journey, under one protocol.

**The protocol, fixed before the first run and applied identically to every pair.** A lockfile on
both sides, because both scaffolders write one and J9's asymmetry charged about 3.8 s to one lane
only. Lanes alternate run by run, so machine drift falls on both columns. Minimum three runs per
lane, mean and 1σ, and the test is the one § What counts as winning states: non-overlapping
intervals at ±1σ. Metric 4's clause is **"not worse"**, so overlapping intervals *satisfy* it —
an overlap is neither a loss nor a win. Warm npm cache throughout, stated rather than hidden: no
measurement in this programme, this one included, has ever timed a cold cache, which is where a new
developer actually stands.

| Journey | TheoKit, mean ± 1σ | Next.js, mean ± 1σ | Intervals | "Not worse"? |
| --- | --- | --- | --- | --- |
| J3 streaming | 10.53 ± 1.21 | 14.00 ± 1.45 | disjoint, TheoKit faster | **holds** |
| J4 thread | 9.70 ± 0.40 | 12.33 ± 0.38 | disjoint, TheoKit faster | **holds** |

**The standing generalisation does not survive the first pair, and it had already not survived J7.**
§ Sequencing concluded from J9 that "the same baseline gap applies to all ten" and that "until the
install cost is resolved, no journey can satisfy the winning rule's fourth clause, so no journey can
be won." That paragraph is left standing as the record of what was concluded from the only number
that existed. It is wrong, and the reason is protocol rather than framework: J9's TheoKit lane
re-resolved its entire dependency graph on every run while its Next.js lane installed from a lock.
With a lock on both sides, J3's install is level — 4.67 s against 4.47 s — against the 19.6 s against
4.2 s J9 recorded. **The install gap was mostly the handicap, not the tree.**

## Cross-references

- The obligation this satisfies: the program goal's second condition
- The ten criteria files, one per journey, written before either implementation exists — `docs/program/journeys/`:
  [J1 tool](journeys/j01-tool.md) ·
  [J2 HITL](journeys/j02-hitl.md) ·
  [J3 streaming](journeys/j03-streaming.md) ·
  [J4 thread](journeys/j04-thread.md) ·
  [J5 multi-step](journeys/j05-multi-step.md) ·
  [J6 retry](journeys/j06-retry.md) ·
  [J7 rate limit](journeys/j07-rate-limit.md) ·
  [J8 tenant](journeys/j08-tenant.md) ·
  [J9 observability](journeys/j09-observability.md) ·
  [J10 deploy](journeys/j10-deploy.md)
- J8's blocker, which § Sequencing above leaves unnamed, was measured and named in
  [its own criteria file](journeys/j08-tenant.md) — the framework has no tenant identity, so the
  journey had no subject. The hold was discharged on 2026-08-20 by building both sides by hand,
  which is what that file said the comparison would have to be; the framework still has no tenant
- The cross-tenant read J8's run reproduced is a security finding and lives in an advisory, not in an
  issue; its public source-level counterpart is #365
- The other instrument: `docs/program/northstar-app.md`
- Parity milestones that must land first: `ROADMAP.md` Wave 0.5 and Wave 1
- The decision J2 and J8 wait on: `docs/adr/0001-authorization-is-transport-independent.md`
- Blockers named above: #347 (wiring), #350 (build), GHSA-g94h-459g-rjhj (HITL authorization)
- Defects J3's measurement found and filed: #382 (the deploy shim buffers a stream whole), #383 (the
  agent SSE response sends no anti-buffering headers), #384 (a dropped run settles as `done`)
- The defect J6's measurement found and filed: #388 (a tool that throws reaches the caller as
  `isError: false` on a `done` run)
- Defects J2's measurement found and filed: #392 (`useAgent` exposes `approve(approvalId)` and no way
  to obtain the id), #393 (an expired approval is reported as a human denial), #394 (the
  `tool-approval-request` chunk carries only two ids). Its criterion-4 failure is a security finding
  and went to GHSA-g94h-459g-rjhj rather than to a public issue
- The defect J10's measurement found and filed: #402 (a container built from the documented path
  reports a healthy start and serves nobody; `theokit start` also never reads `PORT`). J10 also
  reproduced #401 (`registerProvider` mutates a registry the served path never reads) on a build from
  the worktree and on an existing provider name, and posted both facts to that issue
- The five defects J4's measurement found and filed: #395 (agent transcripts land in git), #396 (the
  pristine scaffold fails `tsc`), #397 (`create-theokit` reports a successful install as a failure),
  #398 (`.env.example` documents a variable nothing reads), #399 (a lost conversation is
  indistinguishable from a new one)
- The two defects J7's measurement found and filed: #400 (a `POST` with a JSON body to an `/api` file
  route hangs forever under `theokit start`, because the agent-aux branch drains the request stream
  for paths it does not own), #401 (`registerProvider` mutates a registry `theokit start` never
  reads — the provider registry is duplicated across two bundle chunks)
