# Edge Case Review — crossval-absorption-gaps

Date: 2026-08-14
Plan: `.claude/knowledge-base/plans/crossval-absorption-gaps-plan.md` v1.0
Tasks analyzed: 17
Cases found: 21 (EDGE: 9, NEGATIVE: 12 | MUST FIX: 7, SHOULD TEST: 9, DOCUMENT: 5)

> Note on the skill's Step 1 glob: it resolves `knowledge-base/plans/**` from the repo root; in this
> repo plans live under `.claude/knowledge-base/plans/`. Analysis was run against the correct path.

---

## MUST FIX

### EC-1: `forkBeforeUserTurn` with `srcId === newId` overwrites the source transcript
- **Affected task:** T1.1
- **Kind:** NEGATIVE (invalid input)
- **Family:** Input / State
- **Scenario:** A caller forks a session onto its own id. `transcriptPath` resolves `src` and `dst` to the same path, and `forkTranscript` writes the truncated copy over the original.
- **Impact:** **Silent data loss** — the session is truncated in place with no error. Today the function always throws so the path is unreachable; T1.1 makes it reachable for the first time. Fixing the bug opens the hazard.
- **Suggested fix:** guard at the top of `forkBeforeUserTurn`: `if (srcId === newId) throw new TheokitAgentError('forkBeforeUserTurn: srcId and newId must differ')`.

### EC-2: `PermissionStore` scope compared as a raw string — a symlink bypasses the grant boundary
- **Affected task:** T3.3
- **Kind:** NEGATIVE (invalid/hostile input)
- **Family:** Permission / Format
- **Scenario:** A grant is stored for scope `/repo/a`. The agent later runs with cwd `/tmp/link` → `/repo/a`, or with `/repo/a/` (trailing slash), or `/repo/./a`. String equality fails to match, so the grant is denied — *or*, worse, a grant stored for a symlinked path matches a different real directory.
- **Impact:** **Security** — the scope key is the entire safety property of D5's design ("a grant for `npm test` in `/repo/a` does not authorize `rm -rf` in `/repo/b`"). Uncanonicalized paths make that property unreliable in both directions. There is direct precedent: the state analyst measured this exact defect in the consumer's `TrustStore` ("compares paths by string equality, no `realpath` canonicalisation").
- **Suggested fix:** canonicalize on both write and read: `const scope = realpathSync(rawScope)` before keying, and reject a scope that does not resolve.

### EC-3: Provider inference by key prefix without longest-match-wins resolves `sk-ant-…` as OpenAI
- **Affected task:** T4.1
- **Kind:** EDGE (a valid key matching two valid prefixes)
- **Family:** Input / Format
- **Scenario:** `sk-` is a strict prefix of `sk-ant-` and `sk-or-`. A naive `startsWith` scan in declaration order matches `sk-` first for an Anthropic key.
- **Impact:** The credential is sent to the wrong provider and fails mid-request with a 401 — precisely the failure the coherence check in T4.1 exists to prevent, reintroduced by the inference it sits next to. The consumer already solved this (`PREFIXES_BY_LENGTH`, sorted descending by prefix length).
- **Suggested fix:** sort descending by prefix length before scanning; add the `sk-ant-` vs `sk-` case to the RED tests.

### EC-4: The gap register is green-by-absence when every assertion is skipped
- **Affected task:** T0.5
- **Kind:** NEGATIVE (degenerate environment)
- **Family:** State / Integration
- **Scenario:** On a fresh clone with `packages/agents/dist/` unbuilt, every `.d.ts`-reading assertion hits its `skipIf` and the suite reports success with zero real assertions.
- **Impact:** The plan's **single Goal metric** passes while nothing is verified — the exact "gate that cannot fail" failure D3 was written to avoid, and the same shape as the anti-vacuity floor T5.1 installs for the parity gate.
- **Suggested fix:** add a meta-assertion — `expect(skipped.length).toBeLessThanOrEqual(1)` in CI (`process.env.CI`), listing which were skipped and why.

### EC-5: The approval-store path is unspecified, and the default directory is shared with the SDK
- **Affected task:** T3.2
- **Kind:** NEGATIVE (environment / permission)
- **Family:** Permission / Resource
- **Scenario:** The plan mandates `assertSecureModes` but never says *where* the store lives. The natural default (`~/.theokit/`) is shared with the SDK's transcript root, which is created without an explicit mode — whoever gets there first sets the permissions, and `mkdirSync(..., {mode: 0o700})` is a no-op on an existing directory.
- **Impact:** **Security** — the store can end up group/other-writable through no action of this code, and a hook is `spawn(cmd, {shell:true, detached:true})`. The consumer hit exactly this (SAC-01: "the consent store is held to a weaker standard than the credential store").
- **Suggested fix:** name the path in the task (`<credentialHome>/hook-approvals.json`) and **repair** the mode on open (`chmodSync(dir, 0o700)`) rather than only asserting it.

