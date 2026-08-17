# Review — V4-Q AgentRunner accepts pre-built SDK tools

**Date:** 2026-06-26 · **Slug:** v4q-runner-sdk-tools · **Commit:** 6ec6124 (+ plan-wording + combined-test fix)
**Reviewers:** 1 adversarial (V4-Q is a minimal additive mirror of V4-J/V4-O). **Verdict: READY_TO_MERGE**

## Severity matrix (after remediation)
| BLOCKER | HIGH | MEDIUM | LOW | INFO |
|---|---|---|---|---|
| 0 | 0 | 0 | 0 (all resolved) | 0 |

## Adversarial — READY_TO_MERGE
- Backward-compat CONFIRMED: `...(overrides.sdkTools ?? [])` → absent ⇒ byte-identical compiled-only array; both option fields optional → no caller breaks; `test_absent_sdktools_is_compiled_only` proves it.
- Raw forward by reference CONFIRMED: sdkTools spread directly, never through `defineTool`; proven non-tautologically (mock `defineTool` stamps `__defined`; test asserts `toContain(fakeTool)` + `fakeTool.__defined === undefined`). Re-defineTool would corrupt a JSON-Schema CustomTool — correctly avoided.
- Types CONFIRMED: `CustomTool` `import type` in both files; SDK's public tool type; tsc 0.
- G6 CONFIRMED: sdk-adapter 305 LoC (<500); eslint 0.
- Suite: runner-sdk-tools 3 passed; full agents suite 408 passed / 3 skipped.

## Findings — RESOLVED
- **LOW (plan-prose inaccuracy):** the Drawbacks table claimed "the SDK validates tool-name uniqueness at create" — FALSE. The SDK resolves tools first-match-wins (`tools.find(t => t.name === ...)`, `@theokit/sdk@2.9.0 dist/index.js:11285`); a colliding name silently shadows the appended sdkTool (compiled wins, being first). **Fixed:** plan Drawbacks reworded to the accurate first-match-wins semantics (same as the existing `tools` override; not introduced by V4-Q).
- **LOW (test coverage gap):** no case combined `tools` (replace) + `sdkTools` (append). **Fixed:** added `test_sdktools_append_after_run_options_tools_override` (asserts the overridden compiled tool is `defineTool`'d AND the sdkTool is forwarded raw — 3/3 green).

## Decision
No BLOCKER/HIGH/MEDIUM; both LOWs remediated. **READY_TO_MERGE.** Closes the last tool-sourcing gap for theocode's loop adoption — `AgentRunner.stream()` can now host an app whose tools come from imperative SDK factories.
