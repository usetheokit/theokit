---
"theokit": minor
---

Terminal harness (M5, Eixo D) — run a local agent in the terminal, reusing the M4 harness with a
Node-stdlib render surface (no new runtime, no TUI dependency; ADR 0039).

- `theokit agent <name> "<message>"` scans `agents/<name>.ts`, compiles it via the M4
  `compileAgentModule` (through the framework's own Vite transpile), and runs it through
  `streamAgentUIMessages` — rendering streaming text, tool cards, a checkpoint notice, and errors to
  the terminal.
- A `@HumanInTheLoop`-gated tool prompts `Approve <tool>? (y/N)` inline and resolves the SAME
  in-process approval registry the web approve-route uses (single-process CLI = the registry
  singleton's exact fit). A non-interactive terminal auto-denies (fail-safe).
- New: `renderAgentStreamToTerminal` + `promptTerminalApproval` + `runAgentInTerminal` (injectable
  I/O for testability). Additive — the M2/M4 surface is unchanged.
