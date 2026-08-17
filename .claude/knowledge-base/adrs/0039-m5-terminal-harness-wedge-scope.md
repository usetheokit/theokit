# ADR 0039 — M5 terminal harness: wedge decision + scope (GATE)

- **Status:** Accepted (2026-07-04)
- **Milestone:** M5 (theokit-ai-first, Eixo D)
- **Gate for:** `knowledge-base/plans/terminal-harness-plan.md`
- **Grounded in:** blueprint `terminal-harness` (prior-art audit: `@ai-sdk/tui`, opencode, mastracode, codex)
- **Supersedes/relates:** ADR 0038 (M4 cohesive harness — the adapter this reuses)

This ADR is the DoD-1 gate: *"A wedge decision is documented — why terminal enters despite the web
wedge; its scope (dev-time/local vs product)."* No M5 code lands before this is accepted.

## Context

TheoKit's wedge (Locked Narrative) is **"the app the agent lives in"** — a WEB framework for shipping
an agent on a real domain (routing, auth, sessions, deploy). A *terminal* surface looks orthogonal to
that wedge, and the ROADMAP flags two risks: (1) scope creep into a "CLI agent product" outside the
web wedge, (2) a heavy TUI-lib dependency. opencode is the cautionary tale: a full CLI product
(daemon + HTTP/SSE + auth + plugins + persistence + OpenTUI) — valuable, but NOT what TheoKit is.

M4 shipped the **cohesive harness**: `compileAgentModule` → `streamAgentUIMessages` (emits the ai-sdk
`UIMessageStream`) + an in-process approval registry + a HITL pause on the SDK's `pre_tool_call` hook.
That harness is render-surface-agnostic by construction — the web `mountAgent` is just one consumer.

## Decision

### D1 — The terminal harness is a DEV-TIME / LOCAL surface, not a product

The terminal harness enters the wedge as a **local developer feedback loop**: run a scanned
`agents/<name>.ts` in the terminal (streaming text + reasoning + tool cards + a HITL approval prompt)
WITHOUT the browser round-trip. Its purpose is twofold:

1. **Dev-time dogfooding** — see your agent's stream + tool calls + approvals from the CLI while
   building, faster than wiring the web UI.
2. **Proof the M4 harness is render-surface-agnostic** — the SAME adapter drives web OR terminal.

It is explicitly **NOT** a "CLI agent product": **no** daemon, **no** HTTP/SSE transport, **no** auth,
**no** persistence, **no** plugin system, **no** multi-session manager. That is opencode's territory,
outside TheoKit's web wedge. Scope discipline is the mitigation for ROADMAP risk-1.

### D2 — Reuse the M4 harness verbatim; the ONLY new code is the render surface

The terminal harness consumes the M4 `UIMessageChunk` stream (`streamAgentUIMessages`) and resolves
the M4 `ApprovalRegistry`. It adds **no runtime, no second loop, no LLM call, no tool dispatch, no new
store** — enforced by the same invariant-guard-style test as M4 (Rule: `@theokit/sdk` is the only
runtime, G2/sdk-runtime.md). In a single-process CLI the stream's `awaitApproval` (→ `register`) and
the terminal prompt (→ `resolve`) share the one in-process registry — the exact design the M4
singleton was built for; the readline prompt IS the approve-route equivalent.

- **Alternatives.** (a) A new terminal-specific agent runner → violates ADR 0038 (no parallel
  runtime). (b) opencode's daemon+HTTP model → a product, outside the wedge (D1). Both rejected.

### D3 — Node stdlib rendering, NO TUI framework

Rendering is `process.stdout.write` + minimal ANSI; approval input is `node:readline`
(`rl.question`). **No** `@ai-sdk/tui` / ink / OpenTUI / pi-tui.

- **Rationale.** (i) Input-contract fit: `@ai-sdk/tui` takes `agent.stream()`/`TextStreamPart`, not
  our `UIMessageChunk` (`ai-sdk/packages/tui/src/agent-tui-runner.ts:216-230`); adopting it means
  fighting our harness boundary. (ii) Testability: `@ai-sdk/tui` hard-codes `process.stdin/out`
  (untestable) — see D4. (iii) YAGNI + ROADMAP risk-2: a dev-time sequential log needs no in-place
  delta compaction / rich layout. (iv) Zero third-party dep → `/deps-audit` trivially clean.
- **Alternatives.** `@ai-sdk/tui` (monolithic runner, wrong input contract), ink/pi-tui/OpenTUI
  (heavy, unneeded). Rejected now; `@ai-sdk/tui` recorded as a documented FUTURE upgrade path IF a
  product-grade CLI is ever green-lit (a fresh ADR + wedge revision would gate that).

### D4 — Injectable I/O boundary (testability is non-negotiable)

The renderer takes its sinks/sources by injection — `{ stdout: Writable, isTTY, promptFn }` — never
hard `process.*`. This lets the integration test drive it deterministically (feed a stubbed chunk
stream, capture the written lines, script the approval decision) — closing the exact testability gap
`@ai-sdk/tui` has. `process.stdout`/`node:readline` are the defaults wired only at the CLI entry.

## Scope (what M5 ships)

- A terminal renderer consuming `streamAgentUIMessages`'s `UIMessageChunk` stream (text, reasoning,
  tool cards, checkpoint notice, error) to an injectable `stdout`.
- A HITL approval prompt (`node:readline` `y/n`) that resolves the shared in-process registry; a
  non-TTY / non-interactive environment auto-denies (fail-safe, matching HITL `onTimeout: 'abort'`).
- A `theokit`-side entry (a CLI command or example) that scans `agents/<name>.ts`, resolves the
  provider, and runs the agent in the terminal reusing the harness.
- A deterministic integration test (SDK-stubbed) + an invariant guard (no new runtime).

## Out of scope (M5 explicitly does NOT ship)

- A daemon / server / HTTP-SSE transport; auth; session persistence; a plugin system; multi-agent
  session management; in-place streaming compaction; a rich TUI layout; arrow-key selection lists
  (a `y/n` decision suffices — richer selection is a future YAGNI item).

## Consequences

- **Positive.** The M4 harness earns a second consumer with near-zero new surface, proving its
  render-agnosticism; developers get a fast local loop; zero new dependency; the wedge stays intact.
- **Negative / residual.** Sequential stdout (no in-place delta compaction) is less polished than
  `@ai-sdk/tui`'s frame-buffered UI — acceptable for a dev tool, documented as the deliberate tradeoff.
  The non-TTY auto-deny means CI/piped runs cannot approve — by design (fail-safe).

## Re-evaluation triggers (revisit D3/D1 only if ALL hold)

1. Concrete demand for a product-grade interactive CLI from ≥3 shipped TheoKit apps.
2. `@ai-sdk/tui` (or successor) exposes a composable renderer that accepts a `UIMessageChunk` stream
   (not just `agent.stream()`).
3. A wedge revision at the monorepo Locked-Narrative level explicitly admits a CLI product surface.

Until all three hold, the terminal harness stays a minimal, stdlib, dev-time surface.
