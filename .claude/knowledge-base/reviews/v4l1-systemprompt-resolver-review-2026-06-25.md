# Review — V4-L.1 systemPrompt resolver

**Date:** 2026-06-25
**Slug:** v4l1-systemprompt-resolver
**Commits reviewed:** `13a4abc` (feat), `994eadf` (cycle artifacts) on `develop`
**Reviewers:** 2 independent agents (adversarial code-review + cross-validation) — proportionate to a backward-compatible type-widening slice.
**Verdict:** **READY_TO_MERGE**

## Severity matrix

| Severity | Count |
|---|---|
| BLOCKER | 0 |
| HIGH | 0 |
| MEDIUM | 0 |
| LOW | 0 |
| INFO | 6 (all confirmations, not defects) |

## Adversarial code-review (correctness / BC / guardrails) — READY_TO_MERGE

- **Composition ordering correct + fail-loud:** `compile-project-context.ts` computes `resolvedBase` (awaiting a function base) BEFORE the `!cwd` check; a throwing base propagates (no try/catch wraps it; the existing try/catch scopes only `readProjectInstructions`). No-cwd arm returns the awaited string, never the function. Matches ADR D2 + EC-1.
- **sdk-adapter handles a resolver in ALL branches:** the `@ProjectContext` branch passes the resolver base into `compileProjectContext` (param widened → composes); the `else if (base !== undefined)` branch forwards a resolver byref; `undefined` adds no key. No branch drops a resolver.
- **Backward compat intact:** string base flows identically (compile byref, adapter byvalue); pre-existing `m8-project-context-compile.test.ts` string tests pass unmodified.
- **D3 sub-agent carry-not-invoke is safe:** `compiled.agents` is never spread into `Agent.create` (only `...m8`), so a carried sub-agent resolver is never passed where a string is required.
- **Guardrails:** G2 (SDK executes the resolver, not agents code); G3 (no new schema; type-only import erased — no runtime dep; G1 direction unaffected). The union mirrors the SDK's own `AgentOptions.systemPrompt`.
- **Tests non-vacuous:** `.toBe(resolver)` reference-identity assertions at both boundaries; EC-1/2/3 each assert a distinct falsifiable outcome; `expectTypeOf` is a real type gate (fails pre-widening).

## Cross-validation (plan ↔ code ↔ tests) — READY_TO_MERGE

- **Coverage Matrix 6/6** genuinely addressed (G1-G6), each with file:line evidence.
- **Goal metric** test exists and asserts the resolver reference reaches `Agent.create` (byref).
- **ADRs D1/D2/D3** all match the implementation.
- **Edge cases EC-1/2/3** each have a passing test in T2.1's file.
- **All 10 plan-promised test names present**, none missing (+1 extra backward-compat test). 11 tests total, all green.
- **"No new dependency / no manifest change"** verified: `git diff HEAD~1 HEAD -- packages/agents/package.json` empty.
- **Backward-compat** proven at both compile and `Agent.create` boundaries.

## Validation state (independently re-run by reviewers)

- `npx vitest run` (packages/agents): 366 passed, 3 skipped.
- `npx tsc --noEmit -p packages/agents/tsconfig.test.json`: exit 0.
- New test files: 11/11 passing.

## Out-of-scope pre-existing debt (logged, not blocking — for PR description)

- Folder-wide eslint reports pre-existing lint debt in OTHER agents test files (none in V4-L.1 files).
- Bare `tsc --noEmit` TS6059 rootDir cross-package quirk (`../http/src`); canonical `-p tsconfig.test.json` is clean.
- `pnpm audit` HIGH `valibot` (GHSA-vqpr-j7v3-hqw9) transitive via `@theokit/ui` in fixtures, unrelated to this slice.

## Decision

No BLOCKER/HIGH/MEDIUM/LOW findings from either independent reviewer. The diff matches the plan, the plan's claims are all satisfied, and the tests prove them. **READY_TO_MERGE.**
