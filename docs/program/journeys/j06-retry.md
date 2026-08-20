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

## Measured - TheoKit side, metrics 1-3 (2026-08-20)

> **Superseded the same day, and kept.** This section measured one lane from a diff, on the scaffold's
> `weather` tool, and exercised none of the criteria. § Measured — both sides builds the second lane,
> re-measures this one on a baseline symmetric with it, and runs all five criteria. Two of the
> paragraphs below are corrected there rather than edited here; the section stays because it is the
> record of what was true before either lane had been run.

**Three of four metrics, one side, and the tie this page predicted is not the one the diff shows.**
§ The Next.js side predicts a tie on the ground that *neither* side has a primitive. On this side
that premise is false: `Retry.create` is re-exported from `@theokit/agents`
(`packages/agents/src/index.ts:202`), reaches a scaffolded application unchanged, and carries the
loop, the wait, the attempt ceiling and the predicate seam. What the developer still writes is the
error taxonomy, which the counting rule calls business logic and which both sides pay. What the
measurement cannot say is whether the *outcome* is a tie, because the other lane is empty. Metric 4 and the whole Next.js side are
unmeasured, and the subsection below says why.

Obtained from a real diff, not an estimate: the scaffold template was copied verbatim, committed as
an untouched baseline, and the journey implemented on top. The counts are `git diff --numstat` over
that commit.

