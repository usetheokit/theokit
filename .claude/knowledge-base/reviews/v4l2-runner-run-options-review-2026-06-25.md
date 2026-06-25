# Review — V4-L.2 runner run-options

**Date:** 2026-06-25
**Slug:** v4l2-runner-run-options
**Commits reviewed:** `b1c6a71` (feat), `c250d4e` (doc), `7410851` (review M1 fix) on `develop`
**Reviewers:** 2 independent agents (adversarial code-review + cross-validation).
**Verdict:** **READY_TO_MERGE**

## Severity matrix (after M1 remediation)

| Severity | Count |
|---|---|
| BLOCKER | 0 |
| HIGH | 0 |
| MEDIUM | 0 (M1 resolved — see below) |
| LOW | 2 (cosmetic, accepted) |
| INFO | several (confirmations) |

## Adversarial code-review — READY_TO_MERGE

- **maxIterations correctness:** `resolveLoopStrategy(this.loopStrategy.name, opts.maxIterations)` preserves the strategy name, produces `step_limit` at the overridden ceiling, and NEVER mutates the build-time `this.loopStrategy` (fresh object per overridden call — concurrent-call safe). The `opts.maxIterations != null` guard correctly lets `0` through to the zod `min(1)` validator (fail-loud), distinguishing "no override" (`null`/`undefined`) from an invalid `0`.
- **model merge:** all three combos correct (opts set / compiled-only / neither→default); no double-fallback defect.
- **cwd threading:** `m8.local = { ...m8.local, cwd }` correctly preserves an existing `settingSources` (now locked by a test — see M1).
- **Backward compat:** `{ apiKey }`-only and V4-J `tools`-only paths unchanged.
- **Guardrails:** G2 (SDK still the only runtime; cwd merely forwarded), G8 (no `process.cwd()` in agents/src), G6 (sizes under budget), DRY (reuses `resolveLoopStrategy`).
- **Test quality:** the ceiling test is load-bearing (build-time ceiling 8 vs asserted 3; unique `round-${i}` text prevents `no_progress` masking `step_limit`); compose test exercises all four overrides; unit test proves fail-loud on `0` AND `-3`.

### MEDIUM M1 (RESOLVED)
- **Finding:** no regression test for skills + cwd coexistence in `local` (settingSources + cwd both present) — correct-by-inspection but unlocked.
- **Remediation:** added `test_cwd_override_preserves_skills_settingSources_in_local` (commit `7410851`) — a `@Skills` agent + cwd override asserts `local.settingSources === ['project']` AND `local.cwd === '/proj'`. A future clobbering refactor now fails a test.

### LOW (accepted, not blocking)
- **L1:** model fallback tail in the adapter (`?? compiled.model`) is unreachable when called via `stream()` (envModel already absorbed it) — harmless, preserves the adapter's standalone contract (plan Drawback #1).
- **L2:** `M8CreateOptions.local.settingSources?: string[]` is wider than the SDK's `SettingSource[]` — pre-existing, invisible at runtime (duck-typed `Agent.create`).

## Cross-validation — READY_TO_MERGE

- **Coverage Matrix 7/7** genuinely addressed (G1-G7), each with file:line evidence.
- **Goal metric:** all three sub-claims asserted (model→Agent.create, cwd→Agent.create.local, loop stops at overridden ceiling).
- **ADRs D1/D2/D3** all match the implementation.
- **Edge cases EC-1 (compose), EC-2 (simple-chat no-op)** each have a passing test.
- **All plan-promised test names present** (+ a bonus `-3` negative case for fail-loud).
- **"No new dependency / no manifest change"** verified: `git show b1c6a71 --stat` touches no package.json.
- **Backward compat** + **V4-J `tools` preserved** both proven.
- **Full suite:** 375 passed, 3 skipped (was 366; +9 after M1).

## Validation state

- `npx vitest run` (packages/agents): 375 passed, 3 skipped.
- `npx tsc --noEmit -p packages/agents/tsconfig.test.json`: exit 0.
- Lint on changed files: exit 0.

## Out-of-scope pre-existing debt (logged, not blocking)

- Folder-wide eslint debt in other agents tests; bare-`tsc` TS6059 rootDir quirk; transitive `valibot` HIGH via `@theokit/ui` in fixtures (deps-audit).

## Decision

After M1 remediation, no BLOCKER/HIGH/MEDIUM findings remain from either reviewer. The diff matches the plan + ADRs D1/D2/D3; all claims are proven by tests. **READY_TO_MERGE.**
