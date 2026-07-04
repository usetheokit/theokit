---
slug: terminal-harness
milestone_id: M5
created_at: 2026-07-04
goal: Run a local agent in the terminal — streaming text + reasoning + tool cards + a HITL approval prompt — by reusing the M4 harness (streamAgentUIMessages + the in-process approval registry) with a Node-stdlib render surface, no new runtime and no TUI dependency
---

# Plan: Terminal harness — the M4 harness rendered to the terminal (M5 — Eixo D)

> **Version 1.0** — Add a dev-time terminal surface that runs a scanned `agents/<name>.ts` in the
> terminal (stream + tool cards + HITL approval), reusing the M4 harness verbatim (same adapter over
> `@theokit/sdk`). Node stdlib only (`process.stdout` + `node:readline`), no TUI framework. Grounded
> in blueprint `terminal-harness` + the accepted gate ADR 0039.

## Goal

> `theokit agent <name> [message]` scans `agents/<name>.ts`, compiles it via the M4
> `compileAgentModule`, and runs it through `streamAgentUIMessages`, rendering the resulting
> `UIMessageChunk` stream to the terminal: streaming text, a dim reasoning line, `▸ tool(input)` /
> result cards, a checkpoint notice, and errors. When the agent hits a `@HumanInTheLoop`-gated tool,
> the terminal PROMPTS `Approve <tool>? (y/n)` and resolves the SAME in-process approval registry the
> web approve-route uses — approve runs the tool, deny/timeout/non-TTY denies and the run continues.
> No new runtime, no LLM call, no tool dispatch, no TUI dependency. Measured by a deterministic
> SDK-stubbed integration test (pause → approve → run → done + the deny path) writing to a captured
> `stdout`, and an invariant guard proving no parallel runtime.

## Context

M5 of `ROADMAP.md` (theokit-ai-first, Eixo D), depends on M4 (READY_TO_MERGE on `develop`). The wedge
GATE (ADR 0039) is accepted: the terminal harness is a **dev-time/local** surface that reuses the M4
harness and adds only a render surface (D2), built on Node stdlib with an injectable I/O boundary
(D3/D4). It is explicitly not a CLI product (D1).

## Baseline Context (deep review of current state)

| File | Role | M5 touch |
|---|---|---|
| `packages/agents/src/bridge/agent-endpoint.ts` | `compileAgentModule` + `streamAgentUIMessages` (emits `UIMessageChunk`) — M4 | CONSUME (import), unchanged |
| `packages/theo/src/server/agent/mount-agent.ts` | web consumer of `streamAgentUIMessages` (→ HTTP Response) + HITL wiring | mirror its HITL wiring in the terminal entry (do not edit) |
| `packages/theo/src/server/agent/approval-registry.ts` | `createInProcessApprovalRegistry` / `getApprovalRegistry` — M4 | REUSE (the terminal prompt resolves it) |
| `packages/theo/src/server/agent/provider-resolver.ts` | `resolveProvider()` → apiKey — M2 | REUSE |
| `packages/theo/src/server/scan/agent-scan.ts` | `scanAgents(projectRoot)` → `AgentNode[]` — M2 | REUSE (locate `agents/<name>.ts`) |
| `packages/theo/src/cli/index.ts` | `cac` CLI command registry | ADD `agent <name> [message]` command |
| `packages/theo/src/cli/commands/*` | per-command modules | ADD `agent.ts` (entry) |

- **Git sha at plan time:** the HEAD of `develop` after the M4 review-fixes commit (`1d54ba4`).
- **Verified reuse points:** `streamAgentUIMessages(compiled, apiKey, { message, sessionId, hitl, signal })` (M4) yields the `UIMessageChunk` stream; `HumanInTheLoopOptions` gate map is on `compiled.hitl`; `getApprovalRegistry()` is the process singleton; `compileAgentModule` gathers `@Mixin` toolboxes (M4-P5).
- **Glossary:** *terminal harness* = the M4 harness with a stdout render surface + a readline approval prompt; *render surface* = the pure chunk→line writer; *entry* = the CLI-facing glue that wires harness + renderer.

## Prior Art & Related Work

