# Blueprint: No-Progress Signature — Stuck-Loop Detection Prior Art

**Discovery plan:** `.claude/knowledge-base/discoveries/plans/no-progress-signature-stuck-loop-plan.md` (v1.1)
**Date:** 2026-06-30
**`/discover-confidence` verdict:** SHIPPABLE_WITH_CAVEATS (89) — soft_floor_citation_density_low only; 0 fabricated, 4/4 corners
**References investigated:** opencode (primary), codex (secondary)

## Context

theokit#53: `@theokit/agents` `run-reflective-loop.ts` `roundSignature(toolCalls, text)` includes the assistant narration text in the no-progress fingerprint, so a model that re-runs identical tool calls but drifts its prose evades `NO_PROGRESS_THRESHOLD = 2` and spins (live: deepseek-v3.2, 7 rounds / 12 tool-calls re-doing `write_file`+`shell_exec`). This blueprint locks WHAT the fingerprint keys on and the threshold, grounded in two independent reference harnesses.

## Objective

Decide the no-progress fingerprint key + threshold + loop position for the theokit#53 fix, with ≥2 independent references in agreement.

## Coverage Corner 1 — Integration Tests

**Q3 — How does opencode test the doom_loop detection?**

opencode wires `doom_loop` as a default **"ask"** permission and tests that default at `.claude/knowledge-base/references/opencode/packages/opencode/test/agent/agent.test.ts:474-477`:

```ts
it.instance("default permission includes doom_loop and external_directory as ask", () =>
  ...
    expect(evalPerm(build, "doom_loop")).toBe("ask")
```

The test confirms the detector is wired into the permission system with a default action (ask the user) rather than silently continuing. The repeated-input *equality* itself (the algorithm) is covered structurally by the detector code in `processor.ts` (Corner 4), not by a dedicated repeated-call simulation in this test file — an honest gap noted for our own test design: **theokit must add a deterministic test that simulates N identical-tool / drifting-text rounds and asserts `no_progress`** (the exact theokit#53 regression).

**Takeaway for theokit:** a config/permission-level test is not enough; the theokit fix needs a loop-level regression test that drives identical tool-calls with varied narration and asserts the `no_progress` terminal.

## Coverage Corner 2 — Dependencies

**Q5 — Do the references pull a dependency for the repeat-detection/hash?**

No. opencode's detector serializes tool input with native **`JSON.stringify`** (`processor.ts:531`) — no crypto/hash library. The `processor.ts` import block (`processor.ts:1-10`) pulls `effect`, app modules, and schema — none for dedup/hashing. codex's `spec.rs` is a prose specification (no code dependency). 

**Takeaway for theokit:** the fix is pure logic — `stableStringify` (already in `run-reflective-loop.ts:99`) plays the role of opencode's `JSON.stringify`. **No new dependency** (Unbreakable Rule 9 / KISS). theokit's `stableStringify` is in fact *superior* to opencode's raw `JSON.stringify` because it sorts object keys (key-order-insensitive), so it will not false-negative on re-ordered inputs.

## Coverage Corner 3 — Tools

**Q4 — Where in the loop does opencode run the doom check, over what window?**

`.claude/knowledge-base/references/opencode/packages/opencode/src/session/processor.ts`:
- **Threshold constant:** `const DOOM_LOOP_THRESHOLD = 3` (`processor.ts:35`).
- **Window:** `const recentParts = parts.slice(-DOOM_LOOP_THRESHOLD)` (`processor.ts:522`) — the **last 3 tool parts**.
- **Position:** the check runs at **tool-call time** (inside the assistant-message part stream, right before executing the tool), not at end-of-round.
- **Config surface:** `doom_loop` is a tunable permission action — `.claude/knowledge-base/references/opencode/packages/core/src/v1/config/permission.ts:32` (`doom_loop: Schema.optional(Action)`).

**Takeaway for theokit:** theokit's loop is **round-based** (one SDK turn per round), not part-based — so the natural theokit analog is "last K *rounds* with an equal tool-call signature", which is exactly what `prevSig` + `NO_PROGRESS_THRESHOLD` already model (`run-reflective-loop.ts:489,82`). theokit does NOT need to move the check to tool-call time; it needs to fix WHAT the per-round signature compares (Corner 4). Threshold: opencode uses 3.

## Coverage Corner 4 — Techniques

**Q1 — What does opencode's doom_loop fingerprint key on?**

`.claude/knowledge-base/references/opencode/packages/opencode/src/session/processor.ts:525-535` — the detector fires only when every one of the last 3 parts is:

```ts
part.type === "tool" &&
part.tool === value.name &&
part.state.status !== "pending" &&
JSON.stringify(part.state.input) === JSON.stringify(input)
```

The fingerprint is **`tool name` + `JSON.stringify(input)`** — and **nothing else**. There is NO assistant narration / message text in the comparison. A model that re-runs the same tool with the same input trips the detector regardless of what it says around the call. **This is the exact inverse of theokit's bug** (theokit includes `text` in `roundSignature` → defeated by narration drift).

**Q2 — codex's consecutive-repeat threshold (spec/convention, labeled per EC-2):**

`.claude/knowledge-base/references/codex/codex-rs/ext/goal/src/spec.rs:66,77` — codex's goal-status *specification* (prose instruction to the model, not a runtime dedup algorithm):

> "Set status to `blocked` only when the same blocking condition has repeated for at least **three consecutive** goal turns, counting the original/user-triggered turn and any automatic continuations… If the user resumes a goal that was previously marked blocked, treat the resumed run as a fresh blocked audit." (`spec.rs:77-78`)

codex confirms the convergent convention: **a stuck state is declared only after the same condition repeats ≥3 consecutive turns**, with a reset semantic on resume. It is a spec-level convention (not code), but it independently corroborates the "consecutive identical → terminate" pattern and the threshold of 3.

## Cross-cutting Comparison

| Dimension | opencode (`doom_loop`) | codex (`goal blocked`) | theokit CURRENT (the bug) | theokit TARGET |
|---|---|---|---|---|
| Fingerprint keys on | tool name + `JSON.stringify(input)` | "same blocking condition" (model-judged) | tool-calls **+ assistant text** | tool-calls only (name + `stableStringify(input)`) |
| Includes narration text? | **No** | No (condition, not prose) | **Yes** (the defect) | **No** |
| Threshold (consecutive) | 3 | 3 | 2 | 2 (keep — see D2) |
| Window | last-3 tool parts | consecutive goal turns | consecutive rounds (`prevSig`) | consecutive rounds (unchanged) |
| Check position | tool-call time | per goal turn | end-of-round | end-of-round (unchanged) |
| Dedup mechanism | native `JSON.stringify` | n/a (prose) | `stableStringify` (key-sorted) | `stableStringify` (unchanged, superior) |
| On trigger | ask permission (`ask`) | set status `blocked` | terminate `no_progress` | terminate `no_progress` (unchanged) |

## ADRs

### D1 — The no-progress fingerprint MUST key on tool-calls only (drop assistant text)

**Decision:** `roundSignature` keys on the tool-call set (name + `stableStringify(input)`), EXCLUDING the assistant narration text.

**Rationale:** opencode's shipped `doom_loop` (`processor.ts:531`) compares ONLY `tool name + JSON.stringify(input)`; it deliberately excludes narration. Including text (theokit's current bug) is defeated by trivial prose drift — proven live. This is the root-cause fix for theokit#53. Aligns with `architecture.md` (the loop owns the terminal decision) and Unbreakable Rule 9/KISS (reuse the existing `stableStringify`, no new dep).

