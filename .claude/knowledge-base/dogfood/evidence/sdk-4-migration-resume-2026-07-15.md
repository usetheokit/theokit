---
scenario: sdk-4-migration-native-transcript-resume
date: 2026-07-15
operator: paulo
outcome: pass
summary: 2-turn todolist persisted+resumed via the SDK 4.0.2 native .jsonl transcript, in a real browser
---

# Dogfood evidence — SDK 4.0 native transcript persistence + resume (EC-1)

Closes the plan's EC-1 MUST-FIX gate (real-SDK resume-by-`sessionId`) with committed evidence — the
automated deterministic tests prove theokit *threads* `sessionId`/`baseDir`; this proves the real SDK
4.0.2 transcript **re-hydrates prior turns end-to-end**.

## Setup
- Framework built from this migration's HEAD (`@theokit/agents` + `theokit`), overlaid into `apps/showcase`.
- `apps/showcase` resolving **`@theokit/sdk@4.0.2`** + `@theokit/sdk-tools@0.11.0` (verified).
- Real browser (chrome-devtools), real LLM (`openai/gpt-4o-mini` via OpenRouter), logged-in demo user.

## Steps + observed result (two separate agent turns, same conversation)
1. **Turn 1:** "Use the todolist tool to add exactly two items: Alpha and Beta." → agent called
   `todolist add Alpha` + `todolist add Beta`, replied `ok`. Plan panel showed `Plan · 0 of 2 done · Alpha · Beta`.
   `POST /api/agents/chat` → 200.
2. **Turn 2:** "Call the todolist tool with action list. Tell me exactly which item titles it returns." →
   agent replied **"The item titles returned are: 1. Alpha 2. Beta"**. `POST /api/agents/chat` → 200.
   Zero console errors.

Turn 2 saw turn-1's items → **the session persisted+resumed across turns.**

## Hard evidence — the on-disk native transcript
Written to the exact path theokit's `resolveSessionBaseDir(projectRoot)` produces:

```
apps/showcase/.data/agent-sessions/projects/-home-paulo-...-apps-showcase/b651e3f2-...-...jsonl
```

The `.jsonl` is a Claude-shaped DAG of **8 records spanning BOTH turns** (decoded):

| # | type | content |
|---|------|---------|
| 0 | user | "Use the todolist tool to add … Alpha … Beta" (turn 1) |
| 1 | assistant | `tool_use todolist({action:add, title:Alpha})` + `add Beta` |
| 2 | user | 2× `tool_result` |
| 3 | assistant | text: "ok" |
| 4 | user | "Call the todolist tool with action list…" (turn 2 — appended to the SAME file) |
| 5 | assistant | `tool_use todolist({action:list})` |
| 6 | user | `tool_result` |
| 7 | assistant | text: "The item titles returned are: 1. Alpha 2. Beta" |

Turn 2's records were appended to turn 1's transcript under the same `<agentId>`.jsonl → the SDK's
native persistence + theokit's `local.baseDir`/`sessionId` threading + the `HttpTransport` chatId→id
session-continuity fix compose into working cross-turn persistence on SDK 4.0.2. No storage adapter,
no theokit-side store — the SDK owns it (G2/ADR-0040).

## Automated companions (deterministic, committed)
- `runtime-overrides.test.ts::test_baseDir_override_reaches_agent_create_local` — `baseDir → local.baseDir`.
- `agent-endpoint.test.ts::test_resume_by_sessionId_threads_the_session_into_the_sdk` — same-`sessionId` threading.
- `session-basedir.test.ts` — transcript rooted under `.data/`, not `.theokit/` (EC-2).
- `basedir-write-failure.test.ts` — an unwritable `baseDir` surfaces a typed error, never swallowed (EC-3).
