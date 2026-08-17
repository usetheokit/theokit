---
slug: terminal-harness
milestone_id: M5
created_at: 2026-07-04
kind: discovery-blueprint
---

# Blueprint: Terminal harness — the M4 harness rendered to the terminal (M5 — Eixo D)

> **Version 1.0.** How prior-art terminal agent harnesses render stream + tool calls + approval, and
> what TheoKit should adopt to run a local agent in the terminal **reusing the M4 harness** (same
> adapter over `@theokit/sdk`, different render surface) — no new runtime, minimal dev-time scope.

## Research questions

1. How do state-of-the-art terminal agent harnesses render streaming text, tool calls, and reasoning?
2. How do they prompt for and capture a human tool-approval decision in the terminal?
3. What is the transport/architecture (in-process render vs. separate daemon + protocol)?
4. Is a TUI framework (ink / `@ai-sdk/tui` / OpenTUI / pi-tui) required, or does Node stdlib suffice
   for a minimal dev-time harness that consumes an existing `UIMessageChunk` stream?
5. What is the honest wedge for a terminal surface inside a WEB-shaped framework?

## Prior art surveyed (all locally cloned under `knowledge-base/references/`)

| Project | Stack | Architecture | Approval UX | Verdict for TheoKit |
|---|---|---|---|---|
| **`@ai-sdk/tui`** (`ai-sdk/packages/tui`) | Raw `process.stdout` + ANSI + manual `process.stdin`; **zero external TUI deps** (only `ai`) | In-process, full-screen `AgentTUIRunner` REPL | `y`/`n` keypress → `{approved, reason}` (`terminal-renderer.ts:327-382`) | **Reference, not reuse** — monolithic runner, input contract is `agent.stream()`/`TextStreamPart` (`agent-tui-runner.ts:216-230`), not our `UIMessageChunk`; not composable |
| **opencode** (`opencode/packages/tui` + `/cli`) | Solid.js + `@opentui/core` (`packages/tui/package.json:54-56`) | **Separate daemon process + HTTP/SSE** (`cli/src/services/daemon.ts:122,137`) | reactive `<PermissionPrompt>` → `permission.reply({reply})` (`session/permission.tsx:168-173,405`) | **Avoid** — a full CLI product (daemon, auth, plugins, persistence) far outside the web wedge |
| **mastracode** (`mastra/mastracode/src/tui`) | `@earendil-works/pi-tui` + `chalk` (`package.json`) + raw stdin | In-process components | dialog `y`/`n`/`a`/`Y` (`components/tool-approval-dialog.ts`) | TUI-framework dependency — heavier than needed |
| **codex** (`codex-rs/tui`) | Rust `ratatui` + `crossterm` | In-process | arrow-select + Enter/Esc; decisions `Accept`/`AcceptForSession`/`Cancel` (`approval_events.rs`, `cwd_prompt.rs`) | Interaction MODEL only (not the lang) |

## Coverage Corner 1 — Integration Tests

- **The behavioral proof is an integration test over the render surface, not a live LLM.** Mirror
  M4's `hitl-harness.test.ts`: stub `createSdkAgentStream`, drive a gated-tool run, and assert the
  terminal renderer WROTE the expected lines to a captured `stdout` (a `Writable` sink) and that the
  approval prompt resolved the in-process registry. `@ai-sdk/tui` itself is tested by feeding a fixed
  stream and asserting frame output — same shape.
- **Deterministic I/O injection:** the renderer MUST accept injectable `stdout: Writable` + an
  injectable input source (not hard `process.stdout`/`process.stdin`) so a test drives it without a
  TTY. `@ai-sdk/tui` hard-codes `process.stdin/out` (`terminal-renderer.ts`) — a testability
  anti-pattern TheoKit must avoid (dependency injection at the boundary).
- **TTY / non-TTY:** a test asserts non-TTY (piped/CI, `stdout.isTTY` falsy) degrades safely — the
  approval auto-denies (fail-safe, matching HITL `onTimeout: 'abort'`) rather than hanging on a prompt.

## Coverage Corner 2 — Dependencies

- **Node stdlib only — NO new dependency.** `node:readline` (`createInterface`, `rl.question`) for the
  blocking approval prompt; `process.stdout.write` + minimal ANSI for rendering; `process.stdin.isTTY`
  for TTY detection. This is the parsimony-ladder outcome (rungs 2–3: stdlib/native resolve the need).
- **Why not `@ai-sdk/tui`:** input-contract mismatch (`TextStreamPart` vs our `UIMessageChunk`), a
  monolithic non-composable runner, and hard-coded `process.stdin/out` (untestable). Adopting it would
  be a dependency that fights our harness boundary — a Rule-9 misfit, not a win.