**Alternatives rejected:** (a) keep text but normalize it (fragile — any rephrase evades); (b) embedding-similarity on text (over-engineering, new dep, non-deterministic — violates KISS + `testing.md` determinism).

### D2 — Keep `NO_PROGRESS_THRESHOLD = 2` (do not raise to 3)

**Decision:** retain theokit's threshold of 2 consecutive identical-tool rounds.

**Rationale:** both references use 3, but theokit's signature is **round-based** (a full SDK turn = a model decision), coarser-grained than opencode's part-based window, and `stableStringify` is key-order-insensitive (fewer false negatives). K=2 ("tolerates one retry — V4-D", `run-reflective-loop.ts:81`) catches the spin one round earlier with negligible false-positive risk (two identical full rounds is already strong evidence of a stuck loop). Raising to 3 would let the observed deepseek spin burn an extra wasted round. The threshold is a one-line constant — trivially tunable later if evidence warrants.

**Alternatives rejected:** raise to 3 (matches refs but wastes a round on round-based granularity); make it configurable now (YAGNI — no caller asked).

### D3 — No new dependency; reuse `stableStringify`

**Decision:** the fix uses the existing `stableStringify` (`run-reflective-loop.ts:99`); no library added.

**Rationale:** opencode uses native `JSON.stringify`; theokit already has the superior key-sorted `stableStringify`. Unbreakable Rule 9 / KISS.

## Recommendations for the project

1. **theokit#53 fix:** change `roundSignature(toolCalls, text)` → key on tool-calls only. Concretely: drop the `text` argument from the signature string (or ignore it), so the fingerprint is `calls` = sorted `name:stableStringify(input)` joined. Keep `prevSig`/`NO_PROGRESS_THRESHOLD=2`/`stableStringify` as-is.
2. **Regression test (mandatory, theokit#53):** a deterministic loop test with a fake `RoundStreamFactory` that yields the SAME tool call (`name`+`input`) with DRIFTING assistant text across 3 rounds → assert `result.finishReason === 'no_progress'` and `rounds <= 3`. This is the exact bug; it must go RED before the fix.
3. **Edge: empty tool-calls rounds.** Two consecutive text-only rounds (no tool calls) with drifting text must NOT be falsely flagged as no-progress if the model is genuinely making textual progress — verify the signature for a no-tool round (calls part empty) still distinguishes "talking toward an answer" from "stuck". Keep the existing behavior where a round that ends on `stop` terminates naturally before no-progress is evaluated.
4. **Honest scope:** do NOT add embedding/semantic similarity (rejected D1 alt). Do NOT move the check to tool-call time (theokit is round-based — ADR per Corner 3).

## Blocked questions (if any)

None — all 5 research questions answered with verified citations.

## Halt-loop progress (audit trail)

- Q1 done — `processor.ts:525-535` (fingerprint = tool name + JSON.stringify(input), no text).
- Q2 done — `spec.rs:66,77-78` (≥3 consecutive, spec-level convention, labeled).
- Q3 done — `test/agent/agent.test.ts:474-477` (doom_loop default "ask"; theokit needs a loop-level regression test).
- Q4 done — `processor.ts:35,522` (threshold 3, window last-3) + `permission.ts:32` (config knob).
- Q5 done — `processor.ts:531,1-10` (native JSON.stringify, no dep).

## Related

- Issue: usetheodev/theokit#53
- Target: `packages/agents/src/loop/run-reflective-loop.ts` (`roundSignature`, `NO_PROGRESS_THRESHOLD`, `stableStringify`, `prevSig`)
- Discovery plan: `.claude/knowledge-base/discoveries/plans/no-progress-signature-stuck-loop-plan.md`
- Edge-case review: `.claude/knowledge-base/reviews/no-progress-signature-stuck-loop-edge-cases-2026-06-30.md`
