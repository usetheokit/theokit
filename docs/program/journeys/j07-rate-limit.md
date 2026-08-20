# J7 — Rate limit

The seventh of the ten benchmark journeys (`../dx-benchmark.md`). Criteria written before either
implementation exists; a journey whose criteria change after code exists is void and must be re-run
from scratch.

**Scheduling status:** ready. `../dx-benchmark.md` § Sequencing lists J7 in the first batch to be
implemented and measured.

## What the journey requires

Copied from `../dx-benchmark.md` § The ten journeys, unchanged. Rewording it requires an ADR,
because a movable target measures nothing.

| # | Journey | What must work |
| --- | --- | --- |
| J7 | **Rate limit** | A caller exceeding a declared budget is refused, and told so |

Three obligations. **Declared** — the budget is configuration, not a constant compiled into a
handler. **Refused** — the work does not happen, not merely a warning. **Told so** — the caller can
distinguish this refusal from every other failure and knows when to come back.

## Acceptance criteria

In the shape `ROADMAP.md` uses: observable, with an oracle, graded by `/acceptance` against the
released artifact rather than the working tree (`.claude/rules/cycle-acceptance.md` § Target kinds).

**Definition of done (all must hold):**

- [ ] with a budget of N declared in configuration, request N succeeds and request N+1 is refused,
      against a published build — asserted on the boundary rather than on a large burst, so an
      off-by-one is caught rather than averaged away
- [ ] the refusal is machine-readable and distinguishable: the response carries the rate-limit
      status code and an error code that is not shared with any other failure class, read from the
      parsed body rather than from the status alone
- [ ] the refusal tells the caller when to retry: a retry-after value is present and, after waiting
      it out, the next request succeeds — the wait is performed and the follow-up asserted, so the
      header is verified rather than merely observed
- [ ] the refused request did no work: the handler's side effect is absent for the refused request,
      counted inside the handler, so "counted then executed" is distinguishable from "refused"
- [ ] the budget applies to the agent path and not only to plain routes: a caller exceeding the
      budget on `POST` to an agent endpoint is refused with the same code and the same headers as on
      a plain route — this criterion exists because § Current state records that it does not hold in
      every mode today
- [ ] Applies to: Web, Tauri, TUI — each listed target is exercised in acceptance, not merely
      declared
- [ ] Tauri: a declared budget is enforced on the in-process path, or the framework refuses the
      configuration by name. Silent non-enforcement off-HTTP is the failure
      `../three-target-parity.md` names
- [ ] TUI: same seam, same rule — enforced, or refused by name, never silently absent

**What resisted an oracle.** "Fair across callers" — the property that actually makes a limiter
useful — is not gradeable in a single run. Two callers, one budget, is testable; *fairness under
contention* needs a load profile and a statistical claim, which would turn this journey into a
performance benchmark. It is excluded, and the exclusion is stated rather than smuggled in behind a
criterion that looks like it covers it.

## The Next.js side

**There is no framework primitive, and the honest equivalent is a well-known library plus a store.**
Next.js ships no rate limiter. The idiomatic answer, and the one Vercel's own templates use, is a
sliding-window limiter backed by a serverless Redis, applied in middleware or at the top of a Route
Handler.

The reference implementation: the limiter library configured with a window and a limit, a store
instance, and the check at the entry point returning the rate-limit status with the retry-after
header. Where an official example exists it must be used and cited
(`../dx-benchmark.md` § Why the protocol comes before the measurement).

*To confirm at implementation time, because these are version-specific and this document is written
without access to that source:* the current package names for the limiter and its store, whether the
limiter's default algorithm is sliding-window or fixed-window, and whether the current
recommendation places the check in middleware or in the handler.

**Two asymmetries must be recorded before any number exists, and one of them cuts against us.**
First, the platform-level firewall that the Next.js host offers is *not* the comparison: it is
configuration in a dashboard, not code, and this benchmark measures code. Second, the library's
store is distributed and, as measured below, ours is not — so a like-for-like comparison must either
run both single-instance or state plainly that the two limiters have different operational reach.
The second option is the honest one and the report must take it.

## How the four metrics are counted here

The general counting rule is in `../dx-benchmark.md` § The four metrics. What follows is that rule
landed on this journey.

