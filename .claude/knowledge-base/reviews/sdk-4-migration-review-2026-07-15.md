# Review — sdk-4-migration

**Slug:** sdk-4-migration
**Date:** 2026-07-15
**Reviewer:** cycle-review (multi-agent cross-validation)
**Verdict:** READY_TO_MERGE

## Scope

Migrate theokit to `@theokit/sdk@^4.0.1` (SE40). SDK 4.0 removed the entire pluggable
conversation-storage contract (`ConversationStorageAdapter`, `InMemoryConversationStorage`,
`FileSystemConversationStorage`, `AgentOptions.conversationStorage`, `StoredMessage`,
`buildReplayHistory`, `Session`/`SessionMeta`, durable objectives, `ClaudeCodeTranscriptWriter`),
replaced by an automatic native Claude-shaped `.jsonl` transcript rooted at `LocalOptions.baseDir`.
No backward-compat retained (explicit user directive — legacy code removed, not shimmed).

Commits under review (4, on `develop`, ahead of `main`):

- `5652813b` docs(plan): sdk-4-migration cycle artifacts (plan v1.1 + edge-cases + deps-audit)
- `13f0776b` feat(sdk-4-migration): migrate to `@theokit/sdk@^4.0.1` — native transcript persistence
- `cb23e419` fix(sdk-4-migration): close review findings (H1/H2/M1-M3/L1)
- `98b5b9a1` docs(changelog): record `@Conversation` removal + peer `^4.0.1`

## Severity matrix (after fixes)

| Sev | Finding | Status |
|---|---|---|
| HIGH | H1 — `@Conversation` decorator dead-but-undocumented after storage removal | FIXED — 0 prod callers verified; decorator + barrel export + test block deleted |
| HIGH | H2 — EC-1 resume gate (real-SDK resume-by-`sessionId`) lacked committed evidence | FIXED — dogfood evidence artifact with on-disk `.jsonl` DAG proof + 4 deterministic companion tests |
| MEDIUM | M1 — EC-3 unwritable-`baseDir` had no test | FIXED — `basedir-write-failure.test.ts` asserts typed `SDK_ERROR` (EACCES), fail-loud |
| MEDIUM | M2 — EC-2 discovery-collision (`.theokit/` vs transcript root) untested | FIXED — `resolveSessionBaseDir` exported + `session-basedir.test.ts` (`.not.toContain('/.theokit')`) |
| MEDIUM | M3 — gitignore/doc for `.data/` | FIXED — memory-template doc softened + showcase `.gitignore` adds `.data/` |
| LOW | L1 — peer range `>=4.0.1` should pin caret | FIXED — `^4.0.1` |

## Gates

| Gate | Result |
|---|---|
| plan-confidence | SHIPPABLE_WITH_CAVEATS (70) |
| deps-audit | PASS — 0 CVE on declared deps (osv-scanner; `pnpm audit` endpoint retired 410) |
| root test suite | 4108 passed / 0 type errors (only pre-existing `pnpm-11-compat` env-fail, proven on base via `git stash`) |
| code-quality | grep-zero on removed SDK symbols across packages |
| G2 / sdk-runtime | HELD — storage engine SDK-owned; theokit threads `baseDir`/`sessionId`, no store |
| G8 / R3a | HELD — `resolveSessionBaseDir` uses Web-Standards string concat, no `node:path` in `server/` |
| dogfood (real browser + real LLM) | PASS — 2-turn todolist persisted+resumed Alpha/Beta via native `.jsonl` on SDK 4.0.2 |

## Verdict rationale

Zero BLOCKER, zero residual HIGH after fixes. End-to-end persistence proven with hard on-disk
evidence (8-record Claude-shaped `.jsonl` DAG at the exact `resolveSessionBaseDir` path). All 6
review findings closed with committed tests/evidence. **READY_TO_MERGE.**
