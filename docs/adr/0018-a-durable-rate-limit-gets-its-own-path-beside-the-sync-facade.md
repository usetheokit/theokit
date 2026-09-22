# 0018 — A durable rate limit gets its own path beside the sync facade, not a broken signature

- **Status:** accepted
- **Date:** 2026-09-22
- **Deciders:** taken under `rules/autonomy-envelope.md` § *A structural decision the contract wants recorded*, after three independent reviews refused the B-257 alignment brief for leaving it unmade
- **Closes:** the contradiction between `rate-limit.ts:48-52` and `docs/adr/0017:31-34`, which the brief had listed as an open question while its requirements had silently answered it

## Context

A `rateLimit` block declared in `theo.config.ts` is enforced by two of the seven deploy targets.
`node` and `bun` carry `'rateLimit'` in `appliesConfig`; the five per-invocation runtimes do not, so
`theokit build` refuses them by name (`config-support.ts:221-231`). The refusal is honest and it is
not protection: the counter is what is missing, and `deployed-rate-limit.ts:183-184` says so in the
generated code itself.

**The repository records two designs for closing it, and they contradict each other.** Measured
2026-09-22:

| Record | Says |
|---|---|
| `packages/theo/src/server/rate-limit/rate-limit.ts:48-52` | external stores *"must wire it via a dedicated async middleware path (out-of-scope for T2.1; tracked for the follow-up `@theokit/rate-limit-redis` package)"* |
| `packages/theo/src/server/rate-limit/rate-limit-per-route.ts:164` | the throw itself: *"async RateLimitStore implementations require a dedicated async middleware path"* |
| `CHANGELOG.md:6442,6450,6461` | the rejection is shipped contract — `CR-005 parity` |
| `docs/adr/0017:31-34` | *"**No durable store ships.** The interface is injectable … and none is built (YAGNI). A framework that shipped one would be choosing everybody's datastore."* |

`@theokit/rate-limit-redis` exists in neither `packages/` (which holds seven packages, none of them
it) nor the npm registry (404). The comment promising it is scoped to `0.3.x`; the version today is
`0.71.0`.

**A version marker is not an expiry.** What weakens that comment is different and stronger: it frames
itself as a task boundary (*"out-of-scope for T2.1"*) rather than a decision, in a repository that
records decisions here with a status and rejected alternatives; the package it promises exists
nowhere; and the CHANGELOG records the *rejection* as shipped contract. That leaves an **unexecuted
intention**, which keeps its standing until something supersedes it. This supersedes it.

## Decision

**A durable rate limit is reached through its own async path. The synchronous facade keeps its
signature, keeps its guard, and keeps refusing what it cannot run.**

Three halves, and the third is what makes the first two honest:

1. **`createRateLimiterWeb` is not made async.** Its `instanceof InMemoryStore` guard stays, and the
   error it throws stays accurate: this facade cannot await, so a store that must be awaited does
   not belong to it.
2. **The async path is new surface, not a reshaped one.** It accepts a `RateLimitStore` and awaits
   `incr`, which `packages/theo/src/server/auth/auth-throttle.ts` already does with no guards at
   `:59`, `:92` and `:99` — the existence proof that the contract works unmodified.
3. **The framework still ships no store.** ADR 0017's rule is not narrowed: what this adds is the
   path by which an application reaches a store it brought, which is what `rate-limit-store.ts:5-7`
   already describes — *"Multi-instance deployments … opt in to a distributed adapter (Redis,
   Cloudflare KV)"*. No `@theokit/rate-limit-redis` is built, and that half of the 2026 comment is
   withdrawn rather than deferred again.

## Who is affected

Found by searching rather than recalled:

| Consumer | Effect |
|---|---|
| the six generated deploy entries (`bun.ts:111`, `cloudflare.ts:377`, `vercel.ts:52`, `netlify.ts:91`, `deno-deploy.ts:102`, `aws-lambda.ts:168`) | **none today.** They keep emitting the sync facade. An entry opts into the async path only when a config names a store |
| `tests/unit/rate-limit-web.test.ts` — 13 synchronous `check(...)` calls, and `:66-77` asserting the guard's throw | **none.** The assertion stays true |
| `packages/theo/tests/bench/rate-limit-hot-path.bench.ts:22,25` | **none.** They keep measuring the sync path, so the ≥ 1 400 000 ops/s figure stays comparable across this change |
| anyone importing `createRateLimiterWeb` from `theokit/server` | **none.** No signature moves |
| `createRouteRateLimiterWeb`, `createRouteRateLimiter`, `createRateLimiter` | **none.** Their guards are untouched; this ADR decides nothing about them |

## What would break, and what would not

**Additive.** No exported signature changes, no call site changes, no test changes. The alternative
was not: it required a breaking signature change on `createRateLimiterWeb`, which
`docs/api/rate-limit-subpath-surface.md:25` records as a **promise owed** reached through
`theokit/server`, an umbrella the same row records as **DEPRECATED, removal at `0.x+2`**.