**Files touched.** Counted: the configuration that declares the budget, any middleware or handler
edit, the store setup, and any file the developer touches to extend the budget to the agent path.
Not counted: the route being protected, if it already existed — but any edit made to it is counted.

**Glue lines.** The budget numbers are business logic — a window and a limit are a real product
decision. Everything else is glue: the store construction, the key derivation, the check, the header
writing, the error mapping. Provisioning a store counts as glue on the side that needs one, and its
absence counts as zero on the side that does not, with the operational difference recorded rather
than scored.

**Concepts required.** Derived mechanically from the imports and APIs the diff uses. Expected on
ours: the config key, the per-route shape, the key-derivation strategy, and the trust-proxy setting
if the run goes through one. Expected on the Next.js side: the limiter constructor, the algorithm
choice, the store client, and its credentials. Credentials count as a concept: a developer who must
create an account to satisfy a journey has learned a name they did not know.

**Time to first green run.** Wall clock from `npx create-theokit` to the first run where all five
assertions pass, including criterion 3's real wait. The wait is a fixed, declared cost on both sides
and is subtracted from the reported figure — this is the only subtraction any journey makes, and it
is made because the value is chosen by the test rather than by the framework.

## Measured - TheoKit side, metrics 1-3 (2026-08-20)

**Three of four metrics, one side.** This is not the journey being won; it is the first number this
journey has. Metric 4 and the whole Next.js side are unmeasured, and the subsection below says why.

Obtained from a real diff, not an estimate: the scaffold template was copied verbatim, committed as
an untouched baseline, and the journey implemented on top. The counts are `git diff --numstat` over
that commit.

| Metric | TheoKit | How it was counted |
| --- | --- | --- |
| Files touched | **1** | `theo.config.ts` edited. Nothing else is created or edited: the limiter is already applied on every `/api` branch of the production server (`packages/theo/src/cli/commands/start/handlers.ts:92`, applied at `:115`, `:224`, `:277`, `:406`) |
| Glue lines | **2** | of 3 added lines and 1 removed; the third added line is business logic, because it is the budget |
| Concepts required | **3** | the `rateLimit` config key, its flat `{ windowMs, max }` shape, and `config().set()` - the builder ships no `.rateLimit()` setter, so the escape hatch is the only door (`packages/theo/src/config/config-builder.ts:38`) |
| Time to first green run | **not measured** | see below - and the reason is not credits |

**The 3 added lines, classified.** Published because the glue split is the metric most open to being
argued after the fact, and a table nobody can check is not evidence - least of all one published by
the side it favours.

Glue (2): `export default config()` and `  .build()` - the two lines the formatter breaks the chain
into, which the removed line already contained.

Business logic (1): `  .set({ rateLimit: { windowMs: 60_000, max: 20 } })`. The window and the limit
are a product decision, and the rule above says so.

**Four judgement calls, stated rather than buried.**

1. **The whole `.set(...)` line was counted as business logic**, although it also carries the
   declaration wrapper. Splitting a line between the two categories is not something the rule
   defines, and counting the line as glue would report a journey whose entire authored content is a
   product decision as containing none. Deciding the other way gives 3 glue and 0 business logic.
2. **`numstat` was reported as it counts, not as the edit reads.** Three lines are added and one
   removed; the substance is a single inserted line, because the formatter breaks a three-call chain
   across lines. Counting substance gives 1 added line. This is the same divergence J3 recorded, and
   it is reported the same way.
3. **The flat shape was chosen over the per-route shape.** Both satisfy the criteria on a published
   build - `createRouteRateLimiter` normalises the flat form into the default bucket
   (`packages/theo/src/server/rate-limit/rate-limit-per-route.ts:151`) - and the flat one is one
   line. The per-route shape is a nested object instead of a flat one; it was not measured, because
   the criteria do not need per-route budgets, and it is the shape § The deliberately broken state
   records the dev server narrowing away before it reaches the limiter
   (`packages/theo/src/cli/commands/dev.ts:63`).
4. **No store was provisioned, and that is a zero rather than an omission.** The rule says a store
   counts as glue on the side that needs one and as zero on the side that does not, with the
   operational difference recorded rather than scored. Ours cannot have one: every shipped factory
   refuses anything but the in-memory implementation
   (`packages/theo/src/server/rate-limit/rate-limit.ts:53`,
   `packages/theo/src/server/rate-limit/rate-limit-per-route.ts:162`). So the zero here is the same
   fact as the reach asymmetry § The Next.js side already said the report must state plainly.

