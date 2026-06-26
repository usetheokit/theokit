# Review — V4-M loop session history

**Date:** 2026-06-25
**Slug:** v4m-loop-session-history
**Commits:** `04cd99f` (artifacts), `8811577` (feat) on `develop`
**Reviewers:** 2 independent agents (adversarial code-review + cross-validation).
**Verdict:** **READY_TO_MERGE**

## Severity matrix

| Severity | Count |
|---|---|
| BLOCKER | 0 |
| HIGH | 0 |
| MEDIUM | 0 |
| LOW | 1 (accepted — documented contract) |
| INFO | 3 |

## Adversarial code-review — READY_TO_MERGE

- **Shared-storage closure correct:** `let storage` created ONCE per `stream()` call (not per round); `??=` idempotent across rounds (proven by `inMemCount === 1`); SAME instance reaches every round's `getOrCreate` (byref test); no path allocates a new store on round 2.
- **getOrCreate lifecycle verified against SDK source:** `LocalAgent.dispose()` → `liveAgentRegistry.forget(id)` (no re-dispose); round 2's `getOrCreate` cache-misses → `Agent.resume(id)` rehydrates from the external `conversationStorage`. The store is external to the agent → per-round dispose does NOT lose history. (No re-spike needed; source confirms the empirical spike.)
- **No cross-run leakage:** `sessionId = runner-${uuid}` constant per run; each run owns its closure storage + unique id → distinct SDK registry keys.
- **buildPrompt change correct + tag preserved:** round 1 = message; rounds 2+ = `[reflection] feedback` or `CONTINUE_PROMPT`, never re-sending message. The `[reflection]` tag preserved for backward-compat.
- **Backward compat:** ALL 5 `vi.mock('@theokit/sdk')` files updated create→getOrCreate + `InMemoryConversationStorage` stub; no stale `Agent.create` runtime mock; suite 387 green.
- **Guardrails:** G2 (SDK-only runtime — getOrCreate/InMemory are SDK primitives), G6 (sizes), complexity fixed via `buildExtraCreateOptions` extraction, no new `as` smell.
- **Tests non-vacuous:** byref `toBe` for same-session + same-storage; count assertions for default-once; sentinel byref for override.

### LOW-1 (accepted, documented contract)
- **Finding:** a custom `conversationStorage` with a no-op `appendMessage` would make rounds 2+ lose the task (D1↔D2 coupling). **Disposition:** ACCEPTED — documented in JSDoc + ADR D2 + the changeset; the SDK partially guards it (`resume` throws if a custom store was used at create but omitted at resume); the default `InMemoryConversationStorage` persists correctly. Advisory; the contract is honestly stated.

## Cross-validation — READY_TO_MERGE

- **Coverage Matrix 7/7** addressed (G1-G7), each with code + test evidence.
- **Goal metric:** every clause asserted (same sessionId; same shared storage; round-2 continuation not original).
- **ADRs D1/D2/D3** all match the implementation.
- **Edge cases EC-1 (override honored), EC-2 (round-1 vs round-2)** each have a passing test.
- **All 4 T2.1 tests present.**
- **"No new dependency / no manifest change"** verified (`git show 8811577 --stat` touches no package.json).
- **Backward compat** documented; V4-L tests green after mock updates.
- **5-vs-2 mock disclosure HONEST** (typecheck/runtime-forced, disclosed in the impl summary).
- **No symbol fabrication:** `Agent.getOrCreate`/`InMemoryConversationStorage`/`ConversationStorageAdapter`/`AgentOptions.conversationStorage` all exported from the `@theokit/sdk` barrel.

## INFO (non-blocking)
- The `delegate()` sub-agent path shares the loop driver, so it gains session memory too — now noted in the changeset.
- The `[reflection] feedback` branch is covered in `main-loop-runtime.test.ts`; the `CONTINUE_PROMPT` branch in `loop-session-history.test.ts` (both covered, across two files).
- `run()` and `stream()` thread `conversationStorage` at the same single site.

## Validation state

- `npx vitest run` (packages/agents): 387 passed, 3 skipped.
- `npx tsc --noEmit -p packages/agents/tsconfig.test.json`: exit 0.
- Lint on changed files: exit 0.

## Decision

No BLOCKER/HIGH/MEDIUM findings from either reviewer; the SDK lifecycle was verified against source. The single LOW is a documented, accepted contract. **READY_TO_MERGE.**
