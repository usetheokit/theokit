# Discovery Plan: No-Progress Signature — Stuck-Loop Detection Prior Art

> **Version 1.1** — investigate how reference agent harnesses (opencode, codex) detect a stuck / no-progress agent loop, and what the per-round "no-progress" fingerprint should key on (tool-call set vs assistant narration text). Output: a blueprint that locks the design of the `theokit#53` fix to `@theokit/agents` `run-reflective-loop.ts` `roundSignature`.
>
> **v1.1 (2026-06-30)** — absorbed edge-case review MUST-FIX: corrected Q3 test path (`test/cli/run/...`, not `src/cli/cmd/run/...`); Q2 codex source labeled as spec/convention.

**Slug:** `no-progress-signature-stuck-loop`
**Owner:** usetheodev
**Created:** 2026-06-30
**Time budget:** 1.5h (opencode 1.0h, codex 0.5h — ADR D1)

## Context

theokit#53 (live-reproduced): `@theokit/agents@0.24.0` `run-reflective-loop.ts` builds its no-progress fingerprint with `roundSignature(toolCalls, text)` (line 117) — the tool-call set **plus the assistant narration text** — and terminates after `NO_PROGRESS_THRESHOLD = 2` (line 82) consecutive equal signatures. Observed live (deepseek-v3.2, theocode): 7 rounds / 12 tool-calls re-running an identical `write_file`+`shell_exec` while the narration drifted ("Vou criar… e executá-lo." → "… Agora vou executar…"), so consecutive signatures differed → `no_progress` never fired → spin until the model self-stopped. Evidence: theokit#53. This discovery locks WHAT the fingerprint must key on before we touch the loop (per `rules/cycle-plan.md`: discover prior art before designing). Governing rules: `rules/architecture.md` (loop owns terminal decisions; SDK owns the model call), `rules/testing.md` (deterministic regression test for the bug).

## Objective

Decide what the no-progress fingerprint keys on, and the threshold, grounded in ≥2 independent reference harnesses. Success criteria for the blueprint:

- [ ] All research questions answered with citations to `.claude/knowledge-base/references/`
- [ ] Cross-cutting comparison table (opencode vs codex vs current theokit) populated
- [ ] ≥1 concrete decision proposal per research question (fingerprint key, threshold, loop position)
- [ ] `/discover-confidence` verdict ≥ SHIPPABLE_WITH_CAVEATS

## In-Scope / Out-of-Scope

### In-Scope (per reference project)

| Project | In-scope subdirectories | Reason |
|---|---|---|
| `.claude/knowledge-base/references/opencode/` | `packages/opencode/src/session/`, `packages/opencode/src/cli/cmd/run/`, `packages/core/src/v1/config/`, `packages/core/src/session/runner/` | opencode ships an explicit "doom_loop" detector (repeated tool calls with identical input) — the closest analog to theokit#53 |
| `.claude/knowledge-base/references/codex/` | `codex-rs/ext/goal/src/` | codex's `blocked` status fires only after the same blocking condition repeats ≥3 consecutive turns — an independent consecutive-repeat detector |

### Out-of-Scope (explicit)

| Project / Subdir | Why excluded |
|---|---|
| `.claude/knowledge-base/references/opencode/packages/app/`, `*/i18n/` | UI strings, not detection logic |
| `.claude/knowledge-base/references/codex/codex-rs/{tui,exec-server,codex-client}/` | TUI / transport / proxy — `loop`/`too many` matches there are runloops + stream caps, not agent stuck-loop detection |
| `.claude/knowledge-base/references/*/{dist,build,node_modules,target}/` | Build artifacts |
| Any reference NOT under `.claude/knowledge-base/references/` | Cross-Project Rule: never claim a feature without reading its source |

## ADRs

### D1 — Time budget + stop conditions

**Decision:** opencode 1.0h (primary analog — has the exact feature), codex 0.5h (secondary — confirms the consecutive-repeat threshold pattern).

**Rationale:** opencode's `doom_loop` is a direct, shipped implementation of the theokit#53 fix; it earns the deepest dive. codex confirms the convergent "≥3 consecutive identical" threshold from a second, independent codebase, satisfying the ≥2-reference rule (`cycle-discover` anti-pattern: never stop at one source). A third reference is unnecessary — two convergent implementations is sufficient signal for a pure-logic fingerprint change.