**Which target the run measures decides the result, and that is not a detail.** Criteria 1 and 5
hold on the Node production server and fail on the Web-standards handler, whose rate-limit factories
have no production caller (`packages/theo/src/server/rate-limit/rate-limit.ts:105`,
`packages/theo/src/server/rate-limit/rate-limit-per-route.ts:295`). Six deploy targets are built on
that handler. A one-line diff that protects `theokit start` and protects nothing on those targets is
one number with two meanings, and `j10-deploy.md` measures the other one.

### What is still unmeasured, and why

**Metric 4 (time to first green run) was not measured, and the reason is different here.** This
journey needs no live model call: the refusal happens before the agent runs, so even criterion 5 is
gradeable without a model key. What blocks it is the rest of the protocol - at least three cold runs
from `npx create-theokit`, including criterion 3's real wait, and a second side to compare against.
Recording that difference matters: J7 is the cheapest of the ten to time, and it is still not timed.

**Nothing was executed.** No build, no server, no request, no refusal observed. Criteria 1 through 5
are read from source: the limiter is constructed when the key is present
(`packages/theo/src/cli/commands/start/index.ts:123`), applied before the handler on each `/api`
branch, and answers with a dedicated code and a retry-after header
(`packages/theo/src/server/rate-limit/rate-limit-per-route.ts:210`). Read is not run.

**The Next.js side does not exist yet.** Until it does, nothing here is a comparison, and the winning
rule cannot be applied. A journey is won or tied; a one-sided count is neither.

**Behaviour under concurrency and at the fixed window's seam is out of scope by the exclusion this
page already stated**, and this measurement neither narrows nor widens it.

**The three-target criteria cannot be exercised in this repository.** The Tauri and TUI lines need
`@theokit/tui` and `@theokit/ui`, which live outside it (`.claude/rules/three-target-parity.md`
records the same limit). What settles them is the north-star app
(`.claude/rules/northstar-app.md`), which does not exist yet. Criterion 7's real question - whether a
declared budget is enforced off HTTP or refused by name - is untouched by a diff that only declares
one.

**So: J7 is not won, not tied, and not run.** It has one side of three metrics, on the one target
where the mechanism is wired.

## The deliberately broken state

Per `../dx-benchmark.md` § The fifth, which is pass/fail and not a number. The break for J7 is a
**budget declared in a shape the runtime does not consume** — not a hypothetical, as § Current state
records.

| | |
| --- | --- |
| Names the action | `rateLimit was declared with per-route rules, but this server consumes only the flat { windowMs, max } shape — nothing is being limited. Use the flat shape here, or run the production server, which reads per-route rules.` — names what was declared, what was read, the consequence, and both fixes |
| Does not name the action | Nothing at all: the server starts, every request succeeds, and the developer discovers the gap from a bill or an incident |

**This is the second journey where the realistic break produces no error site**, and it is graded
the same way J8 establishes: a silent wrong outcome scores **fail** on the fifth metric rather than
being excused as unmeasurable. The repository has already paid for this exact failure once — the
production path carries a comment recording that a per-route configuration used to produce a null
limiter and nothing was limited, silently
(`packages/theo/src/cli/commands/start/index.ts:117`).

A second break is graded in the same transcript, because it is the one that shows up under load:
**a limiter whose store is process-local behind more than one instance.** Names the action:
`rate limiting is using the in-process store; with 3 instances each caller gets 3x the declared budget. Configure a shared store.`
Does not: correct-looking behaviour on one instance and a budget that quietly multiplies on the
others.

## Current state and blockers

Measured against the working tree on 2026-08-20; every claim is read from source.

**Nothing blocks J7 from running. Criterion 5 fails in one of the two modes, and criterion 1 fails
entirely on the Web-standards handler — both are measured defects rather than missing features.**

What is wired, and it is a real limiter:

- A public surface with per-route rules and pluggable key derivation
  (`packages/theo/src/server/rate-limit/rate-limit-per-route.ts:151`, key derivation at `:118`),
  exported from the server barrel (`packages/theo/src/server/rate-limit/index.ts:1`).