### EC-6: Moving an `[Unreleased]` entry that belongs to an already-released version conflicts with the never-edit invariant
- **Affected task:** T0.2
- **Kind:** EDGE (boundary of the invariant)
- **Family:** State
- **Scenario:** An entry sitting in `[Unreleased]` describes work that actually shipped in `8.1.0`, whose heading already exists at `CHANGELOG.md:70`. Filing it correctly means editing a released section; leaving it means the changelog stays wrong.
- **Impact:** The task as written has no rule for this and the implementer will pick one silently — either violating Unbreakable Rule 6 or leaving the defect T0.2 exists to fix.
- **Suggested fix:** state the rule in the task — such an entry goes under the **next** version heading with a `(shipped in 8.1.0, filed late)` annotation; released sections are never edited.

### EC-7: Warn mode has no expiry, so it can become permanent
- **Affected task:** T5.1
- **Kind:** NEGATIVE (process failure, not runtime)
- **Family:** State / Timing
- **Scenario:** T5.1 lands 18 subpaths in warn mode; T5.2 promotes four. The remaining 14 warn forever, and a warning nobody is forced to clear is a warning nobody reads.
- **Impact:** The root-cause fix (D1) silently degrades to "we print something", which is the pre-existing state dressed up. This repo already has the antidote as a convention: `code-quality-allowlist.txt` and `deps-audit-allowlist.txt` both require a sunset ≤ 90 days, and an expired entry re-fires at full severity.
- **Suggested fix:** give each warn-mode subpath a sunset date in the script; past the date the subpath fails hard, exactly like the allowlists.

---

## SHOULD TEST

### EC-8: `nth` exactly equal to the number of available user turns
- **Affected task:** T1.1
- **Kind:** EDGE
- **Suggested test:** `fork_accepts_nth_equal_to_last_user_turn()` — fixture with 3 user turns, `nth=3`; assert it returns the 3rd turn's record index rather than throwing. The current RED set covers `nth` *exceeding* the count and `nth < 1`, leaving the boundary itself untested — and off-by-one at the top of a range is the classic failure of 1-based counting.

### EC-9: Transcript whose last line is truncated
- **Affected task:** T1.1
- **Kind:** NEGATIVE
- **Suggested test:** `fork_handles_truncated_last_line()` — fixture ending mid-JSON; assert either a typed error naming the line number **or** tolerant parsing, whichever `loadJsonl` is configured for. Assert the *specific* behavior, not merely "does not crash". The SDK exposes `tolerateTrailingPartialLine`; the consumer's PS-003 recorded that re-deriving this behavior produced a bare `SyntaxError` instead of a typed `JsonlParseError`.

### EC-10: Transcript that does not begin with a user record
- **Affected task:** T1.1
- **Kind:** EDGE
- **Suggested test:** `fork_counts_correctly_when_transcript_starts_with_system()` — fixture with a leading `system` record; assert the first user turn's index accounts for it. The naive fixture (user first) passes for the wrong reason.

### EC-11: Importing `@theokit/agents/config` must not emit the `theokit/server` deprecation warning
- **Affected task:** T2.1
- **Kind:** NEGATIVE
- **Suggested test:** `config_subpath_is_silent()` — spy on `console.warn`, import `@theokit/agents/config`, assert zero calls. If the re-export direction is wired backwards, the new door inherits the old door's warning and teaches the consumer that the fix is also deprecated.

### EC-12: A hook that throws during a delegated member's run
- **Affected task:** T3.1
- **Kind:** NEGATIVE
- **Suggested test:** `member_hook_that_throws_fails_closed()` — inherited hook throws; assert the member's tool call is **refused**, not allowed. An inherited gate that opens on its own error is worse than no gate, and `error-handling.md § 2` forbids the swallow.

### EC-13: Zero-byte store file vs missing store file
- **Affected task:** T3.2 (and T3.3, same helper)
- **Kind:** EDGE
- **Suggested test:** `empty_store_file_reads_as_unknown()` — create a 0-byte file; assert every fingerprint reads `unknown` and no parse error escapes. A crash-truncated file is the realistic producer of this state, and `JSON.parse('')` throws.

### EC-14: Grant expiring exactly at `now`
- **Affected task:** T3.3
- **Kind:** EDGE
- **Suggested test:** `grant_expiring_exactly_now_is_denied()` — `expiresAt === now`; assert denied. The plan's pseudo-code already chose `<=`; the boundary should be locked by a test so a later refactor to `<` is caught.

