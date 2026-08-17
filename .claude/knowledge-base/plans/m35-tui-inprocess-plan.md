---
slug: m35-tui-inprocess
milestone_id: M35
created_at: 2026-07-08
goal: Realize the TUI as a single-process surface (Model A) via a framework-owned in-process agent-turn seam, reused by the Ink TUI, with HTTP client/server kept as fallback.
---

# Plan — M35 Phase 3: TUI terminal-only in-process surface (Model A)

## Goal

One agent construction, driven in a SINGLE Node process by the Ink TUI — no HTTP loopback, no port,
no CSRF — via a **framework-owned in-process turn seam** (`streamAgentTurnInProcess`), symmetric to
the HTTP mount, reusing `compileAgentModule` + `streamAgentUIMessages` (zero reimplementation). HTTP
client/server (Model B) preserved as the multi-surface fallback. Blueprint:
`m35-tui-inprocess-blueprint.md`.

## Baseline Context

- Framework in-process primitive EXISTS: `packages/theo/src/server/agent/run-terminal-agent.ts`
  (`runAgentInTerminal`) — same `compileAgentModule` + `streamAgentUIMessages` + registry HITL,
  renders to stdout via `render-terminal.ts` (lossy for the Ink TUI).
- HTTP mount parity ref: `mount-agent.ts` builds `hitl={gated,awaitApproval→registry}` +
  `streamAgentUIMessages`.
- Ink TUI (theo-code-v2): `apps/tui/main.tsx` → `run-turn-http.ts` (HTTP+SSE) → `applyChunk`
  (`sse-translate.ts`, the reusable translator) → TUI handlers.
- Test convention: `tests/unit/run-terminal-agent.test.ts` mocks `@theokit/agents` with a
  `__compiled` wrapper — deterministic, no LLM.

## Coverage Matrix (DoD → task)

| DoD (roadmap M35) | Task |
|---|---|
| In-process turn path (no Request, no server) | T1 — framework seam `streamAgentTurnInProcess` |
| Terminal-only mode selectable; HTTP fallback | T3 — `main.tsx` + `bin` mode select |
| Parity in-process == HTTP | T2 — parity + unit tests (framework) |
| Distribution: single npm bin, example runs both modes | T4 — wire example TUI + tmux evidence |
| Gates green; CHANGELOG; arch-doc gap closed | T5 — docs + CHANGELOG + gates |

## Tasks

### T1 — Framework seam `streamAgentTurnInProcess` (theokit)
`packages/theo/src/server/agent/stream-agent-turn-in-process.ts`:
`streamAgentTurnInProcess(mod, apiKey, { message, sessionId?, awaitApproval?, source?, signal? }, deps={stream:streamAgentUIMessages}): AsyncGenerator<UIMessageChunk>`.
- compileAgentModule(mod, source); if `compiled.hitl?.size>0` and no `awaitApproval` → throw typed
  `InProcessApprovalRequiredError` (fail-fast, Rule 8). Build `hitl={gated, awaitApproval:(id,opts,name)=>input.awaitApproval({approvalId:id,toolName:name,opts})}`; else undefined.
- yield* deps.stream(compiled, apiKey, { message, sessionId: sessionId??randomUUID(), hitl, signal }).
- Export from `packages/theo/src/server/index.ts`.
- **TDD RED:** unit test — gated agent + awaitApproval → awaitApproval called with `{approvalId,toolName,opts}`, decision honored; gated agent WITHOUT awaitApproval → throws `InProcessApprovalRequiredError`; non-gated → no hitl, chunks pass through; `deps.stream` receives the compiled + message.

### T2 — Parity test (theokit)
`tests/integration/agent-turn-in-process-parity.test.ts`: the same compiled agent + same canned chunk
sequence, drained through the in-process seam AND through the HTTP `applyChunk`-style translator,
yields identical handler dispatch. Asserts the seam passes the SAME args to `streamAgentUIMessages` the
HTTP mount does (minus Request/CSRF).

### T3 — Mode select (example)
`apps/tui/main.tsx`: default = in-process (import `code` agent module + `streamAgentTurnInProcess`);
`THEO_CODE_URL` set OR `--http` flag → `httpRunTurn` fallback. `bin/theo-code.mjs` `tui` documents both.

### T4 — Wire example TUI + evidence
`apps/tui/run-turn-inproc.ts`: consumes `streamAgentTurnInProcess(codeMod, apiKey, {message, sessionId,
awaitApproval})`, feeds `applyChunk` → handlers; `awaitApproval → handlers.onApproval`. Verify in the
tmux `theokit`: in-process turn streams a real model response with NO server running + a gated tool
(`bash`) prompts inline (HITL in-process). Also verify HTTP fallback still works.

### T5 — Docs + gates
Close the `docs/architecture/multi-surface-architecture.md` §9 gap ("callProcedure not yet wired into
the TUI" → realized). CHANGELOG `### Added`. All gates green (test/typecheck/lint/code-quality).

## Test Plan
- Unit (T1): hitl bridge + fail-fast + passthrough (mock `@theokit/agents`).
- Integration (T2): in-process vs HTTP parity of handler dispatch.
- Live (T4): tmux — in-process turn (no server) + inline HITL prompt + HTTP fallback.

## Drawbacks & Risks
1. Two turn paths diverge → mitigated: both call the SAME `streamAgentUIMessages`; parity test gates.
2. Provider key / streaming in-process without the SSE layer → mitigated: consume the generator
   directly; reuse `applyChunk` (the translator the SSE path already used).

## Unresolved Questions
(none — the seam signature, HITL bridge, and apiKey convention are all resolved in the blueprint.)

## Prior Art
OpenCode (always client/server HTTP+SSE), Codex (single-process subprocess+JSONL) — see blueprint
Coverage Corner 4. TheoKit's in-process-in-same-Node model is simpler than both (no subprocess, no
HTTP), enabled by the SDK being a TS in-process library.