**A correction to this page's own § Current state, recorded rather than quietly relied on.** That
section reads the same re-export as something a tool author can use to "hand-roll a wrapper - which
is exactly the Next.js-side cost, paid on our side too". It is not a wrapper: `Retry.create(fn,
options)` runs `fn` with exponential backoff, an injectable predicate, an attempt ceiling and an
injectable random source. The hand-rolling that remains on our side is the classification policy,
which the counting rule calls business logic and which both sides must write anyway.

| Metric | TheoKit | How it was counted |
| --- | --- | --- |
| Files touched | **2** | `agents/lib/retry-policy.ts` added, `agents/tools/weather.ts` edited. The simulated failing dependency is excluded by the rule above and was not written |
| Glue lines | **15** | of 50 added lines; 24 are business logic, 4 are comments and 7 are blank |
| Concepts required | **6** | `Retry.create`, the `retries` / `initialDelayMs` schedule, the `rng` option and the full-jitter default it overrides, the `isRetryable` seam, `isTransientError`, and the `agents/lib/` semantic folder |
| Time to first green run | **not measured** | needs a live model call; see below |

**The 50 added lines, classified.** Published because the glue split is the metric most open to being
argued after the fact, and a table nobody can check is not evidence - least of all one published by
the side it favours.

In `agents/lib/retry-policy.ts`, 35 lines. Glue (7): the `isTransientError` import, and the six lines
of the `TOOL_RETRY` object - its declaration, `retries`, `initialDelayMs`, `isRetryable`, `rng` and
the closing brace, which are the attempt ceiling and the backoff schedule the rule names as glue.
Business logic (18): the three lines of `PermanentToolError`, the three of `TransientToolError`, the
`RETRYABLE_STATUS` set, the six of `classifyHttpFailure` and the five of `isRetryableToolFailure` -
together, the declaration of which failures are worth another attempt. Comments (4). Blank (6).

In `agents/tools/weather.ts`, 15 lines. Glue (8): the two imports, and, in each of the two retried
blocks, `const geoRes = await Retry.create(async () => {` / `const wxRes = await Retry.create(async
() => {`, `return res` and `}, TOOL_RETRY)`. Business logic (6): in each block, the `fetch` call and
the line that turns a non-ok status into one of the two classes, plus the two `PermanentToolError`
throws for a place that does not exist and a forecast that is absent. Blank (1).

**The `rng` override is the interesting line, and it is there because criterion 3 and the shipped
default disagree.** The SDK computes each wait as `floor(rng() * ceiling)` - full jitter, a uniform
draw over the whole interval - so two consecutive waits can come out in the wrong order and
criterion 3 ("each interval strictly greater than the one before") fails at random rather than never.
Drawing from the top quarter instead keeps criterion 4's jitter and makes every wait strictly longer
than the last, because the smallest draw at attempt *n+1* is 1.5x the largest at *n*. That
implementation was read from the installed `@theokit/sdk` 4.52.1, which lives outside this
repository and therefore carries no `file:line` here; the house style this repository does own
computes its backoff the narrowed way (`packages/agents/src/auth/auth-provider.ts:91`).

**Four judgement calls, stated rather than buried.**

1. **The retry wraps the dependency call, not the tool body - and criterion 1's oracle does not say
   which of those it means.** The criterion counts invocations "inside the tool body". With the retry
   around the HTTP call, a counter placed in the retried closure reads N+1 and a counter placed at
   the top of `.execute` reads 1. Both are "inside the tool body". Nothing on either side re-invokes
   a *tool* - the AI SDK's retry option governs the model request - so the second reading is
   unsatisfiable by both stacks, and this measurement takes the first. The ambiguity is reported
   here rather than resolved by rewording the criterion, which would void the journey. Deciding the
   other way was measured rather than guessed: wrapping the whole body costs the same 2 files and 62
   added lines instead of 50, 12 of the extra being re-indentation of code that did not change.
2. **The two error classes were counted as business logic.** The rule calls the classification policy
   business logic and type ceremony glue, and a class whose entire content is its identity sits on
   the line between them. Counting their six lines as ceremony moves the split from 15/24 to 21/18
   and does not change the shape of the result.
3. **The `agents/lib/` folder was counted as a concept**, on J1's precedent that a folder the agent
   scanner treats specially is a name the reader must know. Not counting it gives 5.
4. **The failing dependency was not written at all.** The rule excludes it from the count on both
   sides; writing it and excluding it produces the same number, and nothing was executed either way.

### What is still unmeasured, and why

**Metric 4 (time to first green run) needs a live model call**, at least three times, cold cache.
That spends real credits, and the number is only meaningful measured identically on both sides - so
running one side alone would produce a figure with nothing to compare it to.

**The Next.js side does not exist yet.** Until it does, nothing here is a comparison, and the winning
rule cannot be applied. On this journey the absence is sharper than elsewhere: the page predicted a
tie from a premise about *both* sides, and only one of them has now been read.

**None of the five criteria were exercised.** No run was performed: no transient failure was
injected, no invocation counter was read, no interval was timed. What the diff establishes is what
the code says, and the argument above about strictly increasing intervals is arithmetic over the
SDK's formula rather than an observation of five runs.

**What the SDK's retry does under a real failure is read from the installed package, not from
source in this repository.** The classifier it falls back to (`isTransientError`) was not read at
all; the measured implementation shadows it for the two classes it declares and defers to it for
everything else, so a wrong answer there is invisible to this diff.

**Criterion 4 remains the weak oracle this page already labelled it.** Nothing in this measurement
strengthens it, and a passing run would still be consistent with scheduler noise.

**The three-target criteria cannot be exercised in this repository.** The Tauri and TUI lines need
`@theokit/tui` and `@theokit/ui`, which live outside it (`.claude/rules/three-target-parity.md`
records the same limit). What settles them is the north-star app
(`.claude/rules/northstar-app.md`), which does not exist yet.

**So: J6 is not won, not tied, and not run.** The tie this page predicted is not confirmed and not
refuted - its stated premise is refuted, and the outcome it predicted remains open until a second
lane exists.

## Measured — both sides, metrics 1-3, and the five criteria exercised (2026-08-20)

**The second measurement of this journey, and the first with two lanes and a run.** The section above
measured one side from a diff and stated plainly that "none of the five criteria were exercised". This
one builds the missing lane, re-measures ours on a baseline symmetric with it, and then does the thing
neither lane had done: it **runs** the criteria, on both sides, against a scripted model and a
dependency that really fails.

Everything above is left as written. It records what was true when it was written, and two of its own
paragraphs are corrected here rather than edited there.

**The result is a tie on the three countable metrics, and TheoKit is the worse side on one of them.**
Criteria: 4 of 5 against 5 of 5. The criterion we lose is the second half of criterion 2 — *the run
reports the failure* — and it is lost to a defect the run exposed and a diff never could: a tool that
throws, including one that throws after exhausting every retry, reaches the caller as a **successful**
tool result on a run that ends `done`. Filed as
[#388](https://github.com/usetheokit/theokit/issues/388).

### Versions and commits under test

| Side | Under test |
| --- | --- |
| TheoKit | worktree at `c13117080` on `workspace`; `@theokit/agents` 10.1.0, `@theokit/sdk` 4.52.1 (real, not mocked), `zod` 4.4.3, Node 22.22.2. The measured tool file was additionally typechecked under `strict` against the **published** `theokit@0.48.14` + `@theokit/agents@10.1.0`, which is what a scaffolded app installs |
| Next.js | `next@16.3.1`, `ai@7.0.70`, `@ai-sdk/react@4.0.73`, `zod@4.4.3`, `p-retry@8.0.0`, Node 22.22.2. `next build` compiles and typechecks the route |

### The two version-specific facts, confirmed against the source

§ The Next.js side deferred two questions to implementation time. Both were read rather than
remembered, and neither diverged from what the section supposed — which is itself worth recording,
because three of the four earlier measurements did find a divergence.

| Deferred question | Answer | Read from | Diverged? |
| --- | --- | --- | --- |
| Whether the SDK's retry option has grown to cover tool execution | **No.** `maxRetries` lives on `RequestOptions`, whose own declaration says it governs "how the request is sent … not model generation behavior", and it defaults to 2 | the installed `ai@7.0.70` type declarations | No |
| Whether any official example demonstrates tool-level retry rather than request-level retry | **No.** The official tool-calling page documents no retry for a tool body at all. What it documents instead is the opposite move: an error thrown by `execute` is added "as `tool-error` content parts to enable automated LLM roundtrips in multi-step scenarios" | `https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling`, fetched | No — and the absence is the finding. The vendor's answer to a failing tool is to make the failure **legible**, to the model and to the client, rather than to retry it |

The second row is the one that decides this journey's criteria, and it was not predictable from the
question that produced it.

### Two corrections to this page, recorded rather than quietly relied on

**§ The Next.js side predicted a tie on the premise that neither side has a primitive. The premise is
false on both sides now.** The section above already refuted it for ours (`Retry.create` is
re-exported at `packages/agents/src/index.ts:202` and reaches a scaffolded app unchanged). It is
equally false for theirs: `p-retry` is a mature, single-purpose library whose own README example is
this journey — `fetch`, `throw new AbortError(response.statusText)` on a 404, retry otherwise. Both
sides get the loop from something they did not write. The tie the section predicted did arrive, and
not for the reason it gave.

**The section above supposed criterion 5 needed a hand-written classifier. It does not.** That
measurement wrote `isRetryableToolFailure` and passed it as `isRetryable`. The SDK's *default*
predicate is `isTransientError`, which is `err instanceof TheokitAgentError && err.isRetryable === true`
— so an error class that extends `TheokitAgentError` and declares `isRetryable` is honoured with no
predicate configured, and a plain `Error` is never retried. Criterion 5's "declared contract the
application can read and extend" is a contract the framework already ships. This measurement uses it,
which is why its diff is shorter in the place that matters and why it charges no predicate line.

### The baselines, declared

The same three-commit ladder on both sides, for the reason J5 fixed: a journey measured from a bare
scaffold re-counts work another journey already counted.

| Step | TheoKit | Next.js |
| --- | --- | --- |
| 1 | `create-theokit` default template, copied verbatim, committed untouched | `create-next-app` (TypeScript, App Router, Tailwind) + `npm install ai @ai-sdk/react zod`, untouched |
| 2 | — | the AI SDK Next.js App Router quickstart's pre-tools chat stage, pasted verbatim, reformatted with the `create-theokit` Prettier config. J1's declared baseline, not re-litigated |
| 3 | J1's own diff: `agents/tools/order-lookup.ts` added, `agents/chat.ts` edited, `agents/tools/weather.ts` deleted. **Uncounted.** Reconstructed from J1's published classification, and it reproduces J1's numbers exactly — 3 files, 15 added lines, 8 glue, 5 logic, 2 blank | J1's own diff, the same commit the J5 measurement laddered from. **Uncounted** |

J6 is the delta from step 3 on each side. **One formatting control**, unchanged from J1: both diffs
are formatted with the `create-theokit` Prettier config
(`packages/create-theokit/templates/default/.prettierrc`, `printWidth: 100`, `semi: false`), so both
sides are counted with one ruler.

**The subject is J1's `orderLookup` tool on both sides**, changed from an in-memory table lookup to a
call against an order service that fails on script. That is a departure from the section above, which
applied retry to the scaffold's `weather` tool — a tool the Next.js baseline has no counterpart for.
Charging one side for retrofitting two `fetch` call sites and the other for retrofitting one would
have measured the scaffolds, not the retry.

**The failing dependency is excluded on both sides**, by this page's own rule ("the fake that fails N
times is test scaffolding, and both sides get one"). It is a local HTTP service, byte-identical in
both apps: 503 while its transient-failure budget lasts, 404 for an unknown order, 200 with the
shipping reference otherwise. 48 lines, uncounted twice.

### Metrics 1-3

| Metric | TheoKit | Next.js + AI SDK | How it was counted |
| --- | --- | --- | --- |
| Files touched | **1** | **1** | ours `agents/tools/order-lookup.ts` edited; theirs `app/api/chat/route.ts` edited. No client file on either side — J1 already wrote the `case 'tool-orderLookup':` branch, and a new tool renders through our shared presenter without a client change |
| Glue lines | 10 | **9** | of 33 added lines against 29; 16 and 13 are business logic, 2 and 2 are comments, 5 and 5 are blank |
| Concepts required | **5** | **5** | derived from the imports and APIs each diff uses; listed below |
| Time to first green run | not measured | not measured | needs a live model call, three times, cold cache, on both sides; see below |

### The two diffs, published

The reason J1 fixed: the glue split is the metric most open to being argued after the fact, and a
table nobody can check is not evidence — least of all one published by the side it favours.

TheoKit, `git diff` between the J1 commit and the J6 commit, verbatim:

```diff
diff --git a/agents/tools/order-lookup.ts b/agents/tools/order-lookup.ts
@@ -1,13 +1,42 @@
+import { Retry, TheokitAgentError, type RetryOptions } from '@theokit/agents'
 import { tool } from 'theokit/server/define'
 import { z } from 'zod'

-const SHIPPING_REFERENCES: Record<string, string> = {
-  'A-1001': 'SHIP-7F3K-2210',
-  'A-1002': 'SHIP-9Q4M-8871',
+const ORDER_SERVICE = process.env.ORDER_SERVICE_URL ?? 'http://localhost:4310'
+
+/** Worth another attempt. `isRetryable` is the flag the framework's default predicate reads. */
+class TransientOrderError extends TheokitAgentError {
+  constructor(message: string) {
+    super(message, { isRetryable: true, code: 'order_service_transient' })
+  }
+}
+
+/** No number of attempts will fix it — a plain Error is never retryable. */
+class PermanentOrderError extends Error {}
+
+const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504])
+
+function classifyOrderFailure(status: number, orderId: string): Error {
+  const what = `order service returned ${status} for "${orderId}"`
+  return RETRYABLE_STATUS.has(status)
+    ? new TransientOrderError(what)
+    : new PermanentOrderError(what)
+}
+
+const TOOL_RETRY: RetryOptions = {
+  retries: 3,
+  initialDelayMs: 50,
+  rng: () => 0.75 + Math.random() / 4,
 }

 export const orderLookupTool = tool('order_lookup')
   .describe('Look up the shipping reference for an order id.')
   .input(z.object({ orderId: z.string().describe('The order id, e.g. "A-1001"') }))
-  .execute(async ({ orderId }) => SHIPPING_REFERENCES[orderId] ?? `No order ${orderId}.`)
+  .execute(async ({ orderId }) =>
+    Retry.create(async () => {
+      const res = await fetch(`${ORDER_SERVICE}/orders/${orderId}`)
+      if (!res.ok) throw classifyOrderFailure(res.status, orderId)
+      return await res.text()
+    }, TOOL_RETRY),
+  )
   .build()
```

Next.js, `git diff` between the J1 commit and the J6 commit, verbatim (the `p-retry` install is a
separate, uncounted commit — see judgement 3):

```diff
diff --git a/app/api/chat/route.ts b/app/api/chat/route.ts
@@ -7,11 +7,29 @@ import {
   createUIMessageStreamResponse,
   toUIMessageStream,
 } from 'ai'
+import pRetry, { type Options } from 'p-retry'
 import { z } from 'zod'

-const SHIPPING_REFERENCES: Record<string, string> = {
-  'A-1001': 'SHIP-7F3K-2210',
-  'A-1002': 'SHIP-9Q4M-8871',
+const ORDER_SERVICE = process.env.ORDER_SERVICE_URL ?? 'http://localhost:4310'
+
+/** Worth another attempt. */
+class TransientOrderError extends Error {}
+
+/** No number of attempts will fix it. */
+class PermanentOrderError extends Error {}
+
+const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504])
+
+function classifyOrderFailure(status: number, orderId: string): Error {
+  const what = `order service returned ${status} for "${orderId}"`
+  return RETRYABLE_STATUS.has(status)
+    ? new TransientOrderError(what)
+    : new PermanentOrderError(what)
+}
+
+const TOOL_RETRY: Options = {
+  retries: 3,
+  minTimeout: 50,
+  randomize: true,
+  shouldRetry: ({ error }) => error instanceof TransientOrderError,
 }

 export async function POST(req: Request) {
@@ -25,7 +43,12 @@ export async function POST(req: Request) {
         inputSchema: z.object({
           orderId: z.string().describe('The order id, e.g. "A-1001"'),
         }),
-        execute: async ({ orderId }) => SHIPPING_REFERENCES[orderId] ?? `No order ${orderId}.`,
+        execute: async ({ orderId }) =>
+          pRetry(async () => {
+            const res = await fetch(`${ORDER_SERVICE}/orders/${orderId}`)
+            if (!res.ok) throw classifyOrderFailure(res.status, orderId)
+            return await res.text()
+          }, TOOL_RETRY),
       }),
     },
   })
