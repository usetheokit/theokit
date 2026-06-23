# Review — M8 Decorator Runtime

**Date:** 2026-06-23
**Slug:** m8-decorator-runtime
**Diff:** `a670ad9~1..04d8b40` (packages/agents + deps + ADR)
**Reviewers:** 3 independent specialist agents (architecture / test+wiring / correctness+cross-validation)
**Verdict:** **READY_TO_MERGE**

## Verdict rationale

- **0 BLOCKER.** 0 unresolved HIGH. The two HIGH findings were disproven against the SDK contract; the one repeated MEDIUM was fixed.
- `cycle-review` allows `READY_TO_MERGE` with no BLOCKER and ≤ 2 HIGH (with mitigation). After resolution: 0 HIGH.

## Severity matrix (consolidated, post-resolution)

| ID | Sev (raw) | Finding | Disposition |
|---|---|---|---|
| H-1 | HIGH→**RESOLVED** | `@ProjectContext` resolver depends on `local.cwd` which the adapter never sets → "silent no-op" | **Disproven.** Verified SDK: `resolveCwd(cwd)= (...)?? process.cwd()` (`cron.js:15023`); `SystemPromptContext.cwd = inputs.workspaceCwd = resolveCwd(local?.cwd)` (`6531`, `14733`). The SDK defaults cwd to `process.cwd()` internally, so the resolver receives a real cwd at runtime. The `if(!cwd) return base` guard is defensive only. NOT a no-op. |
| H-2 | HIGH→**RESOLVED** | `@Skills` discovery needs `local.cwd` for `.theokit/skills` resolution | **Disproven, same evidence.** `settingSources:['project']` is set (EC-1); the SDK resolves the discovery root from `workspaceCwd` (defaulted to `process.cwd()`). Skills discover from the project dir at runtime. |
| M-1 | MEDIUM→**FIXED** | Dual compile path: `compileSkills`/`compileContextWindow` called in BOTH `compileAgent` and the adapter; `compiled.skills`/`.context` dead on the runtime path (G7/G12) — flagged by 2 of 3 agents | **Fixed** in `04d8b40`: `agent-compiler.ts` is now the single compile site (per `sdk-runtime.md`); `createSdkAgentStream` takes `CompiledAgentOptions` and projects skills/context/projectContext into `Agent.create`. Orchestrator + smoke test updated. |
| M-2 | MEDIUM→**ADDRESSED** | No integration test on the production caller path (orchestrator→adapter) | After M-1, the integration test does `compileAgent(walk)` → `createSdkAgentStream(compiled)` — the exact path `agent-orchestrator.ts:159` now uses. The boundary is covered. |
| M-3 | MEDIUM→**RECONCILED** | Plan/edge-case said `cwd ?? process.cwd()`; code returns base (G8) — plan↔code drift | Plan reconciled to v1.2 (D3, Q3, Drawbacks row, RED-test name updated to the shipped G8 decision). Code + test + plan + impl-summary now agree. |
| L-1 | LOW→**FIXED** | Backward-compat "byte-identical" overclaim: old path always emitted `systemPrompt` key; new omits when undefined | Added `test_adapter_absent_no_systemprompt_omits_key`; impl-summary wording softened to "behaviorally equivalent (harmless key omission)". |
| L-2 | LOW→**ACK** | repo-map fs walk per send when `@ProjectContext` present | Documented risk (lazy, char-bounded, never-throw). No action. |
| INFO | — | sdk-runtime.md fully respected; ADR 0030 direction preserved; G5/G8/G10 honest warnings; ADR 0031 sound with 3 rejected alternatives; type-safety clean (no `any`/`@ts-ignore`; justified `as Record` casts); test quality strong (AAA, deterministic, tmp cleanup, spies restored, asserts-by-code). | Positive — no action. |

## Code-quality gate

`/code-quality m8-decorator-runtime` runner verdict = `FAIL_HARD`, **fully attributable to pre-existing repo-wide mis-scoping** (28966 dead-code findings over `.claude/knowledge-base/references/**` read-only clones + the whole monorepo; the 4 symbol-fab are pre-existing fixtures/templates/test subpaths). **Zero M8-file findings** (verified by grep). See `knowledge-base/audits/m8-decorator-runtime-code-quality-2026-06-22.md`. Plan-confidence structural verdict (with the code-quality merge isolated via `--no-code-quality`) = **SHIPPABLE 93.2**, zero structural caps. Same disposition the team accepted for M7.

## Hard gates (cycle-review)

- [x] Tests green on the working branch — `pnpm --filter @theokit/agents test` → 261 passed | 3 skipped.
- [x] Typecheck clean — `tsc -p packages/agents/tsconfig.test.json` + `tsc -p packages/theo/tsconfig.json` (SDK bump regression check).
- [x] No new secrets; no direct `main` commits (all on `develop`); no `Co-Authored-By` trailer.
- [x] CHANGELOG `[Unreleased]` updated (Added + Changed, M8).

## Conclusion

All three decorators have real, SDK-executed runtime; un-mappable knobs warn honestly; dependency direction + sdk-runtime.md preserved; the lone real maintainability finding (dual compile path) is fixed. **READY_TO_MERGE.**
