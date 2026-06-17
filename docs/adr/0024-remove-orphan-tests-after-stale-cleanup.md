# ADR 0024 — Remove orphan tests left behind by the stale-artifact cleanup (fc3f49b)

**Status:** Accepted
**Date:** 2026-06-17
**Deciders:** project owner

## Context

Commit `fc3f49b` ("chore: remove stale docs, examples, and tests") deliberately
deleted **839 files / ~105k lines** — 416 `fixtures/`, 317 `docs/`, 79
`examples/`, 22 `scripts/`, and a few configs — as **stale** (dead demos,
superseded docs, retired examples). The cleanup was correct: those artifacts
described features/examples that no longer represent the framework.

However, the cleanup was **incomplete**: a large set of tests that asserted the
existence/shape of those deleted artifacts were **left behind**. They fail on
`develop` not because of a real defect, but because they reference
intentionally-removed files (`examples/full-stack-agent/...`, deleted concept
docs, retired ADR-doc tripwires, etc.). This is the bulk of the
"repo-test-failure-landscape".

## Decision

**Treat the `fc3f49b` stale-removal as authoritative.** A test that
exclusively exercises an artifact that `fc3f49b` removed **and which has not
been (and should not be) restored** is itself stale and is **removed** — this
ADR is the governing record (it is NOT a silent `# noqa` / `describe.skip`
bypass).

### Classification rule (applied per failing test file)

A failing test is an **orphan → REMOVE** iff ALL hold:

1. Its subject artifact path is **absent** on `develop`, AND
2. that path was **deleted by `fc3f49b`** (verifiable: `git show fc3f49b --diff-filter=D --name-only` contains it), AND
3. the artifact describes a **discontinued** feature/example/doc — not a live framework capability.

Otherwise the test is **NOT** an orphan and is **fixed**, not removed:

- If the artifact is a **live feature** whose test data was collaterally deleted (adapters, ssr, sessions, typed-client, dynamic routes, etc.), the **fixture/doc is restored** and the test stays. (Several such restorations already shipped: see CHANGELOG `[Unreleased]`.)
- If the test fails on **content drift** of a present artifact, the **code/artifact is fixed**.

### What is removed under this ADR

Orphan-test files whose deleted-by-`fc3f49b` artifact is a discontinued
example/doc — enumerated in the CHANGELOG `[Unreleased] § Removed` entry that
accompanies each removal batch, with the absent artifact path cited.

## Alternatives considered

1. **Restore all 839 artifacts (rejected).** Reverts a deliberate cleanup, re-introduces stale `@usetheo/*`-scoped code and superseded docs, and risks breaking currently-green tests. The owner judged the cleanup correct.
2. **Silently skip the orphan tests (rejected).** `describe.skip` / deletion without a record is exactly the "disabled test = invisible tech debt" anti-pattern. This ADR + CHANGELOG entries are the audit trail.
3. **Leave them red forever (rejected).** A permanently-red suite destroys the signal value of the gate (a real regression hides in the noise).

## Consequences

- The suite converges to green by removing orphan tests, not by faking passes.
- Every removed test is traceable to this ADR + a CHANGELOG line citing the absent artifact it depended on.
- Live-feature tests are retained; their collaterally-deleted fixtures/docs are restored instead of dropped.
- If a "discontinued" artifact is later deemed live, its test is re-added alongside the restored artifact (normal TDD), not resurrected from this ADR.

## References

- Root-cause commit: `fc3f49b` ("chore: remove stale docs, examples, and tests").
- Pre-deletion snapshot (for any genuine restoration): `efe63ed` (Release v0.4.0).
- Companion live-feature restorations already shipped: CHANGELOG `[Unreleased]` (fixtures, migration guide, canonical chat).
