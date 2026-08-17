---
slug: no-progress-signature-tool-calls-only
created_at: 2026-06-30
goal: Make the reflective loop's no_progress detector fire on repeated identical tool calls regardless of narration drift, by keying roundSignature on tool-calls only.
---

# Plan: No-Progress Signature Keys on Tool-Calls Only (theokit#53)

> **Version 1.1** — `@theokit/agents` `run-reflective-loop.ts` builds its no-progress fingerprint from the tool-call set **plus the assistant narration text**, so a model that re-runs identical tool calls while rephrasing its prose evades the `no_progress` detector and spins. This plan drops the assistant text from `roundSignature` so the fingerprint keys on tool-calls only — the shipped pattern in opencode's `doom_loop`. Expected outcome: a deterministic loop that re-runs the same tool with drifting text terminates `no_progress` within `NO_PROGRESS_THRESHOLD` rounds.
>
> **v1.1 (2026-06-30)** — absorbed edge-case review: EC-1 SHOULD TEST (negative test uses explicit `maxIterations=3` → asserts `step_limit`, deterministic). Added `## Dependencies` (no new deps — D3).

## Goal

> Enable the `@theokit/agents` reflective loop to terminate a stuck agent that re-runs identical tool calls with drifting narration, measured by a new regression test `no_progress fires on identical tool-calls despite drifting assistant text` returning `finishReason === 'no_progress'` within ≤ 2 rounds.

## Context

theokit#53, live-reproduced this session: with deepseek-v3.2 in theocode, a trivial "write a file + run it" task spun for **7 rounds / 12 tool-calls**, re-creating the same `demo_stats.py` and re-running `python3` six redundant times before self-stopping (`terminal: stop`, NOT `no_progress`). Root cause: `run-reflective-loop.ts:512` calls `roundSignature(r.toolCalls, r.responseText)` and `roundSignature` (`:117-126`) concatenates the tool-call set with the assistant text (`return \`${calls}|${text}\``). The model varied its narration each round ("Vou criar… e executá-lo." → "… Agora vou executar…"), so consecutive signatures differed → the `stuck` counter never reached `NO_PROGRESS_THRESHOLD = 2` → the safety net never engaged. The fix is to key the fingerprint on tool-calls only.

## Baseline Context (deep review of current state)

### Files that will be touched

| File | LoC today | Last commit (sha + date) | Why it exists today | Invariants to preserve |
|---|---|---|---|---|
| `packages/agents/src/loop/run-reflective-loop.ts` | 560 | `99cff17` (2026-06-30) | The multi-round reflective driver; owns terminal decisions (no_progress / step_limit / stop) | `runReflectiveLoop` + `runReflectiveLoopStream` exports unchanged; the no_progress check still runs ONLY on `TOOL_CALLS` rounds (`:511`); `stableStringify` key-sorting preserved; `NO_PROGRESS_THRESHOLD` value unchanged (D2) |
| `packages/agents/tests/unit/no-progress-signature.test.ts` (NEW) | 0 | — | (file to be created) — regression test for theokit#53 | — |

### Current callers / dependents

- **Symbol:** `roundSignature(toolCalls, text)` in `run-reflective-loop.ts:117`
  - **Callers (production):** `run-reflective-loop.ts:512` (the ONLY call site — confirmed via `grep -n "roundSignature"` → defn @117, call @512)
  - **Callers (tests):** none (internal function, not exported, not directly tested today)
  - **External (public API consumed by other repos):** no — `roundSignature` is a module-private function; not in any barrel. Signature change is safe.
- **Symbol:** `NO_PROGRESS_THRESHOLD` (`:82`), `prevSig`/`stuck` (`:489,512-515`) — internal loop state, no external callers.

### Domain glossary

- **roundSignature** — a per-round fingerprint used to detect a stuck loop; two consecutive equal signatures = no new progress.
- **no_progress** — a `LoopFinishReason` terminal emitted when `stuck >= NO_PROGRESS_THRESHOLD`.
- **TOOL_CALLS round** — a round whose `finishReason === 'tool-calls'` (the model called a tool and would continue); the no_progress check runs only on these (`:511`).
- **stableStringify** — key-sorted JSON serializer (`:99`) so equal inputs with re-ordered keys serialize identically.

