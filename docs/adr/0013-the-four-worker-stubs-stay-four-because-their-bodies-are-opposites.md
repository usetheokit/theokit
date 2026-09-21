# 0013 — The four Cloudflare worker stubs stay four, because their bodies are opposites

- **Status:** accepted
- **Date:** 2026-09-21
- **Decides:** B-190's first Definition-of-done bullet, which asks for one parameterised helper.

## Context

Four test files each carry a `STUB_SOURCE` — a hand-written module standing in for what the
generated Cloudflare worker imports. B-190 was filed at REVIEW as `F-arch-1` (HIGH) with corroborating
MEDIUM and LOW findings from two other seats, on the reading that four copies of one thing had begun
to diverge.

The copies had diverged. The question this ADR answers is whether that divergence is the defect or
the design.

## What was measured

Re-measured 2026-09-21: four stubs at **18 / 20 / 31 / 22** lines, **four distinct content hashes**.

The decisive measurement is not the count, it is what the same symbol does in two of them:

| file | `withSecurityHeaders` |
|---|---|
| `deployed-agent-is-served.test.ts` | `(r) => r` — identity |
| `adapter-security-headers.test.ts` | `(...a) => b().withSecurityHeaders(...a)` — delegates to a recorder |

They are opposites **on purpose**. One test does not care about headers and must not have them
interfere; the other's entire subject is the headers and must observe every call. The same split
exists for `mountAgent`: a fixed `Response` in one, a delegating recorder in another.

## Decision

**Keep the four stubs. Extract the LIST instead.**

A parameterised helper covering these bodies needs a flag per symbol per test — identity or recorder,
fixed response or delegate — which is a configuration language for four callers. That is more to read
than the four literals, and every future test adds a flag rather than a stub.

`~/.claude/CLAUDE.md` § 12 names this directly: DRY applies to duplicated KNOWLEDGE, and forcing it
onto accidental similarity produces a fragile abstraction coupling modules that should be
independent. Here the similarity is the shape of a module; the knowledge each body encodes is
different and deliberately so.

## What WAS duplicated, and is now derived

The **export list** — which symbols a stub must provide. That is one fact, repeated four times, and
it had been assembled one `SyntaxError` at a time.

`tests/unit/worker-stubs-cover-the-generated-imports.test.ts` derives it from
`renderCloudflareWorkerEntry` over BOTH `ssrStreaming` shapes and asserts each stub covers the union.
Re-run 2026-09-21: 5 tests, exit 0. It found a real gap on its first run — `generateNonce` was absent
from two stubs, invisible because both generated with `ssrStreaming: false`.

That is B-190's third bullet, and it is the half of the finding that was true.

## Who is affected

Only this repository's test suite. No published package, no API, no behaviour. A contributor adding a
fifth stub is told by the derived test which symbols it must export, and is not told how to implement
them — which is the point.

## What would break, and what would not

Nothing breaks: this ADR records a decision not to change code. The alternative — the extraction —
would have risked the canaries `cloudflare-streaming-shell.test.ts` relies on (a stub ignoring its
options, a branch never reached), which is B-190's second bullet and is moot once the first is
refused.

## Alternatives rejected

**One helper with per-symbol behaviour flags.** Rejected on the measurement above: a configuration
language for four callers, where each new test adds a flag instead of a file.

**Two helpers — "identity stub" and "recorder stub".** Closer, and still wrong: the four differ on
more than one axis, so two helpers become four parameters. The 31-line stub carries plugin wiring the
other three have no use for.

**Leave the list duplicated too.** Rejected: that IS one fact in four places, it had already cost a
series of `SyntaxError`s, and a hand-kept list is the copy that goes stale first.
