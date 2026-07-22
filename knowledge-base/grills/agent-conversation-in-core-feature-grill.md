
## Q2 — Dependencies

**M41** (`AgentClient` store + transports — the base to extend) + **M44** (`theokit/client/core`
React-free — where the `thread` logic lives so all 3 surfaces inherit it). **M45** (web/tui/desktop
surfaces) as the validation target for 3-surface parity. All already `[x]` → M46 immediately eligible.

## Q3 — Definition of Done

1. React-free store (`agent-client.ts`) exposes `thread` = committed history + in-flight turn,
   accumulated across sends (NOT reset), with stable ids, in `AgentClientState`.
2. `useAgent()` + `createAgentClient()` return `thread` (ADDITIVE; raw `messages` kept for back-compat).
3. streaming→committed lifecycle + id management live IN the store — zero consumer boilerplate.
4. Validated on all 3 surfaces: showcase (web) `use-transcript.ts` collapses to
   `const { thread, status, send } = useAgent(...)` (88 lines gone); TUI + desktop templates (M45)
   consume `thread` identically.
5. TDD + back-compat: `messages` unchanged, runtime/wire untouched (G2), CHANGELOG + ADR.

## Q4 — Top 2 new risks

- **R1 — Mental-model / back-compat shift.** `messages` is per-turn today; adding `thread`
  (conversation) risks confusion (which to use?) or breakage if `messages` semantics drift.
  *Mitig:* `thread` is additive; `messages` keeps exact per-turn semantics; docs steer to `thread`.
- **R2 — Id/lifecycle correctness in edge cases.** The store now owns id fabrication + commit-once +
  in-flight/committed dedup (the fragile showcase `useEffect`). Risk: double-commit, id collision,
  flicker, lost turn on abort/reconnect/error. *Mitig:* TDD the lifecycle (commit-once, abort
  mid-turn, reconnect replay into thread, error mid-stream).

## SOTA delta (Step 5)

No new reference peers — ai-sdk `useChat` (conversation accumulation; already an installed dep +
M41 prior-art) and opencode's transport-agnostic client already cover the pattern.

status: completed
