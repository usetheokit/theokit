# J6 — Retry

The sixth of the ten benchmark journeys (`../dx-benchmark.md`). Criteria written before either
implementation exists; a journey whose criteria change after code exists is void and must be re-run
from scratch.

**Scheduling status:** not in the first batch. `../dx-benchmark.md` § Sequencing names J1, J3, J4,
J5, J7 and J9 for implementation after Wave 0.5, and holds J2 and J8. J6 and J10 are neither held
nor scheduled there; § Current state below records what J6 would need, and it is not a decision — it
is code.

## What the journey requires

Copied from `../dx-benchmark.md` § The ten journeys, unchanged. Rewording it requires an ADR,
because a movable target measures nothing.

| # | Journey | What must work |
| --- | --- | --- |
| J6 | **Retry** | A tool that fails transiently is retried with backoff; a permanent failure is not |

Three obligations, and the third is the one most systems fail: **a permanent failure is not
retried**. Retrying everything is easy and is not this journey; the journey is the *distinction*,
which means every criterion below is paired — one for the transient case, one for the permanent one.

## Acceptance criteria

In the shape `ROADMAP.md` uses: observable, with an oracle, graded by `/acceptance` against the
released artifact rather than the working tree (`.claude/rules/cycle-acceptance.md` § Target kinds).

**Definition of done (all must hold):**

- [ ] a tool whose body fails with a transient error on its first N attempts and succeeds on N+1 is
      invoked exactly N+1 times and the run succeeds — counted by an invocation counter inside the
      tool body, not by log lines
- [ ] a tool whose body fails with a permanent error is invoked **exactly once** and the run reports
      the failure — same counter, asserting the value 1, so "we retried and it kept failing" cannot
      be mistaken for "we did not retry"
- [ ] the delays between attempts increase: with at least three attempts recorded, each interval
      measured inside the tool body is strictly greater than the one before it, so a fixed-interval
      loop fails this criterion
- [ ] jitter is present rather than claimed: across at least five runs of the same transient
      scenario, the recorded first-retry delays are not all equal — a weak oracle, and the weakest
      one on this page, chosen because the alternative is asserting an implementation detail
- [ ] which errors are transient is a **declared** contract the application can read and extend, not
      a hidden list: a tool author can mark an error permanent and criterion 2 then holds for it,
      exercised with a custom error type the framework has never seen
- [ ] Applies to: Web, Tauri, TUI — each listed target is exercised in acceptance, not merely
      declared
- [ ] Tauri: the same retry behaviour over the in-process path, with the same invocation counter —
      retry must not be a property of the HTTP hop
- [ ] TUI: same in-process path, same counter

**What resisted an oracle, and it is the sharpest gap on this page.** Criterion 4 does not really
test jitter. Five runs producing five different delays is consistent with jitter and also with
scheduler noise, and no run count makes that distinction cheap. A statistical test over many runs
would be a stronger oracle and a worse criterion — it would dominate the journey's wall-clock metric
and measure the test harness. So the criterion is stated as the weak thing it is, labelled as such
here, and the report must not present it as proof of jitter.

## The Next.js side

**There is no direct equivalent, and the honest description is a partial one.** Next.js has no retry
primitive. The AI SDK has a retry count on its generate and stream calls, but that governs the
*model* request, not a tool body's own transient failure — which is what this journey is about.

So on the Next.js side the reference implementation is a wrapper the developer writes: a helper that
catches, classifies, waits and re-invokes, applied inside the tool's `execute`. It is written to win
— a compact, idiomatic helper, and the reviewer's job is to make it shorter
(`../dx-benchmark.md` § Why the protocol comes before the measurement). A well-known third-party
retry library may be used if that is the shorter honest answer, and if so it is named and its line
count is counted as a dependency concept rather than as free.

*To confirm at implementation time, because these are version-specific and this document is written
without access to that source:* whether the SDK's retry option has grown to cover tool execution,
and whether any official example demonstrates tool-level retry rather than request-level retry.

**And the same is true on our side, which makes this journey unusual: neither side has a primitive.**
That is a benchmark datum. It also means J6 is the journey most likely to end in a **tie**, and a tie
must be reported as a tie (`../dx-benchmark.md` § What counts as winning).

## How the four metrics are counted here

The general counting rule is in `../dx-benchmark.md` § The four metrics. What follows is that rule
landed on this journey.

**Files touched.** Counted: the tool that gains retry behaviour, any helper or wrapper written to
provide it, the error type that marks a failure permanent, and any configuration that declares the
policy. Not counted: the failing dependency being simulated — the fake that fails N times is test
scaffolding, and both sides get one.

**Glue lines.** The classification policy — which errors are transient — is business logic, because
it encodes a real decision about the dependency. Everything else is glue: the loop, the wait, the
attempt counter, the wiring into the tool body. If a side gets the loop from a library, the import
counts as a concept and the lines it saves are counted as saved.

