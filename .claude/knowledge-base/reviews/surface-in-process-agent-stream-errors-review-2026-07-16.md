# Review: surface-in-process-agent-stream-errors (#136)

**Date:** 2026-07-16
**Commits reviewed:** `6bcfafa1` (fix) + `029190c0` (review-fix follow-up)
**Reviewers (parallel agents):** 3 — architecture/correctness (`code-reviewer`), test-quality (`general-purpose`), cross-validation (`general-purpose`)
**Findings:** BLOCKER 0 · HIGH 0 · MEDIUM 1 (fixed) · LOW ~5 (1 fixed, rest documented nice-to-haves) · INFO 10
**Verdict:** **READY_TO_MERGE**

> Right-sized review per the skill's "Match to the work" guidance — an 8-line, single-function fix does not warrant the full 7-agent domain fan-out. 3 focused reviewers spawned in parallel.

## BLOCKER findings
None.

## HIGH findings
None.

## MEDIUM findings (resolved before merge)

### F1 — Post-loop `throw streamError` is dead code under ai@7.0.14; comment overclaimed it as load-bearing
- Severity: MEDIUM → **FIXED** in `029190c0`
- Found by: architecture/correctness
- File: `packages/theo/src/client/consume-ui-message-stream.ts:74-84`
- Evidence: `terminateOnError:true` calls `controller.error()` on the output stream (ai@7.0.14 `dist/index.js`), so the `for await` itself rejects on the error chunk — the implicit throw reaches `AgentClient.#drive`'s catch before the explicit post-loop `throw`. The original comment (and plan Q1) claimed the loop ends cleanly and the rethrow is load-bearing — a misleading assertion for a future maintainer (Rule 3).
- Resolution: comment corrected to state the mechanism accurately (`for await` rejects; the post-loop `throw` is a defensive fallback for version-robustness). Plan Q1 updated with the empirically-confirmed resolution. Behavior unchanged (the outcome — `status='error'` + exact message — was already correct and test-proven).

## LOW findings

### F2 — Missing test: stale (aborted) drive receiving an error chunk
- Severity: LOW (correctness-critical new code path) → **FIXED** in `029190c0`
- Found by: architecture/correctness
- Resolution: added `test_abort_then_stale_drive_error_chunk_does_not_clobber_status` — proves the `aborted()` guard in `#drive`'s catch still prevents a stale drive's error from clobbering the live turn (status stays `'streaming'`, `error` undefined). 25/25 green.

### F3 — `consumeUIMessageStream` (Response/SSE) path has no dedicated regression test
- Severity: LOW → **accepted (documented)**. The fix is in the shared `consumeChunkStream`, so both paths are fixed by construction; adding an SSE-`Response` test would be near-duplicative. Noted for a future hardening pass.

### F4 — Non-`Error` `onError` arg branch uncovered
- Severity: LOW → **accepted (unreachable under ai@7.0.14)**. `readUIMessageStream` always constructs `new Error(chunk.errorText)`; the `String(err)` branch is defensive and cannot fire with the current lib.

### F5 — Trailing valid chunk after an error chunk not tested (`terminateOnError` drop)
- Severity: LOW → **accepted (documented tolerated gap)**. The runner emits `error` as terminal (plan Risk row); the drop is intended behavior. `test_consumeChunkStream_rethrows_on_error_chunk` already pins that pre-error text IS delivered.

## Edge-case coverage
- Error chunk mid/last of stream → rethrow: **covered** (`test_consumeChunkStream_rethrows_on_error_chunk`, store `test_send_error_chunk_sets_error_status`).
- Error chunk as first chunk → immediate rethrow: **covered** (`test_consumeChunkStream_error_chunk_first_rethrows`).
- Happy path → no throw: **covered** (`test_consumeChunkStream_happy_path_no_throw`).
- Pre-error partial text still delivered: **covered** (asserts `'Hi'`).
- Abort racing an error chunk (stale-drive no-clobber): **covered** (new in `029190c0`).

## Cross-validation summary (plan vs commits)
- Plan tasks: 2 (T1.1, T2.1) — both fully implemented.
- Coverage Matrix: 5/5 rows delivered.
- ADR D1 (onError + terminateOnError + rethrow, NOT inspect-last-message-part): implemented without divergence.
- Goal's named test `test_send_error_chunk_sets_error_status`: present, asserts `status='error'` + exact `error.message`.
- Scope: exactly the declared files (client consumer + 2 test files + changeset + CHANGELOG); no creep. `responseToChunkStream`/`consumeUIMessageStream` signatures unchanged (backward-compat preserved).
- Drawbacks/Risks the plan flagged: all mitigated with test evidence.

## Quality gates summary
- Targeted tests: **25 passed** (`consume-chunk-stream.test.ts` + `agent-client.test.ts`).
- Neighbor client suites (create-agent-client, transport-context, channel-transport, agent-handle): 28 passed (pre-fix run).
- `tsc --noEmit`: **0 errors** (whole repo).
- `eslint --max-warnings=0` on changed files: **clean**.
- Secret scan on diff: clean.
- Full monorepo suite: NOT run to completion — times out in this sandbox (documented infra limitation: 18 packages in parallel saturate libuv). Change blast radius (2 consumers of `consumeChunkStream`) fully covered.

## Spawned agents (audit trail)
- architecture/correctness (`code-reviewer`) — agentId a3348342253e96b7f
- test-quality (`general-purpose`) — agentId aa01ca9224c458ffb
- cross-validation (`general-purpose`) — agentId ab4f9157715a269ba

## Handoff decision
**READY_TO_MERGE.** No BLOCKER/HIGH. The single MEDIUM and the correctness-critical LOW were fixed in `029190c0`; remaining LOWs are documented nice-to-haves (unreachable/defensive branches or same-function duplicate paths). Next: `/release` (develop→main PR with semver tag, human-approved) to ship the `theokit` patch.
