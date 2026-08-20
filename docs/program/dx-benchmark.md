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
- **J10 (deploy) depends on #350** — the build does not survive its own parallel invocation. The fix
  is merged into `develop` and the issue is still open, so this line stays until the issue is
  verified closed rather than until someone remembers it was fixed.

So the honest order is: define the criteria for all ten now (this document plus ten criteria files),
implement and measure J1, J3, J4, J5, J7, **J9** after Wave 0.5 wires what exists, and hold J8 until
its own blocker is named. J2's hold expired for the reason above — the authorization did not change
under it, so waiting longer would have withheld a result rather than protected one.

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

**Six journeys measured, three ties, one loss, one unresolved and one metric sweep — and the framework
has not won a journey.** The goal states "win all ten by a margin outside noise". Six of ten are in,
and the two that produced the largest margins are the two that most clearly did not win. J5's re-measurement
could not change that sentence because shipping the missing capability moved a criterion, not a
margin. J3 and J9 could not change it for opposite reasons: J3's margins price six lines whose
trigger never fires, and J9's margins are real while the criteria they were meant to serve stay
unsatisfied. A journey is won by costing less to build *the thing the criteria describe*; costing
less to build something short of it is a different sentence, and this document will keep them apart.

**One thing this re-measurement should not be read as.** J9 being unblocked means it can be scored;
it does not mean it will score well. A journey that is newly possible and a journey that is
comfortable are different claims, and the second is exactly what the benchmark exists to test rather
than to assume.

Reporting a partial run as the benchmark is forbidden. Ten journeys or a stated subset with the reason — never a subset presented as the whole.

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
- J8's blocker, which § Sequencing above leaves unnamed, is measured and named in
  [its own criteria file](journeys/j08-tenant.md) — the framework has no tenant identity, so the
  journey currently has no subject
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
