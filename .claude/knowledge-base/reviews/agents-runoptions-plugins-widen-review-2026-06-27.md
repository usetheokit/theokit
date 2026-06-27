# Review — agents-runoptions-plugins-widen (RADAR #90-B)

**Date:** 2026-06-27 · **Slug:** agents-runoptions-plugins-widen · **Commit:** `20338f5`
**Reviewer:** independent verification (backward-compat + gate-premise focus). **Verdict: READY_TO_MERGE**

## Gates
- `npx tsc --noEmit` (monorepo): **0 errors** — THE proof the union compiles against the installed `@theokit/sdk@2.9.0` (the gate-premise I had over-claimed; the duck-typed forward makes it compile without the #90.3a publish).
- New `.test-d` type test `tests/unit/agent-runner-plugins-type.test-d.ts`: **green** (`readonly Plugin[]` assignable + `PluginsSettings` still assignable). RED→GREEN confirmed (array assertion `TS2559` before the widen).
- `eslint --max-warnings=0` on the 3 changed files: **clean** (pre-commit lint-staged passed).
- plan-confidence: **SHIPPABLE 95.2** (0 hard caps, coverage 100%, ADRs 2/2, acceptable_ratio 0.923).

## What shipped (additive, backward-compatible)
- `AgentRunnerRunOptions.plugins` (`agent-runner.ts:87`) + `CreateSdkAgentStreamOptions.plugins` (`sdk-adapter.ts:86`): `PluginsSettings` → `PluginsSettings | readonly Plugin[]`. `Plugin` imported from `@theokit/sdk` (already exported at 2.9.0). Changeset: `@theokit/agents` minor.

## Adversarial verification
- **Gate premise corrected (honesty):** I initially claimed #90-B was blocked on the #90.3a sdk publish. The Stop hook pushed back; an empirical check found the forward is duck-typed — `buildExtraCreateOptions(overrides): Record<string, unknown>` with `extra.plugins = overrides.plugins` — so the agents typecheck does NOT consume the SDK's `AgentOptions.plugins` type. `tsc 0` against `@theokit/sdk@2.9.0` proves it. The block was false; #90-B shipped without waiting.
- **Backward compat:** union widening is additive; the type test asserts `PluginsSettings` (`{ enabled }`) still assignable; `tsc 0` across the monorepo proves no existing `AgentRunnerRunOptions` caller broke.
- **Forward untouched:** `buildExtraCreateOptions` does not appear in the diff (0 occurrences) — the `Record<string, unknown>` forward is unchanged; runtime behavior identical (the SDK runtime's `extractCodePlugins` already handles the array).
- **No new runtime branch:** pure type-surface change; no concurrency/IO. `Plugin`/`PluginsSettings` reused from `@theokit/sdk` (no duplication — G3).

## Findings
- **INFO (gate over-claim, process):** the original "blocked on publish" framing was wrong; corrected via empirical probe. Recorded as a lesson (the duck-typed forward decouples the agents typecheck from the SDK option type). No code impact.
- No BLOCKER/HIGH/MEDIUM.

## Decision
Additive union widen, compiles against the installed SDK, full type test + monorepo tsc green, backward-compat asserted, forward untouched. **READY_TO_MERGE.** Next: theokit `develop → main` PR; on merge, changeset version-bump + manual publish (`@theokit/agents` minor). TheoCode (#90-C) drops its `as unknown as PluginsSettings` cast after this `@theokit/agents` publishes (and adopts #90.2/#90.4 after the @theokit/sdk + @theokit/sdk-tools publish from PR #38).