- Declared in configuration under a `rateLimit` key
  (`packages/theo/src/config/schema.ts:143`, shape at
  `packages/theo/src/config/schemas/rate-limit.ts:16`) — so criterion 1's "declared" is satisfiable.
- Enforced across four branches of the production server, including the agent routes and the
  approval endpoint (`packages/theo/src/cli/commands/start/handlers.ts:92`, applied at `:115`,
  `:224`, `:277`, `:406`).
- The refusal is a rate-limit status with a dedicated error code
  (`packages/theo/src/core/contracts/envelope-code-to-status.ts:25`) and a retry-after header on the
  refused response (`packages/theo/src/server/rate-limit/rate-limit-per-route.ts:210`), inside the
  framework's standard error envelope
  (`packages/theo/src/server/http/send-response.ts:123`). Criteria 2 and 3 have real material.

Three findings that shape what the run will show:

- **The algorithm is a fixed window, not a sliding one**
  (`packages/theo/src/server/rate-limit/rate-limit-store.ts:97`). Criterion 1's boundary test passes
  on a fixed window; the burst-at-the-seam behaviour it permits is not graded here, and is recorded
  so the comparison against a sliding-window library is not read as like-for-like.
- **The store is in-process only, by enforcement rather than by omission.** The store interface is
  async and Redis-shaped (`packages/theo/src/server/rate-limit/rate-limit-store.ts:27`), but every
  shipped factory throws when handed anything other than the in-memory implementation
  (`packages/theo/src/server/rate-limit/rate-limit.ts:53`,
  `packages/theo/src/server/rate-limit/rate-limit-per-route.ts:162`). A multi-instance deploy has no
  shared budget. This is the asymmetry the Next.js section says must be stated rather than scored.
- **The Web-standards handler has no rate limiting at all.** The web-shaped factories
  (`packages/theo/src/server/rate-limit/rate-limit.ts:105`,
  `packages/theo/src/server/rate-limit/rate-limit-per-route.ts:295`) have no production caller —
  their only references outside `src` are tests. So the deploy targets built on the web handler are
  unprotected, which puts criterion 1 and criterion 5 in direct tension with J10: the journey passes
  on the Node server and fails on the adapters. The benchmark must record which target it measured.

**Criterion 5's live gap: the dev server does not limit agent routes.** In dev the flat, IP-only
facade is used (`packages/theo/src/vite-plugin/api-middleware.ts:315`), the per-route shape is
narrowed away before it gets there (`packages/theo/src/cli/commands/dev.ts:63`), and the agent
middleware is registered before the API middleware and contains no rate-limit call
(`packages/theo/src/vite-plugin/configure-server-hook.ts:101`). Since acceptance grades the
**published build** and not the dev server, this does not block the journey — it is recorded because
a developer's first encounter with the limiter is in dev, and a limiter that behaves differently
there is a DX finding in its own right.

**On budgets that are not requests:** the token/cost budget is a different mechanism and it is
worth separating. The recording-only cost module has zero production callers
(`packages/theo/src/server/cost/track-agent-run.ts:49`, exported at
`packages/theo/src/server/cost/index.ts:11`) and never throws by design. The *enforcing* budget lives
in the guardrails — a cumulative token ceiling that rejects rather than warns
(`packages/agents/src/guardrails/detectors.ts:114`), with a non-retryable error whose reason is
stated (`packages/agents/src/guardrails/types.ts:87`), mapped to the same rate-limit status on the
wire (`packages/theo/src/core/contracts/server-error-to-envelope.ts:48`). J7 grades the request
budget; the token budget is noted here so a later reader does not conclude it was missed.

**Not measured:** behaviour under concurrent load, and whether the fixed window's seam is reachable
in practice. Both are out of this journey's scope by the exclusion stated in § Acceptance criteria.

## Cross-references

- The benchmark this journey belongs to: `../dx-benchmark.md`
- The journey whose refusal must not be retried: `j06-retry.md`
- The journey whose targets are unprotected today: `j10-deploy.md`
- Transversal target rule criterion 7 and 8 enforce: `../three-target-parity.md`
- Acceptance contract that grades these criteria: `../../../.claude/rules/cycle-acceptance.md`
- Criterion shape these follow: `../../../ROADMAP.md` § Wave 1