## Alternatives rejected

**A — make `createRateLimiterWeb` async.** Rejected on four measured counts. It breaks a signature on
a promised symbol; it does so through an umbrella already scheduled for removal, so the work is
discarded at `0.x+2`; it costs six generated call sites, twelve test calls and two benches, where
this decision costs none of them; and it contradicts what the code prescribes in two places without
superseding it. Its one merit — a single code path rather than two — is real and is not worth a
break on a deprecated, promised surface.

**B — build `@theokit/rate-limit-redis`.** Rejected because it is what ADR 0017 forbids, in its own
words: a framework shipping a durable store chooses everybody's datastore. The comment promising it
predates that ADR and does not survive it.

**C — leave the build refusing.** Rejected because refusing is not protecting, and J7's criterion 6
stays honestly unwon while it is the answer. It remains the correct behaviour for any target with no
store configured, which is FR-004 of the item's brief and is unchanged by this decision.


## Which subpath the new symbol arrives through — the objection this ADR's own argument raises

Design A is rejected partly because its work *"is discarded at `0.x+2`"*, when `theokit/server` is
removed. The six generated entries import from that same umbrella. So if the new symbol arrives the
same way, design B inherits the identical expiry and the argument turns around on itself.

**It arrives through `theokit/server/rate-limit`**, which `packages/theo/package.json:78-81` already
declares as its own export with its own types and entry, independent of the `./server` umbrella at
`:34`. The barrel behind it is `packages/theo/src/server/rate-limit/index.ts`, and
`docs/api/rate-limit-subpath-surface.md` is the record of what that subpath promises — enforced by
`tests/smoke/rate-limit-subpath-surface-is-decided.test.ts`, which turns red on a symbol exported
without a decision.

So the asymmetry holds rather than dissolving: design A would have spent a break on a symbol reached
through the expiring umbrella; design B adds a symbol to a subpath that outlives it. What design B
does inherit is that **the six generated entries still import their existing symbols through
`theokit/server`** — unchanged by this decision, and the umbrella's removal is their problem whichever
design is chosen.

**And a correction to this ADR's own cost comparison.** It says design B costs none of the six
generated call sites. That is true only while no application names a store. Once one does, the entry
must import, construct and await the new path — the same six sites, reached conditionally rather than
unconditionally. The comparison stands, and it is narrower than first written.

## Consequences

- B-257's requirements are rewritten against this decision rather than listing it as open. A question
  the requirements have already answered is not open, and three reviews refused the brief for that.
- The `0.3.x` comment at `rate-limit.ts:48-52` is superseded in both halves: the dedicated path is
  adopted, and the Redis package is withdrawn. The comment should be updated to cite this ADR.
- Two code paths exist for one concept. That is the cost, it is accepted, and it is bounded by the
  sync facade's guard continuing to name why it refuses.


## What the alignment for this decision cost, and the one thing worth carrying

This ADR was written in the middle of an alignment review that took **eighteen rounds** and produced
**seventeen defects**, each verified against the tree before it was fixed. The brief itself is under
`.squad/records/`, which this repository does not version — so the record does not travel, and this
section is the part that does.

**Three remedies, each earned by a defect that recurred until it was named.**

1. **Before writing a criterion, read what the file it touches already says about itself.** In five of
   the seventeen the answer was already written here and nobody had read it: `vitest.config.ts` warns
   about prefix-matching aliases six times and records three instances of being caught by it;
   `tsconfig.json` carries `theokit/server/agent` as the standing precedent that a two-level subpath
   needs its own entry; `cli/commands/build.ts:275-278` says it refuses *"BEFORE the build writes
   anything"*, which is why a criterion targeting `cloudflare` could never reach the second error; and
   `tests/integration/every-deployed-entry-limits-its-caller.test.ts:18-21` records, from one item
   earlier, that *"a render-contains assertion cannot see an unbound identifier, an unimported symbol,
   a call site that was never emitted, or a guard that was never written."* That last lesson was
   written by the same chain and reintroduced six revisions later.

2. **After an edit, sweep the edit — and the sweep must count, not read.** Nine acceptance criteria
   existed in two versions, one stale, because corrections were inserted above the originals. Several
   rounds of re-reading did not reveal it; one `Counter` over the ids did.

3. **A guard's count must be taken over the thing it guards, not the file it lives in.** Four
   successive forms of one criterion each failed differently, and the last was the instructive one:
   counting FILES that contain an `instanceof` guard could not detect removing the guard in
   `createRateLimiterWeb`, because `rate-limit.ts` also holds the one in `createRateLimiter`. The
   criterion passed the exact change it existed to catch.

**And the reading habit that hid the seventeenth.** `score_alignment.py` prints an advisory naming
criteria that can pass because their subject is absent. It named two of this brief's, on every run,
for several revisions — unread, because every invocation filtered the output for the score line. A
tool read only for the line that agrees is a tool that cannot disagree.
