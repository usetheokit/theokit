# Review — agents-reasoning-effort (M1)

**Date:** 2026-06-28
**Slug:** agents-reasoning-effort
**Milestone:** M1 (enable extended thinking via `reasoningEffort`)
**Plan:** `.claude/knowledge-base/plans/agents-reasoning-effort-plan.md`
**Commits reviewed:** `9c04863` (feat+tests), `bf0a250` (ADR 0034), `8787178` (review-fix refactor)
**Code-quality:** FAIL_SOFT (70) — every soft cap dismissed by ADR 0034 (pre-existing D2-TS baseline, zero new findings). `/review` may proceed per `cycle-review.md` pre-conditions.

**Verdict:** READY_TO_MERGE

No BLOCKER, no HIGH. The one MEDIUM and one LOW surfaced by the panel were fixed in `8787178` before this verdict; remaining INFOs are accepted (deliberate, documented design choices).

## Method

Three independent specialist reviewers ran in parallel against the M1 diff + plan (read-only):

1. **architecture + cross-validation** — plan↔impl↔tests fidelity, dependency direction / no cycle, SRP/DRY/KISS/DIP, barrel/public API, backward-compat.
2. **test-auditor + wiring-validator** — plan RED-test presence + exact names, edge vs negative coverage, wiring triad, determinism, live suite run.
3. **code-correctness + error-handling** — `buildModelSelection` empty-effort guard, `??` precedence, SDK `ModelParameterValue` contract match, type-safety (no `any`/`as`/`@ts-ignore`), honest enforcement (G10), typecheck.

## Findings & resolutions

| # | Severity | Finding | File:line (at review time) | Resolution |
|---|---|---|---|---|
| 1 | MEDIUM | `sdk-adapter.ts` grew to 508 LoC — breaches G6 (BLOCK at 500) **and** the plan's own `≤500` acceptance criterion; the plan's D2 rationale ("extracting the helper keeps the adapter under G6") did not hold because the helper landed inside the adapter. | `packages/agents/src/bridge/sdk-adapter.ts:1-508` | **Fixed** in `8787178` — `buildModelSelection` moved to the focused sibling `bridge/model-selection.ts` (the plan's T1.1 "or a small sibling" option). Adapter now **498 LoC**. |
| 2 | LOW | The inserted `buildModelSelection` separated the `RuntimeOverrides` JSDoc from its interface, orphaning the "Per-request overrides…" doc comment. | `packages/agents/src/bridge/sdk-adapter.ts:77-91` | **Fixed** in `8787178` — same extraction restored the doc-to-interface adjacency. |
| 3 | INFO | `tests/integration/sdk-adapter-reasoning.test.ts` is a contract/wiring test of the adapter→`getOrCreate` path (mocks the `@theokit/sdk` boundary), not an integration test against a real SDK `Agent`. | — | **Accepted.** The docstring states this; the plan defers real-provider validation to M3 (theocode live). Pyramid-classification note only. |
| 4 | INFO | `(string & {})` arm makes `ReasoningEffort` accept an arbitrary string, so a typo (`'higk'`) is accepted at compile time and only fails at SDK request-time validation. | `packages/agents/src/types.ts:10` | **Accepted.** Deliberate Rule-9/DIP choice (don't duplicate the SDK model catalog); fails loud at the SDK (not swallowed), consistent with `error-handling.md`. Mirrors the existing `AgentRunErrorCode` precedent. |
| 5 | INFO | `if (!effort)` lets a whitespace-only effort (`' '`) pass through as `value:' '`. | `bridge/model-selection.ts` | **Accepted (YAGNI).** Implausible caller input; SDK rejects it loud against its catalog. |

## Per-dimension verdicts

- **Plan cross-validation — PASS.** All 4 ADRs implemented as described: D1 (surface on `@Agent` + `AgentRunner`, `@Model` untouched), D2 (`buildModelSelection → params:[{id:'thinking',value:effort}]`), D3 (no static capability gate; SDK validates; Rule 9), D4 (precedence `override ?? compiled` at a single site, proven by `test_run_override_reasoningEffort_beats_compiled`). Coverage Matrix 6/6 verified against code.
- **Architecture — PASS.** `ReasoningEffort` lives in the `types.ts` leaf (imports only `@theokit/sdk` + `zod`, type-only); no import cycle introduced; all consumers import it from `../types.js`. New module `model-selection.ts` is a leaf (sdk barrel + types). DRY: single mapping site; single resolution site.
- **Tests / wiring — PASS.** Every plan RED test present with the exact name + correct assertion; bonus edge cases (EC-1 provider-string, override-on-plain-agent, no-effort-undefined). Wiring triad: caller threaded end-to-end to `Agent.getOrCreate`, proven by the integration test capturing `opts.model`; runtime-metric honestly N/A for a framework pass-through. Suite: **454 passed | 3 skipped** (skips are pre-existing real-LLM smoke gated on API keys). Deterministic, AAA, one-behavior-each.
- **Correctness / error-handling / type-safety — PASS.** Empty-effort guard correct (EC-2, never emits `value:''`); `??` correct (preserves a deliberate `''` per-run opt-out, falls through to compiled only on `undefined`); param shape matches SDK `ModelParameterValue` `{ id, value }` with canonical id `'thinking'` (verified against `@theokit/sdk` fixture catalog); no `any`/`as`/`@ts-ignore`; explicit public return type; knob genuinely wired (G10), not metadata-only. `tsc -p packages/agents/tsconfig.test.json` → exit 0.

## Hard gates (cycle-review)

- Tests green on `develop` ✓
- No secrets committed ✓ (secret-scan passed at each commit)
- No direct commit to `main` (work on `develop`) ✓
- No Co-Authored-By trailer ✓
- CHANGELOG `[Unreleased]` updated ✓ + changeset `agents-reasoning-effort.md` (minor) present ✓

## Outcome

READY_TO_MERGE. Release (changeset version bump + `develop→main` PR) is the separate `cycle-release` step, human-gated per Unbreakable Rule 4 — not performed here (the `/goal` stops at READY_TO_MERGE).
