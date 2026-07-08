# Blueprint — M35 TUI terminal-only in-process (Model A)

Deep-research verdict (OpenCode + Codex, cloned sources, Staff-level, file:line).

## Coverage Corner 1 — Integration Tests
- Framework parity seam tested by mocking `@theokit/agents` (`compileAgentModule` + `streamAgentUIMessages`) with a `__compiled` wrapper — proven convention in `tests/unit/run-terminal-agent.test.ts:24-33`.
- Turn-level parity: in-process and HTTP paths both call the SAME `streamAgentUIMessages`; the shared translator `applyChunk` (theo-code-v2 `apps/tui/sse-translate.ts`) guarantees identical handler dispatch. Test feeds an identical chunk sequence through both drains and asserts identical handler calls.

## Coverage Corner 2 — Dependencies
- No new dependency. Reuses `@theokit/agents` `streamAgentUIMessages` (`bridge-entry-DG3jbXjs.d.ts:958`), `compileAgentModule` (`:928`), `HitlWiring` (`:890`), `StreamHitlOptions` (`:933`). apiKey via existing env convention (`core/tools/task.ts:53` uses `process.env.OPENROUTER_API_KEY`).

## Coverage Corner 3 — Tools
- Existing framework primitive `runAgentInTerminal` (`packages/theo/src/server/agent/run-terminal-agent.ts`) already streams in-process to **stdout** (M5/ADR-0039). Gap: it renders lossy text; the rich Ink TUI needs structured events. → extract a public **stream** seam.

## Coverage Corner 4 — Techniques
- **Reference OpenCode (client/server, ALWAYS HTTP+SSE):** daemon spawns a detached `serve --register` child (`references/opencode/packages/cli/src/services/daemon.ts:121-128`), TUI connects over HTTP; events via SSE `GET /api/event` (`packages/server/src/handlers/event.ts:17-46`); reuse-if-healthy via `~/.opencode/state/server.json` (`daemon.ts:110-135`); distribution = 12 precompiled platform binaries via `bun build --compile` (`packages/cli/script/build.ts:24-103`). **No in-process mode exists** — definitive.
- **Reference Codex (single-process):** SDK spawns the codex binary as a subprocess, reads **JSONL over stdout** (`references/codex/sdk/typescript/src/exec.ts:86-225`), events are a discriminated union `ThreadEvent` (`events.ts:6-82`). No HTTP for its own TUI.
- **TheoKit Model A (simpler than both):** the TUI is TS, so it imports the core and runs `streamAgentUIMessages` in the SAME Node process — no subprocess (Codex), no HTTP server (OpenCode). This is only possible because the SDK runtime is a TS library in-process.

## HITL in-process (the hard part)
HTTP mount builds `hitl = { gated: compiled.hitl, awaitApproval: (id,opts,name) => registry.register(...) }` and resolves it via a SECOND HTTP POST to `/approve/:id` (`packages/theo/src/server/agent/mount-agent.ts:113-131` mirror; installed `chunk-BLL5LY7R.js:1215-1230`). In-process there is no second request — the caller resolves the approval **inline** via a direct `awaitApproval` callback (the Ink TUI's `onApproval` y/n). `HitlWiring.awaitApproval` may resolve a bare boolean OR a `HitlDecision` (`bridge-entry:912-916`).

## ADR — design decision
The in-process turn seam is FRAMEWORK-owned (theokit), symmetric to the HTTP mount, reusing `compileAgentModule` + `streamAgentUIMessages` (zero reimplementation, G2 honored). It returns `AsyncGenerator<UIMessageChunk>` with HITL wired to a caller-supplied inline `awaitApproval`. Consumers: stdout renderer (existing), Ink TUI (M35), Tauri (M36) — one seam, N renderers. Alternatives rejected: (a) duplicate the compile+hitl dance in the example → DRY/parity risk the roadmap flags; (b) refactor `runAgentInTerminal` to drop its registry → needless rework/regression risk on a shipped M5 API.
