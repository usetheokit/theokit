---
slug: a-deployed-entry-imports-its-logic
item: B-262
phase: review
date: 2026-09-23
---

# Review — B-262, a deployed entry imports its logic

## Findings

Four, all closed. Three were found by reviewing my own diff adversarially rather than by any tool, and the fourth by a gate I had asserted would not fire.

| # | Severity | Finding | Closed by |
|---|---|---|---|
| 1 | BLOCKER | `buildRateLimiter` had no production caller — the item's main artefact was an orphan | `8e52f1adf` wires both emitter branches to it |
| 2 | HIGH | `buildRateLimiter(config, null)` refused EVERY caller, reporting a store outage that had not happened | `== null` takes the fallback; test asserts it |
| 3 | HIGH | Three `adapters-may-only-depend-on-core-router-services` violations — the plan asserted "boundary crossed: none" without checking the rule | `2e7320122` moves the file to `server/rate-limit/` |
| 4 | MEDIUM | The virtual module from T1.1 had no caller and rested on a premise T1.2 disproved | removed in `2e7320122`, recoverable at `4711950a3` |

## Finding 1 is the one worth reading

`buildRateLimiter` was imported by exactly one file: its own test. That is the same `no-orphans` defect I had used, one commit earlier, as the reason to delete the virtual module — sitting in the artefact the whole item is about, and I did not see it until I read the diff looking for it.

Wiring it delivered what the item promised, and the shape is the argument. The emitter had two branches: `createRateLimiterWeb` returns a value, `createDurableRateLimiterWeb` returns a Promise. That is why `rateLimitCheckFragment` had to ask, per config, whether to emit `await`. **A call site whose shape changes with the config is exactly what produced B-257's missing one.** `declaresDurableStore` existed to make that decision, and its 16 lines are deleted here because there is no decision left.

## Finding 2 — the failure mode that wore the wrong diagnostic

`buildRateLimiter(config, null)` was measured, not imagined: the null missed `=== undefined`, reached the durable branch, `store.incr` threw, ADR 0019's fail-closed caught it, and the answer was `limited: true` with `X-RateLimit-Unavailable: store`.

So a programmer's `null` refused every caller **while blaming infrastructure**. Failing closed is right for a store that is down and wrong for an argument that was never a store, and the second is much harder to diagnose because the header points away from the cause.

## What the gates caught that I asserted they would not

The plan's Baseline Context said, in as many words, *"Architecture boundary crossed: none."* `/code-quality` returned `FAIL_HARD` with three counts of the opposite. The rule's judgement was better than mine: the file builds the limiter a REQUEST is answered by, so it is runtime wiring and belongs beside what it wires, not in the build directory.

## What was NOT reviewed

- **Behaviour on a real platform.** Every test here loads and drives the emitted entry in Node, with `Bun.serve` and `Deno.serve` stubbed. Whether the converted entry runs on Cloudflare is B-263, which carries the `access` impediment because it needs accounts this process does not have.
- **Mutation score.** No Stryker config exists, so D4 measured nothing. Declared as a soft floor rather than passed over.
- **The other five adapters and the other cross-cutting concerns.** One adapter, one concern, by ADR-1.

## Verdict

`READY_TO_MERGE`

No BLOCKER open. Both HIGHs closed with tests that fail without the fix. The MEDIUM was closed by deletion, with the reasoning recorded and the code recoverable.
