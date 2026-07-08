---
"theokit": minor
"@theokit/agents": minor
---

M35 — TUI terminal-only in-process surface (Model A).

- `theokit/server` exports `streamAgentTurnInProcess(mod, apiKey, { message, awaitApproval? })`: run an
  agent turn in a SINGLE process — no HTTP loopback, no port, no CSRF — reusing `compileAgentModule` +
  `streamAgentUIMessages` (zero runtime reimplementation, G2). HITL is resolved INLINE via a caller
  `awaitApproval` callback (the Claude Code / Codex single-process shape); a gated agent run without a
  resolver throws `InProcessApprovalRequiredError` (fail-closed — the #99 lesson). Parity with the HTTP
  mount is by construction: both call the same `streamAgentUIMessages`.
- `@theokit/agents` now publicly exports the `HitlDecision` type — the settled approval decision an
  `awaitApproval` resolver may return (bare boolean OR `{ approved, reason?, payload? }`).