```

### The added lines, classified

| Class | TheoKit (33) | Next.js (29) |
| --- | --- | --- |
| **Glue** | **10** — the `@theokit/agents` import; `const ORDER_SERVICE`; the five lines of `TOOL_RETRY` minus its `}` (which the diff reuses from the deleted table); `.execute(async ({ orderId }) =>`; `Retry.create(async () => {`; `}, TOOL_RETRY),`; the closing `)` | **9** — the `p-retry` import; `const ORDER_SERVICE`; four lines of `TOOL_RETRY` (declaration, `retries`, `minTimeout`, `randomize`); `execute: async ({ orderId }) =>`; `pRetry(async () => {`; `}, TOOL_RETRY),` |
| **Business logic** | **16** — the five lines of `TransientOrderError`, the one of `PermanentOrderError`, `RETRYABLE_STATUS`, the six of `classifyOrderFailure`, the `fetch`, the classify-and-throw, and the `return await res.text()` | **13** — the same, with the two error classes costing one line each instead of six, plus the `shouldRetry` predicate |
| Comments | 2 | 2 |
| Blank | 5 | 5 |

**The three-line logic gap is the price of the framework's own contract, and it is worth naming.**
`TransientOrderError extends TheokitAgentError` needs a constructor that calls `super` with
`{ isRetryable: true }` — five lines where a bare `class X extends Error {}` is one. What those four
lines buy is that no predicate has to be configured: the framework's default classifier reads the
flag. The other side spends its four lines back on `shouldRetry`. The two designs cost almost exactly
the same and put the cost in different columns.

### The concepts, derived from the diffs

Five each, and they are not the same five — which is the most interesting thing the concept count says
on this journey.

| # | TheoKit | Next.js + AI SDK |
| --- | --- | --- |
| 1 | `Retry.create` — and that it is an executor, not a constructor | `pRetry` — the default export that runs a function |
| 2 | the schedule: `retries`, `initialDelayMs`, and the `backoffMultiplier: 2` default neither diff writes | the schedule: `retries`, `minTimeout`, and the `factor: 2` default neither diff writes |
| 3 | the `rng` option, and the full-jitter default it narrows | `randomize`, and the no-jitter default it turns on |
| 4 | `TheokitAgentError` and its `isRetryable` flag — the framework's declared transience contract | `Options.shouldRetry` — the predicate seam the application must fill because there is no such contract |
| 5 | `isTransientError`, the default predicate. It appears nowhere in the diff and is load-bearing: it is the only reason `PermanentOrderError extends Error` is not retried | the `p-retry` dependency itself, charged as a concept by this page's own rule ("the import counts as a concept and the lines it saves are counted as saved") |

Row 4 and row 5 are where the two stacks actually differ. Ours ships a transience contract and charges
the reader for knowing that a plain `Error` is outside it; theirs ships no contract and charges the
application for writing the predicate. Neither is free and the totals are equal.

### The instrument, and why this journey could be run without credits

Every earlier measurement in this programme stopped at "no gateway key was available". This one did
not, and the reason is reusable.

**The model.** `@theokit/sdk` 4.52.1 ships an `ollama` provider profile with `authType: "none"` and
`baseUrl: "http://localhost:11434"`, speaking Ollama's own `POST /api/chat` NDJSON protocol. A
70-line local server on that port, scripted to emit one `tool_calls` chunk on the first turn and a
short final answer afterwards, is a complete model as far as the framework is concerned. Runs go
through the real `createSdkAgentStream` and the real `streamAgentUIMessages` — the entry point
`mountAgent` calls — with the real SDK loaded. No key, no credits, no mocked framework.

**The other side** uses the AI SDK's own `MockLanguageModelV4` driven by `simulateReadableStream`,
scripted to the same shape, consumed through `toUIMessageStream` — the exact call the measured route
makes.

**The dependency** is the local HTTP order service described above, byte-identical for both.

**The counter criterion 1 asks for** lives in the probe, not in the measured diff. Both probes
reproduce the measured `.execute` body verbatim and add one line that records a timestamp inside the
retried closure. That line is instrument on both sides and is counted on neither.

**One correction to the instrument, which is a finding about a sibling journey.** J3's mock-model
fixture passes `finishReason: 'stop'` as a plain string. In `ai@7.0.70` the V4 stream's finish part
carries `finishReason: { unified, raw }`, and the SDK gates tool execution on
`chunk.finishReason.unified`. With the string form the value is `undefined`, no `model-call-end` is
emitted, and **no tool ever executes** — the run ends after `tool-input-available` with
`toolExecutionMs: {}`. J3's own measurement is unaffected (it streamed text and never called a tool),
but the fixture cannot be reused for a tool journey as written. This measurement is the first in the
programme where the Next.js tool body actually ran.

### The five criteria, graded against the runs

Three runs per row, same machine. The backoff was configured small for the measurement and the
configured values are recorded, per this page's own rule: `retries: 3` and a 50 ms base on both sides.

| # | Criterion | TheoKit | Next.js + AI SDK |
| --- | --- | --- | --- |
| 1 | transient on the first N attempts, success on N+1, invoked exactly N+1 times, run succeeds | **PASS** — 2 scripted 503s, **3 attempts**, `tool_result` carries `SHIP-7F3K-2210`, terminal `done` | **PASS** — 2 scripted 503s, **3 attempts**, `tool-output-available` carries `SHIP-7F3K-2210`, run finishes |
| 2 | permanent failure invoked **exactly once** and **the run reports the failure** | **FAIL, on the second half.** 404 on an unknown order, **1 attempt** — the counter reads exactly 1, so the first half holds. The wire then says `{"type":"tool-output-available","output":"[stderr]\\norder service returned 404 …"}` and the run ends `done`. The failure is *in* the payload and *absent* from the contract ([#388](https://github.com/usetheokit/theokit/issues/388)) | **PASS** — **1 attempt**, and the wire says `{"type":"tool-output-error","toolCallId":"call_1","errorText":"An error occurred."}` |
| 3 | with ≥ 3 attempts recorded, each interval strictly greater than the one before | **PASS** — 4 attempts, gaps **50, 81, 180 ms**. Achieved with the `rng` override; see below for what the shipped default does | **PASS** — 4 attempts, gaps **77, 167, 394 ms**. Achieved with `randomize: true`; the default `randomize: false` also passes this one and fails criterion 4 |
| 4 | across ≥ 5 runs of the same transient scenario, the first-retry delays are not all equal | **PASS** — 47, 45, 47, 48, 42 ms; 4 distinct of 5. **The weak oracle this page labelled as such**, and nothing here strengthens it | **PASS** — 54, 61, 81, 63, 54 ms; 4 distinct of 5. Same caveat |
| 5 | transience is a declared contract the application can read and extend; a tool author can mark an error permanent and criterion 2 then holds for it, with a custom type the framework has never seen | **PASS** — `class NeverSeenBefore extends Error {}`, thrown inside `Retry.create` with the shipped default predicate: **1 attempt**, and the rejection preserves the type (`rejectedWith: "NeverSeenBefore"`). Nothing was configured to make this happen | **PASS** — the same custom class under `shouldRetry`: **1 attempt**, type preserved. The predicate is the application's, which is the difference |
| 6-8 | Web, Tauri, TUI | **not exercisable here** — `@theokit/tui` and `@theokit/ui` live outside this repository (`.claude/rules/three-target-parity.md` records the same limit) | **not applicable** — a route handler serves one target |

**Criteria satisfied: 4 of 5 against 5 of 5.**

**Criterion 3 deserves the note the section above already wrote, now confirmed by a run.** The SDK
computes each wait as `floor(rng() * ceiling)` — full jitter, a uniform draw over the whole interval —
so two consecutive waits can come out in the wrong order and criterion 3 fails *at random* rather than
never. Narrowing the draw to the top quarter keeps criterion 4's jitter and makes every wait strictly
longer than the last, because the smallest draw at attempt *n+1* is 1.5x the largest at *n*. The house
style this repository owns does the equivalent by centring rather than multiplying —
`base * (0.75 + random() * 0.5)`, ±25% around the exponential
(`packages/agents/src/auth/auth-provider.ts:91`). One line of application code reconciles the
framework's shipped default with the framework's own house style, and it is charged as a glue line and
a concept above.

### The retry that exhausts, and what the caller is told

This is the part of J6 a diff cannot answer, and it is where the two sides separate.

Same scenario on both: the dependency fails transiently forever, `retries: 3`, so the handler is
invoked **4 times** and the last error propagates out of the retry. Both sides were then read on the
**same wire** — the UIMessage protocol both speak, part vocabulary and all.

| | TheoKit | Next.js + AI SDK |
| --- | --- | --- |
| Attempts | 4 | 4 |
| The tool part on the wire | `{"type":"tool-output-available","toolCallId":"call-43dc…","output":"[stderr]\\norder service returned 503 for \"A-1001\""}` | `{"type":"tool-output-error","toolCallId":"call_1","errorText":"An error occurred.","dynamic":false}` |
| Terminal frame | `finish`, with usage and duration | `finish` |
| Is the outcome legible? | **No.** The success part type, carrying the failure text | **Yes**, as a type. **No**, as a reason — the message is masked |

**A retry that exhausts and reports success is the fourth instance of a defect family this repository
found in one day** — after #379 (a step ceiling that cut a run and reported `done`, fixed), #384 (a
dropped stream that settled as `done`, fixed) and #382 (the deploy shim reporting success without
having streamed, open). The shape is identical: abnormal termination is indistinguishable from normal
termination, and in every case the framework held the information and did not surface it.

Read from source, and confirmed by teeing the real SDK's event stream: the SDK hands the framework
`result: { stdout: "", stderr: "order service returned 404 …", exitCode: 1 }` on the message-shaped
event. `translateToolCallEvent` branches on `status === 'completed'` and sets `isError: false`
(`packages/agents/src/bridge/event-translator.ts:95`) without reading `exitCode`. The delta-shaped
event, which structurally cannot carry an error, also sets `isError: false` (`:278`) — and it is the
one that survives, because `dedupeTools` keys on `callId` and the delta arrives first
(`packages/agents/src/bridge/sdk-timeline.ts:95`). **The event carrying the exit code is dropped as a
duplicate of the event that cannot carry it.**

**The whole downstream path is already built.** `packages/presenter/src/presenters/ui-message-stream.ts:185`
emits `tool-output-error` when `isError` is true and `tool-output-available` when it is false; the wire
schema declares the part, the reader handles it, and a test covers it. The branch simply never runs on
a served agent. `isError` is on the contract (`packages/agents/src/bridge/agent-stream-events.ts:42`)
and forwarded faithfully (`packages/agents/src/bridge/present-ui-message-stream.ts:33`). One boolean,
computed wrongly at one place, is the whole distance between 4 of 5 and 5 of 5 on this journey.

**The other side's legibility gap is real and smaller.** `errorText: "An error occurred."` is the AI
SDK masking the server-side message on purpose — `toUIMessageStream`'s `onError` default is annotated
"prevent leaking server error details to the client by default", and one option changes it. So the
honest comparison is: they report a failure without a reason and can be told to include it; we report
a success with the reason inside it, and there is nothing to configure. It is also worth noting the
inversion — our `tool-output-available` passes the raw server error text straight to the client while
calling it output.

### Counting judgements, stated rather than buried

Eleven. Each is stated with the effect of deciding it the other way, per J1's precedent. **None of
them, taken either way, turns this journey into a win for TheoKit.**

| # | The judgement | Decided as | The other way |
| --- | --- | --- | --- |
| 1 | Is `p-retry` a fair headline for the Next.js side, against a hand-rolled helper? | **Yes.** § The Next.js side permits a well-known library "if that is the shorter honest answer", and it is: 29 added lines against 33, 9 glue against 13. § Why the protocol comes before the measurement requires writing the other side to win | The hand-rolled variant was **built and counted**, not estimated: 1 file, 33 added lines, **13 glue**, 13 logic, and **0 concepts** — nothing external is named, the loop and the wait are on screen. TheoKit would then lead glue 10 to 13 (1.3x, still inside the bar) and **lose concepts 5 to 0, a gap no re-implementation closes**. This is the judgement most favourable to TheoKit in the whole count, and inverting it costs more than it gives |
| 2 | Does installing `p-retry` count as a file touched? | **No.** This page's own rule prices a library as a concept, not as a file, and the install sits in its own uncounted commit | Next.js files 1 → **2**, and TheoKit leads metric 1 by exactly **2x** — the bar, reached. It still is not a win: § What counts as winning requires better on all three, and glue and concepts stay inside |
| 3 | The failing dependency is excluded on both sides | **Excluded**, by the rule written before either implementation existed | Adds the same 48 lines to each side. No effect on the comparison |
| 4 | Are the two error classes business logic or type ceremony? | **Logic** — the rule calls the classification policy business logic, and a class whose whole content is its identity is the vocabulary that policy is written in. The section above made the same call | TheoKit 16 glue / 10 logic, Next.js 11 / 11. Next.js leads glue **1.45x** — a wider lead, still inside the bar |
| 5 | Is `shouldRetry: ({ error }) => error instanceof TransientOrderError` glue or logic? | **Logic.** It *is* the classification policy, expressed as a predicate because that side has no contract to declare it on. Our counterpart, `isRetryable: true` inside the class, is counted as logic for the same reason | Next.js glue 10, ours unchanged at 10 — an **exact tie** on glue lines |
| 6 | Is `const ORDER_SERVICE = process.env.…` glue, or harness that belongs with the excluded dependency? | **Glue** — it is wiring the application writes, and it is symmetric | Both sides drop one: 9 against 8. Ratio unchanged |
| 7 | Is `return await res.text()` logic or glue? | **Logic** — it is the line that produces the answer, the counterpart of J1's table lookup | Both sides move together: 11/15 and 10/12. Ratio unchanged |
| 8 | The retry wraps the dependency call, not the tool body — and criterion 1's oracle does not say which it means | **The dependency call.** Carried unchanged from the section above, and it still decides where the counter goes: inside the retried closure it reads N+1, at the top of `.execute` it reads 1 | Reading it the other way makes criterion 1 **unsatisfiable on both stacks** — nothing on either side re-invokes a *tool*, and the AI SDK's own retry option governs the model request. The ambiguity is reported rather than resolved by rewording the criterion, which would void the journey |
| 9 | Is J1's state the baseline, or the bare scaffold? | **J1's state**, on both sides, per J5's ladder | Measuring ours from the bare scaffold re-counts J1's 3 files and 15 lines in a second journey, and leaves the Next.js side with no tool to retry at all |
| 10 | The attempt counter criterion 1 asks for is instrument, not journey | **Instrument.** It lives in the probes and is counted on neither side | One added line on each side, identically. No effect on the comparison |
| 11 | The `rng` override is charged to TheoKit as a glue line and a concept; `randomize: true` is charged to Next.js the same way | **Both charged.** Each side pays exactly one line and one concept to satisfy criteria 3 and 4, for opposite reasons: ours narrows a jitter that is too wide, theirs turns on a jitter that is off | Dropping ours: TheoKit glue **9** — an exact tie — and concepts **4**, *leading* 4 to 5. And criterion 3 then fails at random. Dropping theirs: Next.js glue 8, concepts 4, and criterion 4 fails outright. **The only reading that gives TheoKit a lead buys it by giving back a criterion**, which is the trade J5 already refused |

### The verdict

| Metric | TheoKit | Next.js + AI SDK | Better | Ratio | Verdict under § What counts as winning |
| --- | --- | --- | --- | --- | --- |
| Files touched | 1 | 1 | neither | 1.0x | **Tie** — an exact tie |
| Glue lines | 10 | **9** | Next.js | 1.11x | **Tie** — inside the bar, and TheoKit is the worse side |
| Concepts required | 5 | 5 | neither | 1.0x | **Tie** — an exact tie, reached from opposite designs |
| Time to first green run | not measured | not measured | — | — | not applicable |
| Criteria satisfied | **4 of 5** | 5 of 5 | Next.js | — | not a countable metric, and the most important line |

**J6 is a tie, and it is not won.** The winning rule requires TheoKit better on all three countable
metrics by at least 2x. It is better on none of them; it is exactly level on two and one line behind
on the third. The three margins — 1.0x, 1.11x, 1.0x — are the narrowest set this programme has
produced, which is the honest way to describe a journey where both stacks solve the same problem with
the same amount of code.

**The prediction on this page was right for the wrong reason.** § The Next.js side predicted a tie
because neither side has a primitive. Both sides have one. The tie arrived anyway, because two mature
retry primitives cost about the same to use — which is a more useful finding than the one predicted,
and it is not a finding in the framework's favour.

**And the tie on cost is not where this journey is decided.** Retry itself works on our side, measured
rather than read: transient failures are retried with strictly increasing, jittered delays; a
permanent failure is not retried; a custom error type the framework has never seen is honoured by the
shipped predicate with nothing configured. All of that is real and all of it is worth a line in this
document. What the framework cannot do is **say that any of it happened**. A run whose tool exhausted
four attempts and gave up is byte-indistinguishable, on the wire, from a run whose tool answered.

### Where the comparison is not apples to apples

Named rather than adjusted for, because adjusting a count until it evens out is the failure the
protocol was written to prevent:

- **One side pays for a dependency, the other does not.** `@theokit/agents` is already in the
  scaffold's dependency list (`packages/create-theokit/templates/default/package.json.tmpl:19`), so
  `Retry` costs nothing to reach; `p-retry` is an `npm install`. Judgement 2 prices that as a concept
  rather than a file, which is this page's own rule and is the reading less favourable to TheoKit on
  metric 1.
- **The transience contract exists on one side only.** Ours is a framework-declared flag an
  application extends by subclassing; theirs is a predicate the application writes from scratch. The
  concept count charges one each and cannot show that they are different kinds of thing.
- **Three targets against one**, as in every journey so far. Criteria 6 to 8 exist on our side and
  have no counterpart on theirs; they are ungraded here, so the comparison silently gives that
  dimension away.
- **The legibility gaps are not the same size.** Theirs masks a message and is one option from not
  masking it. Ours reports the wrong outcome and has no option at all. The criteria table scores both
  as a single row and the two are not equivalent.
- **Metric 4 was not measured on either side**, so nothing here is a claim about wall-clock cost.

### What is still unmeasured, and why

**Metric 4 (time to first green run) needs a live model call**, at least three times, cold cache, on
both sides. The instrument above removes the *credit* obstacle but not the *comparability* one: a
number measured against a local scripted model measures the harness, not what a developer waits for.
Recorded as not measured rather than substituted. Nothing in the verdict depends on it — the rule
requires TheoKit better on the three countable metrics first, and it is better on none.

**The `[stderr]` prefix is the SDK's, and what produces it was not read.** The framework receives a
pre-flattened string on the delta path and a `{stdout, stderr, exitCode}` object on the message path.
Whether that split is stable across SDK versions lives outside these two packages.

**Criterion 4 remains the weak oracle this page labelled it.** Five runs producing four distinct
delays is consistent with jitter and also with scheduler noise, on both sides. Nothing in this
measurement strengthens it and the report does not present it as proof of jitter.

**The three-target criteria cannot be exercised in this repository**, for the reason
`.claude/rules/three-target-parity.md` records. J6 was counted against the Web path alone.

**Neither application is committed** under `docs/program/evidence/j6-retry/`.
`../dx-benchmark.md` § Evidence asks for both implementations there; that directory does not exist and
this measurement did not create it. The diffs, the counts, the criteria results and the wire payloads
are published here instead, which satisfies the checkability the clause exists for and does not
satisfy the clause. Open for the fifth time.

**There is still no circuit breaker anywhere in either source package**, as § Current state records.
Not required by this journey, and unchanged by it.

### The defect this measurement filed

[#388](https://github.com/usetheokit/theokit/issues/388) — a tool that throws reaches the caller as
`isError: false` on a `done` run; the SDK's `exitCode: 1` is discarded. Filed with the repro, the
teed SDK payload, both wire outputs, the two source sites and the note that the presenter branch it
needs already exists.

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