- **`@ai-sdk/tui`** — zero-dep raw-stdout + ANSI + manual stdin; a monolithic `AgentTUIRunner` taking `agent.stream()`/`TextStreamPart` (`references/ai-sdk/packages/tui/src/agent-tui-runner.ts:216-230`), `y/n` approval (`terminal-renderer.ts:327-382`). Reference for the render/approval MODEL; not a reuse target (wrong input contract + hard-coded `process.*`).
- **opencode** — Solid.js + OpenTUI, separate daemon + HTTP/SSE (`references/opencode/packages/cli/src/services/daemon.ts:122`). A CLI product — the cautionary anti-pattern (ADR 0039 D1).
- **mastracode / codex** — `y/n/a/Y` and arrow-select approval models; confirm `y/n` is the minimal viable decision.
- **M4 web consumer** — `mount-agent.ts` is the sibling consumer; the terminal entry mirrors its HITL wiring.

## Objective

Add `renderAgentStreamToTerminal` (pure, injectable I/O) + `promptTerminalApproval` (readline, non-TTY
auto-deny) + `runAgentInTerminal` (entry) + the `theokit agent` command, reusing the M4 harness, with a
deterministic integration test and an invariant guard.

## ADRs

### ADR-M5a — The renderer is pure over an injectable `stdout`; the entry owns the wiring
`renderAgentStreamToTerminal(chunks, { stdout, onApproval })` writes lines and delegates approval to
the injected `onApproval` — it touches no `process.*`, so a test drives it with a capture `Writable`
+ a scripted `onApproval`. The entry (`runAgentInTerminal`) wires `process.stdout` +
`promptTerminalApproval` + `registry.resolve`. (Testability — ADR 0039 D4.)
- **Alternatives.** Hard-code `process.stdout`/`readline` inside the renderer (the `@ai-sdk/tui`
  anti-pattern) → untestable. Rejected.

### ADR-M5b — Non-TTY / non-interactive ⇒ auto-deny approvals (fail-safe)
When `!stdout.isTTY` OR stdin is not interactive (piped/CI), `promptTerminalApproval` returns `false`
without prompting and prints a notice — never hangs. Matches the HITL `onTimeout: 'abort'` philosophy
(a decision that cannot be obtained is a deny, never an auto-approve).
- **Alternatives.** Hang waiting for input (bad UX / CI deadlock); auto-approve (unsafe). Rejected.

## Phase 1: The render surface + the approval prompt

#### Objective
A pure `renderAgentStreamToTerminal` that maps each `UIMessageChunk` to terminal output on an
injectable `stdout`, and `promptTerminalApproval` (readline `y/n`, non-TTY auto-deny).

#### Why this step (action + reasoning)
The only NEW code M5 adds is the render surface (ADR 0039 D2). Building it pure + injectable first
(ADR-M5a) makes the whole feature deterministically testable before any CLI glue.

#### Evidence
- Chunk union to map: M4 translator branches (`ui-message-stream-translator.ts`): `start`,
  `text-start/-delta/-end`, `reasoning-*`, `tool-input-available`, `tool-output-available/-error`,
  `tool-approval-request {approvalId, toolCallId}`, `data-checkpoint`, `error`, `finish`.
- `node:readline` `createInterface` + `rl.question`; `stdout.isTTY` (blueprint Corner 4).

#### Files to edit
- `packages/theo/src/server/agent/render-terminal.ts` (new — `renderAgentStreamToTerminal` + `promptTerminalApproval`)

#### Deep Dives
`readline` line-buffered mode cannot coexist with `setRawMode` on the same stdin; `y/n` needs no raw
mode, so `rl.question` is the minimal + testable choice (blueprint Corner 4). The renderer is sequential
(one chunk → its line(s)); approval is blocking (the SDK run is already paused in the awaited hook), so
sequential stdout fits with no frame buffer.

#### Pseudo-code / Signatures
```ts
interface TerminalRenderOptions {
  stdout: Writable
  onApproval: (req: { approvalId: string; toolName: string }) => Promise<void>
}
async function renderAgentStreamToTerminal(
  chunks: AsyncIterable<UIMessageChunk>, opts: TerminalRenderOptions,
): Promise<void>

function promptTerminalApproval(
  req: { toolName: string }, io: { input: Readable & { isTTY?: boolean }; output: Writable & { isTTY?: boolean } },
): Promise<boolean> // non-TTY ⇒ false without prompting
```

