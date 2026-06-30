# Review — tool-dialect-tag-stripper (theocode#32)

**Date:** 2026-06-30
**Verdict:** READY_TO_MERGE
**Commits reviewed:** `6a815a3` (T1.1 core + unit tests) · `5a0b4c2` (T2.1+T2.2 wiring + integration tests) · `0041619` (review hardening)
**Specialist agents:** architecture/SOLID · test-quality · wiring+cross-validation · stripper-correctness (4 parallel, independent)

## Severity matrix (consolidated)

| Severity | Count | Status |
|---|---|---|
| BLOCKER | 0 | — |
| HIGH | 0 | — |
| MEDIUM | 1 | **FIXED in `0041619`** |
| LOW | 4 | 3 FIXED in `0041619`; 1 accepted |
| INFO | 5 | accepted / clarified |

## Dimension verdicts (per agent)

- **architecture/SOLID:** PASS — SRP intact (single-purpose module + cohesive helpers), G1 dependency direction respected (imports only the in-repo `StreamEvent` type), G2 no direct LLM call, G6 `createSdkAgentStream` brought back under the 120-line budget, G10 honest enforcement confirmed (flag gates a real transform).
- **test-quality:** PASS — EC-1..EC-4 all mapped, deterministic (hoisted mock, no clock/RNG), error-flush asserted specifically (buffered tail flushed BEFORE the throw), behavior-not-implementation. One MEDIUM branch gap raised → FIXED.
- **wiring+cross-validation:** PASS — full production trace `AgentRunner.stream → createSdkAgentStream → applyTextTransforms → stripToolDialectStream` confirmed live; all 5 dual compiled+per-run links present (no silently-inert path); ADRs D1/D2/D3 all hold; Coverage Matrix 14/14 maps to real tests/code; compose order matches the plan.
- **stripper-correctness:** PASS — could not break the lossless invariant; OPEN/CLOSE straddles (incl. 3+-chunk) carry correctly; no off-by-one in `heldPrefixLength`; no infinite-loop path; EC-5 early-close acceptable and not worse than documented.

## Findings & disposition

### MEDIUM-1 (test-quality) — `end()` text-mode held-OPEN-prefix flush branch uncovered — FIXED
The `: buffer` arm of `tool-dialect-stripper.ts:104` (a held OPEN-prefix flushed as text on stream end, text mode) had no assertion, while the stripping-mode arm did. The precedent (`think-tag-extractor.test.ts:90`) had the symmetric test; the stripper suite had dropped it, slightly overstating the "every branch covered" claim.
→ **Fixed:** added `test_stripper_unclosed_open_prefix_flushed_as_text` (`run('hi<func')` → write emits `'hi'`, `end()` flushes `'<func'` as text). The one uncovered branch is now asserted; the qualitative coverage claim is literally true.

### LOW-1 (correctness) — EC-5 embedded-close early-close neither documented in the module nor tested — FIXED
The accepted best-effort limit (a `</tool_call>` inside a leak closes the strip early) was only in the plan/edge-case report, not pinned in the module or a test → a future refactor could regress it unnoticed.
→ **Fixed:** added `test_stripper_embedded_close_early_closes_then_text` + a docstring note in `tool-dialect-stripper.ts` naming the pinning test.

### LOW-2 (correctness) — 3+-chunk OPEN straddle untested — FIXED
Only the 2-chunk OPEN split was covered. → **Fixed:** `test_stripper_open_split_three_chunks` (`['<fun','cti','on=w></tool_call>z']` → `'z'`).

### LOW-3 (correctness) — stripping-mode held-CLOSE-prefix-then-mismatch untested — FIXED
→ **Fixed:** `test_stripper_stripping_mode_close_prefix_then_mismatch_flushed` (lossless flush of an unconfirmed leak).

### LOW-4 (architecture) — `heldPrefixLength` duplicated between think-tag-extractor and tool-dialect-stripper — ACCEPTED
Byte-identical 6-line helper in two modules. Acceptable under Rule of 3 (2 callers) and an explicit plan decision (T1.1: "do not over-abstract for two callers"). Count is now 2/3 — a 3rd dialect opener should trigger extraction to a shared bridge util. No action now.

### INFO (accepted / clarified)
- **(wiring) orchestrator `delegate` does not forward per-run `stripToolDialect`** — but the COMPILED `@Agent({stripToolDialect:true})` flag still works on that path; only the per-run override doesn't reach sub-agents. Mirrors `parseThinkTags`/`reasoningEffort` EXACTLY (same pre-existing scope boundary). Not a regression, not a gap for this feature's declared scope (AgentRunner.stream / RuntimeOverrides).
- **(correctness LOW-2 re stripToolDialectStream tests)** — the transform-level behaviors (non-string guard, error-flush, passthrough) ARE tested, in the INTEGRATION file (`sdk-adapter-tool-dialect.test.ts` EC-1/EC-2/EC-4); the correctness agent inspected only the unit file. No gap.
- **(test) RED-first not git-provable** — test + impl co-committed per phase; RED is logically inferable (unit imports a then-nonexistent export; wiring tests fail unwired) and was confirmed RED→GREEN during implementation, but not isolated in a separate commit. Accepted.
- **(architecture) `Segment.kind` single-value union** — retained for shape-parity with the think-tag `Segment`. Defensible readability call.
- **(wiring) plan doc drift** — plan prose says `AgentRunStreamOptions`; actual interface is `AgentRunnerRunOptions`. Cosmetic; code correct.

## Gate evidence (post-hardening)

- Full `@theokit/agents` suite: **508 passed, 3 skipped, 0 failed** (+22 for this feature: 14 unit + 8 integration).
- `tsc --noEmit -p packages/agents/tsconfig.test.json`: exit 0.
- `eslint --max-warnings=0` (all changed files): exit 0 (`createSdkAgentStream` under 120-line budget).
- Wiring triad: (a) production caller confirmed, (b) integration test confirmed, (c) N/A (no new metric).
- CHANGELOG `[Unreleased]` updated.
- Coverage gate: SKIPPED — pre-existing monorepo vitest/coverage-v8 version skew (vitest@3.2.6 vs coverage-v8@4.1.9), unrelated to this change; covered qualitatively by exhaustive branch-level test design (every branch now has a dedicated test after the hardening commit).

## Verdict

**READY_TO_MERGE** — 0 BLOCKER / 0 HIGH. The single MEDIUM + 3 actionable LOW findings were FIXED in `0041619` (not merely documented); the remaining LOW (DRY dup) and 5 INFO are accepted with rationale. The change closes theocode#32 at root cause (STRIP the leaked Hermes dialect, never parse — ADR D1), is covered by 22 deterministic tests across every branch, preserves all existing behavior (full suite green, default-off byte-identical), adds no dependency, and mirrors the proven `parseThinkTags` opt-in pattern exactly. The one un-runnable gate (coverage) is an environmental tooling skew with no relation to this change.

Next: `/release` (opens develop→main PR with semver tag; human approves merge), then theocode adopts the bumped `@theokit/agents` (enable `stripToolDialect` on the qwen path) to close theocode#32.