**Alternatives considered:** equal split (rejected — codex's relevant surface is one file); single-source opencode-only (rejected — violates ≥2-reference rule).

**Stop condition — per question:** Fase A empty after 3 query-variant retries → mark question BLOCKED ("Fase A exhausted"), continue. **Per project:** budget exhausted → mark remaining questions BLOCKED ("budget exhausted"), continue. Never fabricate a Fase B answer (Unbreakable Rule 3).

**Consequences:** the halt-loop stops on budget; blocked questions surface in the blueprint as next-discovery seed.

### D2 — Investigation depth

**Decision:** Read each detection hotspot end-to-end (the detector function + its threshold constant + its call-site in the turn loop). Grep/ast-grep to locate; Read to capture intent + threshold + position.

**Rationale:** the fix hinges on three facts per reference — (a) WHAT the fingerprint keys on, (b) the threshold N, (c) WHERE in the loop the check runs. All three need the surrounding code, not just a symbol match.

**Consequences:** narrow but deep; we do not catalog unrelated session machinery.

### D3 — Dependencies corner is in-scope, not deferred

**Decision:** Keep a real Dependencies question (Q5) rather than ADR-defer it.

**Rationale:** the fix must not add a dependency (Unbreakable Rule 9 / KISS); confirming both references implement dedup with the stdlib (`JSON.stringify` / Rust std) is a positive finding that locks "no new dep" into the plan. Cheaper to confirm than to assume.

## Research Questions

| # | Question | Corner | Reference project(s) | Fase A (broad — grep/ast-grep map) | Fase B (deep — Read at each hotspot) | Expected answer shape |
|---|---|---|---|---|---|---|
| Q1 | What does opencode's `doom_loop` detector key its repeat-fingerprint on — tool name + input only, or also the assistant text? | techniques | `.claude/knowledge-base/references/opencode/packages/opencode/src/session/processor.ts` | `grep -n "doom\|DOOM_LOOP_THRESHOLD\|JSON.stringify(.*input)" processor.ts` (hotspots: line 35 constant, ~522-539 detector) | Read `processor.ts:515-545` — capture exactly which fields the equality compares and whether any narration/text is included | Prose + `processor.ts:line` citation; explicit "keys on X, excludes Y" |
| Q2 | What threshold + counting rule does codex use to mark a goal `blocked` (consecutive-repeat detector)? | techniques | `.claude/knowledge-base/references/codex/codex-rs/ext/goal/src/spec.rs` | `grep -n "consecutive\|blocked\|three" spec.rs` (hotspots: lines 66, 77, 78) | Read `spec.rs:60-80` — capture the N, what counts as a "turn", reset-on-resume semantics. **Label honestly: this is a spec/convention (goal-status text), NOT a runtime dedup algorithm** (EC-2) | Threshold N + counting rule, marked as spec-level convention + `spec.rs:line` citations |
| Q3 | How does opencode TEST the doom_loop detection (what does the test assert, with what fixture)? | tests | `.claude/knowledge-base/references/opencode/packages/opencode/test/cli/run/permission.shared.test.ts`, `.claude/knowledge-base/references/opencode/packages/opencode/test/agent/agent.test.ts` | `grep -n "doom\|repeated\|loop" test/cli/run/permission.shared.test.ts test/agent/agent.test.ts` | Read the matching test block(s) — capture the arrange (repeated identical calls) + assert (permission/abort) | Test name → fixture (repeated calls) → assertion, with `:line` |
| Q4 | WHERE in the turn loop does opencode run the doom check, and over what window (last-K parts)? | tools | `.claude/knowledge-base/references/opencode/packages/opencode/src/session/processor.ts`, `.claude/knowledge-base/references/opencode/packages/core/src/v1/config/permission.ts` | `grep -n "slice(-\|recentParts\|doom_loop" processor.ts permission.ts` | Read the slice/window logic (`processor.ts:~520`) + the config knob (`permission.ts:32`) | Loop position + window size + config surface, with `:line` |
| Q5 | Do opencode/codex pull any dependency for the repeat-detection/hash, or stdlib only? | deps | `.claude/knowledge-base/references/opencode/packages/opencode/src/session/processor.ts`, `.claude/knowledge-base/references/codex/codex-rs/ext/goal/src/spec.rs` | `grep -n "import\|use " processor.ts spec.rs | grep -iE "hash\|crypto\|dedup\|stringify"` (expect: none — stdlib) | Read the import/use blocks at file head | "stdlib only" confirmation OR named dep, with `:line` |

## Coverage Matrix

| Corner | Questions mapped | Status |
|---|---|---|
| Integration tests | Q3 | Covered |
| Dependencies | Q5 | Covered |
| Tools | Q4 | Covered |
| Techniques | Q1, Q2 | Covered |

**Coverage: 4/4 corners covered (100%)**

## Halt-loop Checkpoints

| Checkpoint | Assertion | Action if fails |
|---|---|---|
| Before answering Qx | the `.claude/knowledge-base/references/{...}` path declared in Fase A exists | Mark Qx BLOCKED ("path not found"), continue |
| Per-question Fase A budget | Fase A returned ≥1 hotspot OR 3 retries attempted | After 3 retries empty → BLOCKED ("Fase A exhausted"), continue |
| After answering Qx | Blueprint section under Qx has ≥1 citation | Re-iterate Qx (1 retry max) |
| Per-project time budget | budget not exhausted | When exhausted → remaining Qx BLOCKED ("budget exhausted"), advance |
| Before promising complete | all 4 coverage corners populated | Refuse promise, continue |

## Acceptance Criteria

- [ ] All research questions answered OR explicitly BLOCKED with reason
- [ ] All four coverage corners have populated blueprint sections
- [ ] Every citation points to a real `.claude/knowledge-base/references/{...}` path
- [ ] ≥1 ADR section in the blueprint synthesizes the fingerprint-key + threshold + loop-position decision
- [ ] Time budget respected
- [ ] `/discover-confidence` verdict ≥ SHIPPABLE_WITH_CAVEATS
- [ ] Blueprint saved at `.claude/knowledge-base/discoveries/blueprints/no-progress-signature-stuck-loop-blueprint.md`

## Global Definition of Done

- [ ] All phases completed (plan → edge-cases → plan-confidence → execute → confidence → improve if needed)
- [ ] Final `/discover-confidence` verdict recorded in the blueprint header
- [ ] No fabricated citations
- [ ] Coverage Matrix 100% covered
- [ ] ADRs reference ≥1 project principle/rule (Unbreakable Rule 9 / KISS for "no new dep"; `architecture.md` for loop-owns-terminal; `testing.md` for the regression test)
