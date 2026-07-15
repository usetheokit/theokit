# Edge Case Review — sdk-4-migration

Date: 2026-07-15
Tasks analyzed: 9 (T0.1, T1.1, T1.2, T2.1, T2.2, T3.1, T4.1, T5.1, Phase 6)
Cases found: 6 (EDGE: 2, NEGATIVE: 4 | MUST FIX: 2, SHOULD TEST: 2, DOCUMENT: 2)

The plan is mechanically sound (removal of a subsystem + one runtime break). The interesting edges are ALL at the ONE new boundary: the native `.jsonl` transcript the SDK now writes to `local.baseDir`, and the resume-by-`sessionId` semantics the shipped session-continuity fix depends on.

## MUST FIX

### EC-1: resume-by-`sessionId` is assumed, not verified — the whole persistence claim rests on it
- **Affected task:** T1.1 (and the Goal's dogfood metric)
- **Kind:** NEGATIVE (unverified external contract)
- **Family:** Integration
- **Scenario:** The plan's Goal metric is "todolist persists across two turns". That works ONLY if `Agent.getOrCreate(sessionId)` on 4.0.1 reconstructs prior turns from the native transcript purely by `sessionId` (no explicit `run.conversation()`/resume call). The plan flags this as Unresolved Q2 but still wires T1.1 as if it holds. If 4.0.1 requires an explicit resume, turn 2 sees an empty transcript → the dogfood fails AND we've shipped a regression (worse than 3.x, where the pluggable store auto-resumed).
- **Impact:** The plan's headline metric silently fails; a persistence regression ships.
- **Suggested fix:** Make Q2 a **T1.1 pre-condition gate**: before writing the create-options, add an evidence step that reads the SDK 4.0.1 resume path (grep `getOrCreate`/`run.conversation` in the installed `.d.ts` + a 2-turn integration test against the REAL SDK asserting turn-2 sees turn-1). If resume needs an explicit call, T1.1 adds it. Do not proceed to Phase 6 until this test is green.

### EC-2: the native transcript is written under the app dir → must be gitignored, and must not collide with `.theokit/` config discovery
- **Affected task:** T1.2 (D2 — `baseDir` = app root)
- **Kind:** NEGATIVE (state/format)
- **Family:** State / Format
- **Scenario:** D2 sets `baseDir` to the app root so the SDK writes `<baseDir>/projects/<encoded-cwd>/<agentId>.jsonl`. Two hazards: (a) these ephemeral session files land in the repo tree and get committed (leaking conversation content into git); (b) if `baseDir` = `<projectRoot>/.theokit`, the transcript's `projects/` subdir sits INSIDE the file-based-config dir that `settingSources(['project'])` scans — a discovery mis-read or a git-tracked config dir now containing volatile session data.
- **Impact:** Conversation transcripts committed to git (privacy + noise); potential config-discovery confusion.
- **Suggested fix:** Add the transcript path to `.gitignore` in the scaffold + the showcase (`**/projects/**/*.jsonl` under the chosen baseDir, or the whole `.data`/session dir) AND confirm in a T1.2 test that `settingSources` discovery ignores the `projects/` subdir. Prefer `baseDir = <projectRoot>/.data` over `.theokit` if the discovery test shows any coupling (resolves Q1 in favor of `.data`).

## SHOULD TEST

### EC-3: `baseDir` unresolvable (no `projectRoot` AND no `HOME`) → must fail-clear, not hang
- **Affected task:** T1.1 / Failure scenarios
- **Kind:** NEGATIVE
- **Suggested test:** `test_transcript_write_surfaces_typed_error_when_baseDir_unresolvable()` — with `projectRoot` unset the SDK default `~/.theokit` applies; on a host with `HOME` unset the `~` expansion / write fails. Assert the stream yields `{ type:'error', code:'SDK_ERROR', message }` (fail-loud per `error-handling.md`), NOT a silent empty stream or a hang. (Complements the plan's existing "baseDir not writable" row.)

### EC-6: Global DoD "≥ 700 tests" contradicts the deletions
- **Affected task:** T5.1 / Global DoD
- **Kind:** EDGE (boundary of the metric itself)
- **Suggested test:** none — a plan-text fix. Deleting `conversation-storage.test.ts` + storage cases REDUCES the count below the current 719. Change the DoD from "≥ 700 tests" to "the FULL agents suite is green (count reduced by the deleted storage cases, documented)". Asserting a floor the plan itself lowers is a self-inflicted false-fail.

## DOCUMENT

### EC-4: guessable `sessionId` now persists on DISK (durable), not just in memory
- **Kind:** NEGATIVE (security)
- **Accepted risk:** The pre-existing caveat "thread stream keyed on guessable sessionId → apps must gate" (M39) is WORSENED by 4.0: two users with the same `sessionId` now share a persistent `.jsonl` on disk, so a leak outlives the process. Gating `sessionId` remains the app's responsibility (theokit does not mint it — the client `chatId` does). Hashing/namespacing sessionId is out of scope (app concern). Document in the CHANGELOG migration note + the seam doc.

### EC-5: concurrent same-`sessionId` runs (M39 thread follow-up) append the same transcript
- **Kind:** EDGE (concurrency at the write boundary)
- **Accepted risk:** M39's thread follow-up can drive two runs on the same `sessionId`; both now append the same `.jsonl`. Serializing the append is the SDK's responsibility (it owns the transcript engine — G2). theokit must NOT add its own file lock (would reimplement storage). Document that concurrent same-session durability is delegated to the SDK; if the SDK corrupts under concurrent append, that is an SDK issue to file, not a theokit fix.

## Summary

| Task | EDGE | NEGATIVE | MUST FIX | SHOULD TEST | DOCUMENT |
|------|------|----------|----------|-------------|----------|
| T0.1 | 0 | 0 | 0 | 0 | 0 |
| T1.1 | 0 | 2 | 1 (EC-1) | 1 (EC-3) | 0 |
| T1.2 | 0 | 1 | 1 (EC-2) | 0 | 0 |
| T2.1 | 0 | 0 | 0 | 0 | 0 |
| T2.2 | 0 | 0 | 0 | 0 | 0 |
| T3.1 | 0 | 0 | 0 | 0 | 0 |
| T4.1 | 0 | 0 | 0 | 0 | 0 |
| T5.1 | 1 (EC-6) | 0 | 0 | 1 (EC-6) | 0 |
| Phase 6 | 1 (EC-5) | 1 (EC-4) | 0 | 0 | 2 (EC-4, EC-5) |

**Coverage check:** the removal tasks (T2.1/T2.2/T3.1/T4.1) touch no input boundary — they delete surface, so no EDGE/NEGATIVE applies (explicitly noted). All boundary risk concentrates at the transcript write (T1.1/T1.2) and the resume contract — both covered by MUST FIX.

**Verdict:** PLAN NEEDS ADJUSTMENT — absorb EC-1 (resume-verify gate in T1.1) + EC-2 (gitignore + discovery-collision, resolve Q1→`.data` if coupled) as sub-tasks; apply EC-3/EC-6 as tests/text; record EC-4/EC-5 as CHANGELOG+seam-doc notes.