#### Tasks
- T1.1 `renderAgentStreamToTerminal` — chunk → line mapping to injectable `stdout`; on
  `tool-approval-request`, `await opts.onApproval({ approvalId, toolName })`.
- T1.2 `promptTerminalApproval` — readline `y/n` over injectable io; non-TTY ⇒ `false`.

#### TDD
- T1.1 RED: `test_renders_text_tool_and_checkpoint_chunks_to_stdout` — feed a fixed chunk list, assert
  the captured `stdout` string contains the text, a `▸ ops.deploy` tool card, the result, and a
  checkpoint notice; `test_calls_onApproval_on_tool_approval_request` — a `tool-approval-request` chunk
  triggers `onApproval` with the `approvalId`.
- T1.2 RED: `test_prompt_returns_true_on_y` / `test_prompt_returns_false_on_n` (scripted readline input);
  `test_prompt_non_tty_auto_denies_without_prompting` (stdout.isTTY=false ⇒ false, no question written).

#### Failure scenarios (external I/O)
- `test_prompt_non_tty_auto_denies_without_prompting` (above) — the non-interactive fail-safe (ADR-M5b).
- `test_renderer_surfaces_error_chunk` — an `error` chunk prints a visible error line (not swallowed).

#### Concurrency tests (only when applicable)
(none — single-threaded sequential render; approval is a blocking prompt.)

#### Acceptance Criteria
- Every `UIMessageChunk` variant maps to output (or is intentionally ignored); approval delegates to
  `onApproval`; non-TTY auto-denies. 6+ RED tests green.

#### DoD
- Renderer + prompt pure and injectable; tests green; CHANGELOG updated.

## Phase 2: The entry + the `theokit agent` command

#### Objective
`runAgentInTerminal` wires the M4 harness to the renderer over the shared registry; the `theokit
agent <name> [message]` command scans + resolves the provider + runs it.

#### Why this step (action + reasoning)
DoD-2 ("a command/example runs an agent in the terminal") + DoD-3 (reuse the M4 harness). The entry is
the glue; the registry the stream registers into is the SAME one the prompt resolves (single process).

#### Evidence
- `compileAgentModule` / `streamAgentUIMessages` (M4, `agent-endpoint.ts`); `getApprovalRegistry` /
  `createInProcessApprovalRegistry` (M4, `approval-registry.ts`); `resolveProvider` (`provider-resolver.ts`);
  `scanAgents` (`scan/agent-scan.ts`); `cac` command pattern (`cli/index.ts:15-21`).

#### Files to edit
- `packages/theo/src/server/agent/run-terminal-agent.ts` (new — `runAgentInTerminal(mod, { message, sessionId?, stdout?, registry? })`: builds hitl wiring from `compiled.hitl` + registry like `mount-agent`, streams, renders, `onApproval` = prompt then `registry.resolve`)
- `packages/theo/src/cli/commands/agent.ts` (new — `agentCommand(name, message?)`: `scanAgents` → load module → `resolveProvider().apiKey` → `runAgentInTerminal`)
- `packages/theo/src/cli/index.ts` (register `agent <name> [message]`)

#### Deep file dependency analysis
The entry mirrors `mount-agent`'s HITL construction (`gated = compiled.hitl`; `awaitApproval` →
`registry.register`) but resolves via the readline prompt instead of the HTTP approve route. It injects
the SAME `registry` into both the stream (register) and the renderer's `onApproval` (resolve) — the M4
singleton design. The CLI loads the module via a dev loader / dynamic import of the resolved
`agents/<name>.ts` path (reuse the module-load approach the dev middleware uses).

#### Pseudo-code / Signatures
```ts
async function runAgentInTerminal(mod: unknown, input: {
  message: string; sessionId?: string; stdout?: Writable; registry?: ApprovalRegistry;
  promptApproval?: (req) => Promise<boolean>; source?: string;
}): Promise<void>
```

#### Tasks
- T2.1 `runAgentInTerminal` — compile + stream (hitl over registry) + render; `onApproval` prompts + resolves.
- T2.2 `agentCommand(name, message?)` — scan, load, resolve provider, run; fail-fast on unknown agent / missing message.
- T2.3 register the `agent <name> [message]` command in `cli/index.ts`.