- **Why not ink / pi-tui / OpenTUI:** they buy in-place delta compaction + rich layout we do NOT need
  for a dev-time sequential log. YAGNI + risk-2 (the ROADMAP's TUI-lib risk) avoided outright.
- **deps-audit:** trivially clean — zero third-party deps added.

## Coverage Corner 3 — Tools

- **The exact M4 harness surface is the input:** `compileAgentModule(mod)` → `streamAgentUIMessages(compiled, apiKey, { message, sessionId, hitl })` (already emits the `UIMessageChunk` async iterable). The terminal harness is a CONSUMER of that iterable — the same producer the web `mountAgent` uses.
- **The approval registry is reused wholesale:** `createInProcessApprovalRegistry()` /
  `getApprovalRegistry()` (M4). In a single-process CLI the stream's `awaitApproval` (→ `registry.register`)
  and the terminal prompt (→ `registry.resolve`) share the one in-process instance — the exact design
  the M4 singleton was built for. No HTTP approve route; the readline prompt IS the resolver.
- **Provider/apiKey resolution:** `resolveProvider()` (M2) supplies the apiKey, same as the web path.
- **Agent scan:** `scanAgents(projectRoot)` (M2) locates `agents/<name>.ts` for a `theokit agent <name>` command.

## Coverage Corner 4 — Techniques

- **Sequential render, blocking approval.** A dev-time harness renders chunks in arrival order to
  stdout; on `tool-approval-request` it PAUSES, prompts, and resolves — approval is inherently
  blocking (the SDK run is already paused in the awaited `pre_tool_call` hook), so sequential stdout
  fits perfectly. No concurrent-render machinery, no frame buffer.
- **readline vs raw mode (critical gotcha):** you CANNOT mix `readline.createInterface` (line-buffered)
  with `setRawMode` on the same stdin at once. For a `y/n` decision, `rl.question` needs NO raw mode —
  simplest + testable. Reserve raw-mode keypress for a future arrow-select (codex model) — YAGNI now.
- **Chunk → line mapping:** `text-delta`→write delta; `reasoning-*`→a dim "thinking" line; `tool-input-available`→a `▸ tool <name>(input)` card; `tool-output-available`/`-error`→the result/error line; `tool-approval-request`→the prompt; `data-checkpoint`→a dim "checkpoint saved" line; `error`→a red line; `finish`→newline. Mirrors M4's translator branches, one surface down.
- **Fail-safe on non-TTY:** if `!stdout.isTTY` (piped, CI, no interactive stdin), auto-deny approvals with a printed notice — never hang waiting for input that can't come.

## ADRs (design decisions this blueprint locks)

### ADR-T1 — Reuse `streamAgentUIMessages`; render surface is the only new code
The terminal harness consumes the M4 `UIMessageChunk` stream and resolves the M4 registry. It adds NO
runtime, NO second loop, NO LLM call, NO tool dispatch — only a `stdout` renderer + a `readline`
approval prompt. Enforced by the same invariant-guard style test as M4.

### ADR-T2 — Node stdlib, no TUI framework
Rendering = `process.stdout` + minimal ANSI; approval input = `node:readline`. No ink / `@ai-sdk/tui`
/ OpenTUI / pi-tui. Rationale: input-contract fit, testability (injectable I/O), zero-dep, YAGNI. The
richer TUI surface (`@ai-sdk/tui`) is a documented future upgrade if a product-grade CLI is ever
green-lit — explicitly out of the dev-time wedge.

### ADR-T3 — Injectable I/O boundary (testability)
The renderer takes `{ stdout: Writable, input?: Readable/isTTY }` — never hard `process.*` — so the
integration test drives it deterministically (the exact testability gap `@ai-sdk/tui` has).

## Wedge (feeds the M5 gate ADR)

TheoKit's wedge is "the app the agent lives in" (web, on a real domain). The terminal harness enters
as a **dev-time / local surface** — a fast local feedback loop to run a scanned `agents/<name>.ts` in
the terminal (stream + tool cards + approval) WITHOUT the browser round-trip — and as a **proof that
the M4 harness is render-surface-agnostic** (same adapter → web OR terminal). It is explicitly NOT a
"CLI agent product" (opencode's territory, outside the wedge): no daemon, no persistence, no plugin
system, no multi-session management. Scope discipline is the mitigation for the ROADMAP's risk-1.

## References (all resolve on disk)

- `knowledge-base/references/ai-sdk/packages/tui/package.json`
- `knowledge-base/references/ai-sdk/packages/tui/src/run-agent-tui.ts`
- `knowledge-base/references/ai-sdk/packages/tui/src/agent-tui-runner.ts`
- `knowledge-base/references/ai-sdk/packages/tui/src/tui/terminal-renderer.ts`
- `knowledge-base/references/opencode/packages/tui/package.json`
- `knowledge-base/references/opencode/packages/cli/src/services/daemon.ts`
- `knowledge-base/references/opencode/packages/tui/src/routes/session/permission.tsx`
- `knowledge-base/references/mastra/mastracode/src/tui/`
- `knowledge-base/references/codex/codex-rs/tui/src/cwd_prompt.rs`