### EC-15: `inspectCompiled` called with something that is not a definition
- **Affected task:** T1.2
- **Kind:** NEGATIVE
- **Suggested test:** `inspect_rejects_non_definition()` — pass `{}` / `null`; assert a typed error naming what was expected. Widening the parameter type (D-less, decided in T1.2) makes accidental misuse more likely, not less.

### EC-16: Paste into the masked input field
- **Affected task:** T6.1
- **Kind:** EDGE
- **Suggested test:** `masked_input_does_not_echo_on_paste()` — simulate a multi-character paste; assert no plaintext reaches the rendered output or component state. The plan names this in Deep Dives but lists no test; paste is the path that bypasses per-keystroke masking.

---

## DOCUMENT

### EC-17: `PermissionStore` grows without bound
- **Kind:** EDGE
- **Accepted risk:** Grants accumulate with no pruning. Realistic ceiling is tens of entries for a single developer, and expiry already removes the time-bounded ones. Add pruning when a real store exceeds a size worth measuring — not before (G11/YAGNI).

### EC-18: A backwards system clock un-expires a grant
- **Kind:** NEGATIVE
- **Accepted risk:** An expired grant becomes valid again if the clock moves back. The fix (monotonic clock or signed timestamps) costs more than the exposure for a local developer tool where the user owns the machine. Revisit if the store is ever shared or synced.

### EC-19: Shipping a 114 KB CHANGELOG in every install
- **Kind:** EDGE
- **Accepted risk:** T0.1 adds `CHANGELOG.md` to `files`, and the file is 114 KB. That is real weight on every install, accepted because the measured cost of *not* shipping it is a consumer that re-implemented five delivered capabilities. Revisit by truncating to the last N minors if the package ever approaches a size budget.

### EC-20: Cyclic nested delegation accumulating inherited hooks
- **Kind:** EDGE
- **Accepted risk:** A → B → A would accumulate hook sets. Depth is already bounded by the framework's `DelegationBudgetExceededError`, so the accumulation terminates. Not worth a separate guard.

### EC-21: A slow or hanging injected protected-ids provider stalls the GC
- **Kind:** NEGATIVE
- **Accepted risk:** T4.2's provider is consumer-supplied and synchronous; a hang stalls a GC run the user invoked. Fail-closed on *throw* is specified; adding a timeout would require making the seam async and rippling through `planTranscriptGC`. Documented rather than fixed — the blast radius is one interactive command, not data loss.

---

## Summary

| Task | EDGE | NEGATIVE | MUST FIX | SHOULD TEST | DOCUMENT |
|------|------|----------|----------|-------------|----------|
| T0.1 | 1 | 0 | 0 | 0 | 1 |
| T0.2 | 1 | 0 | 1 | 0 | 0 |
| T0.3 | 0 | 0 | 0 | 0 | 0 |
| T0.4 | 0 | 0 | 0 | 0 | 0 |
| T0.5 | 0 | 1 | 1 | 0 | 0 |
| T1.1 | 2 | 2 | 1 | 3 | 0 |
| T1.2 | 0 | 1 | 0 | 1 | 0 |
| T2.1 | 0 | 1 | 0 | 1 | 0 |
| T2.2 | 0 | 0 | 0 | 0 | 0 |
| T3.1 | 1 | 1 | 0 | 1 | 1 |
| T3.2 | 1 | 1 | 1 | 1 | 0 |
| T3.3 | 2 | 1 | 1 | 1 | 2 |
| T4.1 | 1 | 0 | 1 | 0 | 0 |
| T4.2 | 0 | 1 | 0 | 0 | 1 |
| T5.1 | 0 | 1 | 1 | 0 | 0 |
| T5.2 | 0 | 0 | 0 | 0 | 0 |
| T6.1 | 1 | 0 | 0 | 1 | 0 |

**Coverage check:** every task touching an input boundary carries at least one EDGE and one NEGATIVE case, or an explicit note. Four tasks (T0.3, T0.4, T2.2, T5.2) are pure documentation or configuration edits with no input boundary — no lens applies, stated rather than omitted.

**Concentration observed:** 5 of the 7 MUST FIX sit on tasks that create or repair a **security or data-integrity** surface (T1.1 fork, T3.2 approval store, T3.3 permission store, T4.1 credential inference), and three of them (EC-2, EC-3, EC-5) are defects the *consumer* already hit and solved — the plan re-derives the capability without re-deriving the lesson. That is the single most useful signal in this review: when absorbing a consumer's module, absorb its scar tissue, not just its interface.

**Verdict:** PLAN NEEDS ADJUSTMENT — 7 MUST FIX to absorb into v1.1 before `/plan-confidence`.