### Architecture boundaries affected

None crossed. The change is internal to `@theokit/agents`' loop layer; per `rules/architecture.md` the loop owns the terminal decision (no SDK boundary touched). No new export, no new dependency.

## Prior Art & Related Work

- **Internal blueprint:** `knowledge-base/discoveries/blueprints/no-progress-signature-stuck-loop-blueprint.md` (SHIPPABLE_WITH_CAVEATS 89) — §"Coverage Corner 4" (opencode `doom_loop` keys on `tool name + JSON.stringify(input)`, NO text) and §"D1" (drop assistant text).
- **Reference (opencode):** `knowledge-base/references/opencode/packages/opencode/src/session/processor.ts:525-535` — the shipped detector compares `part.tool === value.name && JSON.stringify(part.state.input) === JSON.stringify(input)`, excluding narration.
- **Reference (codex):** `knowledge-base/references/codex/codex-rs/ext/goal/src/spec.rs:77` — "blocked only after the same blocking condition has repeated for at least three consecutive goal turns" (consecutive-repeat convention).

## Objective

- [ ] `roundSignature` keys on the tool-call set only (name + `stableStringify(input)`), excluding `responseText`.
- [ ] A RED regression test proves identical tool-calls + drifting text → `no_progress` within ≤ 2 rounds.
- [ ] A test proves DIFFERENT tool inputs across rounds do NOT trigger `no_progress` (no false positive).
- [ ] A test proves a text-only round (no tool calls) terminates `stop`, never `no_progress` (edge-case guard already at `:511`).
- [ ] Full `@theokit/agents` suite green; tsc + eslint clean; CHANGELOG updated.

## ADRs

### D1 — `roundSignature` keys on tool-calls only (drop the `text` parameter)

**Decision:** remove `responseText` from the fingerprint; signature = sorted `name:stableStringify(input)` joined.

**Rationale:** opencode's shipped `doom_loop` (`processor.ts:531`) compares only tool name + serialized input, deliberately excluding narration. Including text (current bug) is defeated by trivial prose drift — proven live (7-round spin). Reuses existing `stableStringify` (Unbreakable Rule 9 / KISS — no new dep). The loop owns the terminal decision (`rules/architecture.md`).

**Alternatives considered:** (a) normalize/strip the text before hashing — rejected: any rephrase still evades, fragile; (b) embedding-similarity on text — rejected: new dep, non-deterministic, violates `rules/testing.md` determinism + KISS.

**Consequences:** enables no_progress to catch repeated-tool spin; a model that genuinely varies tool *inputs* each round is still (correctly) treated as making progress.

### D2 — Keep `NO_PROGRESS_THRESHOLD = 2`

**Decision:** do not raise to 3.

**Rationale:** opencode/codex use 3, but theokit's signature is round-based (a full SDK turn), coarser than opencode's part-based window; `stableStringify` is key-order-insensitive (fewer false negatives). K=2 catches the spin one round earlier with negligible false-positive risk (two identical full rounds is already strong evidence). Locked by the discovery blueprint ADR D2 (`.claude/knowledge-base/discoveries/blueprints/no-progress-signature-stuck-loop-blueprint.md`).

**Alternatives considered:** raise to 3 (matches refs but wastes a round on round-based granularity) — rejected; make configurable now — rejected (YAGNI, no caller asked).

**Consequences:** spin terminated at the 2nd identical round; constant trivially tunable later.

### D3 — No new dependency; reuse `stableStringify`

**Decision:** the fix uses the existing in-file `stableStringify` (`run-reflective-loop.ts:99`); no library added or imported.

