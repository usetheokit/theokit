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
- **J2 (HITL) is under an open security advisory.** Unchanged. Measuring the DX of a path whose
  authorization is being redesigned would measure something about to change.
- **J10 (deploy) depends on #350** — the build does not survive its own parallel invocation. The fix
  is merged into `develop` and the issue is still open, so this line stays until the issue is
  verified closed rather than until someone remembers it was fixed.

So the honest order is: define the criteria for all ten now (this document plus ten criteria files),
implement and measure J1, J3, J4, J5, J7, **J9** after Wave 0.5 wires what exists, and hold J2 until
the authorization ADR lands and J8 until its own blocker is named.

**J1 has both sides now, and it is a tie — measured 2026-08-20.** It is the first real contrast this
document has, and it does not go our way: TheoKit touches *more* files than the best idiomatic
Next.js equivalent (3 against 2, the third being a deletion its own scaffold forces), and its wins on
glue lines (8 against 14) and concepts (5 against 6) are 1.75x and 1.2x — both inside the 2x bar
§ What counts as winning sets. A single declared counting decision moves four of the six glue lines,
and moves them the wrong way. The full measurement, the confirmed AI SDK version facts, the chosen
baseline and the published diffs are in [J1's criteria file](journeys/j01-tool.md). One journey is
not the benchmark, and a tie on the simplest of the ten is the kind of early number this protocol
exists to make visible rather than to absorb.

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
