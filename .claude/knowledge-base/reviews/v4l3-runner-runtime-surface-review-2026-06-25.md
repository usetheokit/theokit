# Review — V4-L.3 runner runtime surface

**Date:** 2026-06-25
**Slug:** v4l3-runner-runtime-surface
**Commits reviewed:** `61891ec` (artifacts), `47dd837` (feat) on `develop`
**Reviewers:** 2 independent agents (adversarial code-review + cross-validation).
**Verdict:** **READY_TO_MERGE**

## Severity matrix

| Severity | Count |
|---|---|
| BLOCKER | 0 |
| HIGH | 0 |
| MEDIUM | 0 |
| LOW | 1 (accepted — pre-existing, test-covered) |
| INFO | 2 |

## Adversarial code-review — READY_TO_MERGE

- **RuntimeOverrides refactor is behavior-preserving (mathematically verified):** model resolution identical across all combos — `(opts.model ?? compiled.model) ?? compiled.model ?? default ≡ overrides.model ?? compiled.model ?? default`. cwd unchanged. All call sites updated; only the legitimate 3-arg backward-compat calls remain.
- **Spread order safe:** `Agent.create({ apiKey, model, tools, ...m8, ...extra })` — `m8` (skills/context/systemPrompt/local) and `extra` (plugins/providers/agents/budgetTracker) are disjoint; `extra` never collides with apiKey/model/tools.
- **`!== undefined` guards:** `plugins: []` forwarded (proven), absent fields add no key (proven).
- **agents D3 preserved:** only `opts.agents` reaches `extra.agents`; `compiled.agents` never read — zero @SubAgents behavior change.
- **budgetTracker vs budget (D4):** `budget` not in RuntimeOverrides → flows to the outer reflective loop; `budgetTracker` → inner Agent.create. Coexistence proven.
- **Backward compat + guardrails (G2/G6/type-only imports):** all PASS. Tests non-vacuous (byref `.toBe` capture).

### LOW-1 (accepted, not blocking)
- **Finding:** `extra` is typed `Record<string, unknown>` and the adapter's local `Agent.create` type is `(opts: Record<string, unknown>)`; the SDK exports a typed create-options interface that could be used (`Partial<...>`) to catch field-name typos at compile time.
- **Disposition:** ACCEPTED. The reviewer noted this is a **pre-existing pattern the commit follows, not introduces** (the dynamic-`import('@theokit/sdk')` optional-peer boundary justifies the erased runtime type). The failure mode (a mis-named key) is already caught by the integration tests (`expect(h.captured?.plugins).toBe(PLUGINS)` would fail). Per `cycle-review.md`, LOW findings are advisory; treating them as blockers is a documented anti-pattern. Retyping the dynamic-import boundary is out of this slice's scope — noted as a future hardening opportunity.

## Cross-validation — READY_TO_MERGE

- **Coverage Matrix 7/7** addressed (G1-G7), each with code + test evidence.
- **Goal metric:** each of the four reaches `Agent.create` (byref capture asserts).
- **ADRs D1/D2/D3/D4** all match (D2 confirmed to eliminate the V4-L.2 review L1 double-fallback nit).
- **Edge cases EC-1 (budget+budgetTracker coexist), EC-2 (empty plugins array)** each have a passing test.
- **All 8 plan-promised tests present**; suite delta +8 (375→383).
- **"No new dependency / no manifest change"** verified (`git show 47dd837 --stat` touches no package.json).
- **Backward compat** + V4-J/V4-L.2 fields intact.
- **Two extra call sites** (`sdk-adapter-translation`, `m8-adapter-wiring`): typecheck-forced by the D2 signature change, honestly disclosed in the impl summary — not scope creep (INFO-1).

## Validation state

- `npx vitest run` (packages/agents): 383 passed, 3 skipped.
- `npx tsc --noEmit -p packages/agents/tsconfig.test.json`: exit 0.
- Lint on changed files: exit 0.

## Out-of-scope pre-existing debt (logged, not blocking)

- Folder-wide eslint debt in other agents tests; bare-`tsc` TS6059 rootDir quirk; transitive `valibot` HIGH via `@theokit/ui` in fixtures.

## Decision

No BLOCKER/HIGH/MEDIUM findings from either reviewer. The RuntimeOverrides refactor is behavior-preserving, all four fields forward correctly, ADRs D1-D4 hold, and tests prove reach by reference. The single LOW (typing the dynamic-import surface) is a pre-existing, test-covered advisory. **READY_TO_MERGE.**