**Rationale:** opencode dedups with native `JSON.stringify`; theokit already ships the superior key-sorted `stableStringify`. Adding a dependency for hashing/serialization would violate Unbreakable Rule 9 (Don't Reinvent) + KISS.

**Alternatives considered:** add a fast-hash dep (e.g., `object-hash`) — rejected (unnecessary; `stableStringify` already exists and is key-order-insensitive); inline a new serializer — rejected (DRY: `stableStringify` is the canonical one).

**Consequences:** zero dependency surface (confirmed by `/deps-audit` PASS); the fix is pure in-file logic.

## Drawbacks & Risks

| Drawback / Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| A model that legitimately re-issues the SAME tool+input across 2 rounds (e.g., a poll that is expected to repeat) would now terminate no_progress | Low | Repeating an identical tool call with identical input IS the definition of no-progress for this loop; legitimate polling varies input (cursor/timestamp) → different signature. Documented in D1 consequences. | framework |
| Dropping `text` from the signature is a behavior change to a terminal-decision heuristic | Low | Covered by 3 new deterministic tests (positive, negative, text-only); full suite re-run; internal function with single call-site (no external contract) | framework |

## Unresolved Questions

(none — every decision is resolved at plan time; the fingerprint key, threshold, and edge-case behavior are all locked by the blueprint and the `:511` gate.)

## Dependency Graph

```
Phase 1 (fix + TDD) ──▶ Phase 2 (Integration Validation)
```

Sequential; single small change.

---

## Phase 1: Key the no-progress signature on tool-calls only

**Objective:** drop the assistant text from `roundSignature` so repeated identical tool calls trip `no_progress` regardless of narration drift.

### T1.1 — Remove `responseText` from the no-progress fingerprint

#### Objective
`roundSignature` returns a fingerprint derived from the tool-call set only; the no_progress detector fires on repeated identical tool calls despite drifting prose.

#### Why this step (action + reasoning)

1. **What this step does** — changes `roundSignature` to stop concatenating the assistant `text` (drop the parameter; signature = the sorted `calls` string), updates the single call-site at `:512`, and updates the function doc comment; adds the RED regression test first.
2. **Why it is necessary now** — this is the exact root cause of theokit#53 (D1). The call-site at `:512` passes `r.responseText` into the fingerprint; every other piece of the machinery (`prevSig`, `stuck`, `NO_PROGRESS_THRESHOLD`, the `:511` TOOL_CALLS gate) is already correct. The minimal, root-cause fix is to stop polluting the fingerprint with narration.

#### Evidence
- `run-reflective-loop.ts:124` — `return \`${calls}|${text}\`` (text in the fingerprint — the bug).
- `run-reflective-loop.ts:512` — `const sig = roundSignature(r.toolCalls, r.responseText)` (the single call-site passing text).
- `run-reflective-loop.ts:511` — `if (r.finishReason === TOOL_CALLS) {` (the check runs ONLY on tool-call rounds → text-only rounds already safe).
- Discovery blueprint ADR D1 (`.claude/knowledge-base/discoveries/blueprints/no-progress-signature-stuck-loop-blueprint.md`) + opencode `processor.ts:531` (no text in the fingerprint).
- Live repro: theokit#53 (7 rounds / 12 tool-calls).

#### Files to edit
```
packages/agents/src/loop/run-reflective-loop.ts — roundSignature drops `text`; call-site @512 updated; doc comment @110-115 updated
packages/agents/tests/unit/no-progress-signature.test.ts — RED regression tests added first (TDD)
```

#### Deep file dependency analysis
- `run-reflective-loop.ts` (Baseline row 1): `roundSignature` is module-private, single caller at `:512`. Changing its arity is safe — no barrel export, no external consumer (Baseline § Current callers). The `prevSig`/`stuck` comparison logic (`:512-515`) is unchanged; only the value it compares changes. Downstream: none (internal).
- `no-progress-signature.test.ts` (NEW): imports `runReflectiveLoop` + `resolveLoopStrategy` + `ladderReflectionStrategy` from the package src (same pattern as `tests/unit/loop-step-cap-force-close.test.ts`), drives a fake `RoundStreamFactory`.

#### Deep Dives
- **Algorithm:** `roundSignature(toolCalls)` → `toolCalls.map(tc => \`${tc.name}:${stableStringify(tc.input)}\`).sort().join(',')`. No `|text` suffix.
- **Invariant preserved:** the no_progress check still runs only on `TOOL_CALLS` rounds (`:511`); a round with zero tool calls has `finishReason==='stop'` and never reaches the check — so text-only "thinking aloud" is never falsely flagged.
- **Edge case (empty tool calls on a TOOL_CALLS round):** if `toolCalls` is empty the signature is the empty string `''`; two consecutive empty-tool TOOL_CALLS rounds would match — but a `TOOL_CALLS` finishReason implies ≥1 tool call by construction (`deriveFinishReason`), so this is not reachable. Documented, not guarded (YAGNI).

#### Pseudo-code / Signatures
```pseudocode
function roundSignature(toolCalls: {name, input}[]): string
  return toolCalls
    .map(tc => `${tc.name}:${stableStringify(tc.input)}`)
    .sort(localeCompare)
    .join(',')

# call-site (:512)
const sig = roundSignature(r.toolCalls)   # was: roundSignature(r.toolCalls, r.responseText)

# Example (the bug scenario)
round1 toolCalls=[write_file:{path:"a.py",content:"X"}] text="Vou criar e executar"  -> sig="write_file:{...}"
round2 toolCalls=[write_file:{path:"a.py",content:"X"}] text="Agora vou executar"     -> sig="write_file:{...}"  (EQUAL → stuck=1)
round3 (same)                                                                          -> sig EQUAL → stuck=2 >= THRESHOLD → no_progress
```

#### Tasks
1. Add `tests/unit/no-progress-signature.test.ts` with the 3 RED tests below.
2. Run them — confirm the positive test FAILS on current code (proves the bug).
3. Edit `roundSignature` (`:117-126`): drop the `text` param, return `calls`.
4. Update the call-site (`:512`): `roundSignature(r.toolCalls)`.
5. Update the doc comment (`:110-115`): remove "plus the assistant text"; state "keys on tool-calls only (theokit#53)".
6. Re-run the tests — all GREEN.

#### TDD
```
RED:     test "no_progress fires on identical tool-calls despite drifting assistant text" — fake factory yields the SAME tool_call (read,{}) with DIFFERENT text each round; assert result.finishReason === 'no_progress' AND result.rounds <= 3. FAILS on current code (text drift → no match).
RED:     test "different tool inputs across rounds run to step_limit, not no_progress" — resolveLoopStrategy('plan-act-reflect', 3) + factory yields `read` with input {n: round} each round (distinct signatures); assert finishReason === 'step_limit' AND finishReason !== 'no_progress'. Bounded maxIterations=3 makes the assertion deterministic (EC-1, edge-case review). Guards against false positives.
RED:     test "a text-only round terminates stop, never no_progress" — factory yields a round with text only, no tool calls; assert finishReason === 'stop'. Confirms the :511 gate.
GREEN:   Drop `text` from roundSignature + update call-site.
REFACTOR: None expected (one-line signature change).
VERIFY:  pnpm --filter @theokit/agents exec vitest run tests/unit/no-progress-signature.test.ts
```

#### Concurrency tests
(none — single-threaded). `runReflectiveLoop` is a sequential async generator; no shared mutable state across rounds beyond the local `stuck`/`prevSig` closure vars.

#### Acceptance Criteria
- [ ] The positive regression test FAILS before the fix and PASSES after (proven RED→GREEN).
- [ ] Negative test (varying input) does NOT trigger no_progress.
- [ ] Text-only-round test terminates `stop`.
- [ ] Pass: lint — `npx eslint packages/agents/src/loop/run-reflective-loop.ts` zero warnings.
- [ ] Pass: typecheck — `npx tsc --noEmit -p packages/agents/tsconfig.test.json` exit 0.
- [ ] Pass: size — `run-reflective-loop.ts` stays < 500 LoC (currently 560 → exceeds; net change is ~0 lines, pre-existing, not introduced here — noted, not regressed).
- [ ] CHANGELOG `[Unreleased]` updated with a `Fixed` entry citing theokit#53.

#### DoD (Definition of Done)
- [ ] All tasks completed and validated
- [ ] Full `@theokit/agents` suite green (no regression to step_limit / no_progress / continuation tests)
- [ ] Changeset added (`@theokit/agents` patch)

---

## Phase 2: Integration Validation

**Objective:** prove the fix is complete and regression-free end-to-end.

### T2.1 — Full validation gate

#### Objective
The full agents suite, typecheck, lint, and build pass with the fix in place.

#### Why this step (action + reasoning)
1. **What this step does** — runs the full `@theokit/agents` test suite + tsc + eslint + the package build (tsup DTS).
2. **Why it is necessary now** — `roundSignature` is a terminal-decision heuristic; a regression here changes loop behavior silently. The full suite + build is the "eat your own cooking" gate (and the pre-push gate from theokit#51 will run it on push).

#### Evidence
- Existing no_progress-adjacent tests: `tests/integration/reflective-loop-wiring.test.ts`, `tests/unit/main-loop-runtime.test.ts` (must stay green).

#### Files to edit
```
(none — validation only)
```

#### Deep file dependency analysis
(validation phase — exercises the Phase 1 change against the whole suite.)

#### Deep Dives
(none — gate execution.)

#### Tasks
1. `pnpm --filter @theokit/agents test` → all green.
2. `npx tsc --noEmit -p packages/agents/tsconfig.test.json` → exit 0.
3. `npx eslint packages/agents/src/loop/run-reflective-loop.ts packages/agents/tests/unit/no-progress-signature.test.ts --max-warnings=0`.
4. `pnpm --filter @theokit/agents build` → tsup DTS success (the theokit#51 pre-push gate).

#### TDD
```
RED:     (n/a — validation phase)
GREEN:   (n/a)
REFACTOR: None
VERIFY:  pnpm --filter @theokit/agents test && npx tsc --noEmit -p packages/agents/tsconfig.test.json
```

#### Concurrency tests
(none — single-threaded)

#### Acceptance Criteria
- [ ] `@theokit/agents` full suite green (0 failures).
- [ ] tsc exit 0; eslint 0 warnings.
- [ ] `pnpm --filter @theokit/agents build` succeeds (DTS).

#### DoD (Definition of Done)
- [ ] All gates green; ready for `/code-quality` + `/review`.

## Coverage Matrix

| Goal claim / requirement | Task |
|---|---|
| roundSignature keys on tool-calls only (drop text) — D1 | T1.1 |
| Regression: identical tool-calls + drifting text → no_progress | T1.1 (RED test 1) |
| No false positive on varying tool input | T1.1 (RED test 2) |
| Text-only round → stop (edge guard) | T1.1 (RED test 3) |
| Keep NO_PROGRESS_THRESHOLD=2 — D2 | T1.1 (unchanged constant; asserted via rounds<=3) |
| Full suite + types + lint + build green | T2.1 |
| CHANGELOG updated | T1.1 DoD |

**Coverage: 7/7 requirements mapped (100%)**

## Dependencies

### Existing — use as-is

| Package | Version | Ecosystem | Why |
|---|---|---|---|
| (none changed) | — | npm | The fix reuses the in-file `stableStringify` (`run-reflective-loop.ts:99`); no import added or changed. |

### New — to be introduced

| Package | Version | Ecosystem | Rule 9 rationale | Why this one |
|---|---|---|---|---|
| (none) | — | — | ADR D3: opencode dedups with native `JSON.stringify`; theokit already ships the superior key-sorted `stableStringify`. Adding a dep would violate Unbreakable Rule 9 / KISS. | — |

### Removed

| Package | Last version | Why removed |
|---|---|---|
| (none) | — | — |

## Failure scenarios

(none — no external I/O touched; the loop change is pure in-memory fingerprint logic exercised by fake `RoundStreamFactory`.)

## Global Definition of Done

- [ ] All phases complete; Coverage Matrix 100%.
- [ ] `roundSignature` keys on tool-calls only; single call-site updated; comment updated.
- [ ] 3 new deterministic tests (positive RED→GREEN, negative, text-only); full agents suite green.
- [ ] tsc 0, eslint 0, build (DTS) success.
- [ ] CHANGELOG `[Unreleased] § Fixed` entry citing theokit#53; `@theokit/agents` changeset (patch).
- [ ] No new dependency (D3); `stableStringify` reused.