**Concepts required.** Derived mechanically from the imports and APIs the diff uses. Expected on
both sides: an error taxonomy, a backoff schedule, an attempt ceiling, and the place where the
retry wraps. The framework's own retriable-error convention counts as a concept on our side — the
codebase already carries one, and § Current state records where.

**Time to first green run.** Wall clock from `npx create-theokit` to the first run where all five
assertions pass. Cold cache, at least three runs, mean and standard deviation. The backoff delays
themselves are inside the wall clock and are configured small for the measurement; the configured
values are recorded so the number is comparable across sides.

## The deliberately broken state

Per `../dx-benchmark.md` § The fifth, which is pass/fail and not a number. The break for J6 is
**retry applied to a permanent failure** — the misconfiguration that turns one bad call into many,
and the one whose bad error message costs real money.

| | |
| --- | --- |
| Names the action | `tool "chargeCard" failed 3 times with a non-retryable error (INVALID_CARD); attempts 2 and 3 were charged against your rate budget for nothing. Mark this error class non-retryable, or narrow the retry predicate.` — names the tool, the count, the error class, the cost, and the fix |
| Does not name the action | The same error text repeated three times with no indication that it was the same call, or a single final error that hides the fact that three attempts happened |

The repeated-identical-error case is the interesting failure and it is graded **fail**: the
information the developer needs is not in the message but in the *multiplicity*, and a system that
prints the third failure as if it were the first has withheld the only clue.

A second break is graded in the same transcript: **a retry that never terminates**. Names the
action: `tool "fetchQuote" exhausted 5 attempts over 31s; the last error was ETIMEDOUT. Raise maxAttempts, or treat ETIMEDOUT as permanent for this tool.`
Does not: a run that hangs until an unrelated timeout kills it, with no mention of retries at all.

## Current state and blockers

Measured against the working tree on 2026-08-20; every claim is read from source.

**The blocker is that a tool author has no retry facility at all — the framework has retry in four
places and none of them is reachable from a tool body.**

What a tool body actually receives is `{ signal, context, messages, threadId }`
(`packages/theo/src/server/define/define-agent-tool.ts:37`). No attempt counter, no backoff helper,
no policy hook. The SDK's retry surface is re-exported wholesale from the agents package
(`packages/agents/src/index.ts:202`), so a tool author *can* import it and hand-roll a wrapper —
which is exactly the Next.js-side cost described above, paid on our side too.

Where retry does exist, and why none of it helps this journey:

- **Credential refresh** is the one complete implementation: exponential backoff with jitter
  (`packages/agents/src/auth/auth-provider.ts:91`), an explicit transient/permanent classifier
  (`:74`), and a three-attempt ceiling (`:173`). It is the house style criterion 3 and 5 should be
  measured against — and it governs OAuth refresh, not tools.
- **The reflective loop** can take a retry policy per round
  (`packages/agents/src/loop/run-reflective-loop.ts:382`), but it is opt-in and, per J5's
  measurement, that loop is not on the served-agent path at all.
- **Jobs** classify permanent failures properly — unknown job, schema failure, and an explicit
  non-retryable error class (`packages/theo/src/server/jobs/job-runner.ts:99`, class at
  `packages/theo/src/server/jobs/job-backend.ts:62`) — but they have **no backoff**: a nack releases
  the lock and the next dequeue picks it up immediately, and the module states that the backoff loop
  is outside its scope (`packages/theo/src/server/jobs/job-runner.ts:19`). The default attempt count
  is one (`packages/theo/src/server/jobs/define-job.ts:45`), so out of the box nothing is retried.
- **Webhooks, realtime and the HTTP client have none.** The client transport throws on a non-ok
  response (`packages/agents/src/client/http-transport.ts:95`).

**There is no circuit breaker anywhere in either source package.** That is not required by this
journey and is recorded because the error-handling rule names it as the companion to retry
(`.claude/rules/error-handling.md` § 3), and a benchmark that measured retry while quietly ignoring
its absence would be reporting half a mechanism.

**One good foundation does exist**: errors carry an explicit retriable flag rather than defaulting to
one, and the flag is declared per class with a stated reason — the cost-budget error is
non-retryable *because the budget does not refill on retry*
(`packages/agents/src/guardrails/types.ts:87`). Criterion 5's "declared contract the application can
read and extend" has something real to build on.

**Not measured:** what the SDK's own retry implementation does — whether its backoff is exponential
and how it classifies transience. It lives outside the two source packages, is loaded dynamically
(`packages/agents/src/loop/run-reflective-loop.ts:382`), and was not read. The criteria are written
so that this does not need to be known in advance: they grade observed behaviour, not the
implementation that produced it.

## Cross-references

- The benchmark this journey belongs to: `../dx-benchmark.md`
- The journey whose tool this retries: `j01-tool.md`
- The journey whose budget refusal must **not** be retried: `j07-rate-limit.md`
- Fail-fast and typed-error discipline the criteria assume: `../../../.claude/rules/error-handling.md`
- Acceptance contract that grades these criteria: `../../../.claude/rules/cycle-acceptance.md`
- Criterion shape these follow: `../../../ROADMAP.md` § Wave 1