#### TDD
- T2.1 RED: `test_e2e_terminal_pause_approve_runs_tool_then_done` — SDK-stubbed (mirror
  `hitl-harness.test.ts`), inject a capture `stdout` + a scripted `promptApproval=()=>true` + a fresh
  registry; assert stdout shows the approval prompt line, the tool ran (`deployed`), and a done/finish;
  `test_e2e_terminal_deny_surfaces_denied_and_continues` (`promptApproval=()=>false` → denial line +
  continues); `test_e2e_terminal_non_gated_runs_without_prompt`.
- T2.2 RED: `test_agentCommand_unknown_agent_fails_fast` (typed error naming the agent);
  `test_agentCommand_missing_message_fails_fast`.

#### Failure scenarios (external I/O)
- `test_e2e_terminal_deny_surfaces_denied_and_continues` — the deny path (loop continues, no crash).
- `test_agentCommand_unknown_agent_fails_fast` — a bad `<name>` fails with a clear message, not a stack.

#### Concurrency tests (only when applicable)
(none — one agent run per invocation; approval is sequential.)

#### Acceptance Criteria
- `runAgentInTerminal` drives pause→approve→run→done + deny to a captured stdout via the shared
  registry; the command scans + runs; unknown-agent/missing-message fail fast. 5+ RED tests green.

#### DoD
- Entry + command wired; deterministic E2E green; CHANGELOG updated.

## Phase 3: Invariant guard + CHANGELOG + changeset

#### Objective
Prove no new runtime, and ship the docs/changeset.

#### Why this step (action + reasoning)
ADR 0039 D2 enforcement teeth + release hygiene.

#### Files to edit
- `tests/unit/terminal-harness-invariant-guard.test.ts` (new — the terminal files call no LLM API, no `fetch`, and reuse `streamAgentUIMessages`; no reimplemented loop)
- `CHANGELOG.md` (Added — the terminal harness) + `.changeset/terminal-harness.md` (`theokit` minor)
- `examples/agent-saas/README.md` (append: run it in the terminal with `theokit agent ops`)

#### Tasks
- T3.1 invariant guard test.
- T3.2 CHANGELOG + changeset + example README note.

#### TDD
- T3.1 RED: `test_terminal_harness_has_no_parallel_runtime` — grep the terminal source files for LLM
  API hosts (0) + `fetch(` (0); assert `run-terminal-agent.ts` imports `streamAgentUIMessages` (reuse),
  not a new loop.

#### Failure scenarios (external I/O)
(none new.)

#### Concurrency tests (only when applicable)
(none.)

#### Acceptance Criteria
- Invariant guard green; CHANGELOG + `theokit`-minor changeset present; example README documents the command.

#### DoD
- Guard green; changeset in place; ready for `/review`.

## Coverage Matrix

| Goal claim | Task(s) |
|---|---|
| `theokit agent <name> [message]` runs a scanned agent | T2.2, T2.3 |
| renders streaming text + reasoning + tool cards + checkpoint + error | T1.1 |
| HITL approval prompt in the terminal (`y/n`) | T1.2, T2.1 |
| resolves the SAME in-process registry (reuse M4) | T2.1 |
| approve runs tool / deny continues | T2.1 |
| non-TTY auto-denies (fail-safe) | T1.2 |
| no new runtime / no TUI dep | T3.1 (guard), deps-audit |
| reuse `streamAgentUIMessages` verbatim | T2.1, T3.1 |

## Drawbacks & Risks

1. **Sequential stdout is less polished than a frame-buffered TUI** (`@ai-sdk/tui`). Accepted tradeoff
   for a dev tool (ADR 0039 consequences) — mitigated by keeping scope to a dev-time loop.
2. **Non-TTY auto-deny means CI/piped runs cannot approve.** By design (ADR-M5b, fail-safe) — documented.
3. **Scope creep into a CLI product.** Mitigated by ADR 0039 D1 + the invariant guard + minimal surface.

## Unresolved Questions

(none — the wedge, the stdlib-vs-TUI decision, and the reuse boundary are all locked by ADR 0039.)

## Dependencies

`## Dependencies` — **zero new third-party dependencies** (Node stdlib `node:readline` + `process.stdout`
only; `ai`'s `UIMessageChunk` type is already a dependency via M4). No CVE surface added. `/deps-audit`
is trivially clean.
