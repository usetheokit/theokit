---
slug: tui-terminal-only-inprocess
generated_by: roadmap-feature
milestone_id: M35
date: 2026-07-08
status: completed
---

# Feature grill — TUI terminal-only in-process (Model A)

## Q1 — What is this feature and why NOW (what changed)?

Realize the TUI as a **single-process** surface — the TUI drives agent turns via the M33
in-process caller (`callProcedure`) with NO HTTP loopback, NO port, NO CSRF (the Claude Code /
Codex single-process shape). **Why now:** the distribution question surfaced in conversation
(2026-07-08) — today the TUI only works client/server over HTTP-loopback (`THEO_CODE_URL`,
`apps/tui/run-turn-http.ts`), needing a running server and crossing the CSRF boundary. For a
terminal-only agent app that is over-heavy. M33 already shipped the `callProcedure` seam precisely
to collapse this to one process; wiring it into the TUI is the realization the GOLD GOAL (M32→M34)
authorized but never delivered, and it unblocks single-binary distribution.

## Q2 — Dependencies (must be [x] before start)

M33 (in-process caller — [x]), M31 (builder authoring — [x]), M32 (surfaces authorized — [x]).

## Q3 — Definition of done (user chose: full wire + example + package)

- In-process turn path: TUI run-turn uses the M33 caller to drive a turn WITHOUT synthesizing an
  HTTP Request or spawning a server; SDK runtime runs in-process.
- Terminal-only mode selectable via flag/env — no port, no CSRF, no localhost server.
- HTTP loopback (Model B) preserved as fallback (multi-surface one-server case).
- Parity test: in-process turn == HTTP turn result.
- Single npm bin distributes the terminal-only app as one process; example runs both modes live.
- Gates green; CHANGELOG `### Added`; architecture doc gap closed.

## Q4 — Top 2 NEW risks

1. Two turn paths (in-process vs HTTP) diverge in CSRF/validation/streaming shape. Mitigation:
   in-process path reuses the SAME shared core (`validateRouteInput` + SDK stream) the HTTP path
   uses; parity test is the gate (extends M33's contract).
2. SDK runtime in-process needs provider key + streaming without the HTTP SSE-translate layer.
   Mitigation: consume `Run.stream()` directly; the TUI reuses the event shape `sse-translate.ts`
   already defines as the contract.
