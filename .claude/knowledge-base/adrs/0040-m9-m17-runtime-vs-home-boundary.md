# ADR 0040 — M9–M17 batch: the runtime-vs-home boundary (unblock GATE)

- **Status:** Accepted (owner sign-off — "Desbloqueie TUDO para que possamos implementar todos os Milestones", 2026-07-07)
- **Date:** 2026-07-07
- **Milestones:** M9 (guardrails), M10 (processors), M11 (memory scoping + compression), M12 (multi-agent v2), M13 (skills runtime), M14 (HITL expansion), M15 (A2A), M16 (MCPServer-over-HTTP), M17 (ACP)
- **Revisits:** `rules/system-design-guardrails.md` G13 (forbidden expansion vectors) + `rules/sdk-runtime.md` (SDK is the only runtime) + `CLAUDE.md` "Out of scope"
- **Extends:** ADR 0038 (M4 harness = adapter, not parallel runtime) — same principle, wider batch

## Context

The M9–M17 roadmap asks TheoKit to grow nine agent-facing capabilities. A naïve reading of
G13 ("`packages/{memory,mcp,orchestrator,workflows}/` = BLOCK") and `sdk-runtime.md` ("`@theokit/sdk`
is the ONLY agent runtime") would forbid most of them in framework core. But ADR 0038 already
established the sharper line the codebase actually enforces: the framework MAY wire the SDK's
primitives + shipped decorators into the app's **home** (auth, sessions, human gates, HTTP exposure,
deploy); it MAY NOT reimplement the **runtime** (LLM loop, provider I/O, tool-dispatch, conversation
storage engine, response streaming).

The blanket rule text is too coarse for this batch. Some milestones are pure home/boundary concerns
that belong in core; some have a true-runtime core that belongs in the SDK; some are best shipped as
plugins per the G13 "plugin test". This ADR draws that line per capability so the hooks stop blocking
legitimately (ADR-governed), and nothing is silently deleted (no workaround — Rule 3).

Confirmed facts:
- The framework already delegates to SDK-owned features (`CompiledAgentOptions` carries `memory`,
  `mcpServers`, `agents` sub-agents, `checkpoint`). These are wiring, not reimplementation.
- `@theokit/sdk` is consumed from the **npm registry** (`@theokit/sdk@2.9.0`), NOT workspace-linked.
  SDK-side work therefore requires an edit → publish → consumer-bump train (`../theokit-sdk`).

## Decision

### D1 — The invariant is REFINED per capability, not repealed

The runtime invariant HOLDS: no code in `packages/` may reimplement the LLM loop, call a provider
API directly (G2 grep guard stays), reimplement the tool-dispatch loop, or reimplement the
conversation **storage engine** / response streaming. What follows only re-scopes the **home** side.

### D2 — Layer assignment (the unblock)

| Milestone | Core-legit part (framework `packages/`) | SDK part (`../theokit-sdk`, publish) | Plugin (`../theokit-plugins`) |
|---|---|---|---|
| **M9 Guardrails** | ✅ input/output guards at the HTTP/stream boundary (generator-chain `sdk-adapter.ts:488` + `pre_tool_call` plugin). NOT a new `packages/` name. | — | Optional: ship detectors as `@theokit/plugin-guardrails` if they graduate |
| **M10 Processors** | ✅ lifecycle hooks at the boundary (`beforeToolCall`/`afterToolCall` via plugin; input/output via generator-chain) | `processLLMRequest`/`processLLMResponse` that mutate the provider call → SDK | — |
| **M11 Memory** | ✅ `{resource,thread}` request→conversation scoping (auth/session = home) | background **compression** (touches storage engine) → SDK | — |
| **M12 Multi-agent v2** | ✅ `onDelegationStart/Complete` observability hooks + `messageFilter` + `abortSignal` wiring over existing `createSquad` | — (no new orchestration engine) | — |
| **M13 Skills runtime** | ✅ fix `skills.enabled` bug + per-request resolver (already in `packages/agents`) | — | — |
| **M14 HITL expansion** | ✅ `requireApproval` on `defineAgent`/builder + `GET /approvals` (HTTP home) + `errorStrategy` | — | — |
| **M15 A2A** | ✅ agent cards at `/.well-known/` + `A2AAgent` client tool (HTTP exposure = home) | — | — |
| **M16 MCPServer** | ✅ expose agents as MCP **over the app's HTTP routes** (`GET /mcp`) — the home exposing itself | stdio-transport server that reimplements MCP protocol → SDK/`@modelcontextprotocol/sdk` | — |
| **M17 ACP** | ✅ `onPermissionRequest` gate wiring to HITL (home) | subprocess spawn + stdio-JSON runtime → SDK or a dedicated adapter package via its own ADR | — |

Rule: a capability lands in **core** only when it touches the boundary/home and reuses (never
reimplements) SDK runtime primitives. Runtime cores go to the SDK repo behind its publish train.
The G13 forbidden **package names** (`packages/{memory,mcp,orchestrator,workflows}/`) remain forbidden
— these features live under existing packages (`packages/agents/src/{guardrails,processors,…}/`),
never as new top-level forbidden-named packages.

### D3 — Guard files updated per this ADR

`rules/system-design-guardrails.md` G13 and `rules/sdk-runtime.md` gain an explicit carve-out
pointer to this ADR: home/boundary concerns under existing packages are permitted; the forbidden
package NAMES and the reimplementation ban are unchanged.

## Consequences

- **Positive:** All nine milestones become buildable without a workaround; each lands in the layer
  that keeps the DRY/2x-bug/provider-lock-in protections `sdk-runtime.md` exists to enforce.
- **Cost:** M10 (partial), M11-compression, M16-stdio, M17-runtime carry an SDK **publish
  dependency** — they cannot ship purely from this repo. Their CYCLEs are staged accordingly and
  their DoDs that require SDK changes are BLOCKED here until the SDK release lands.
- **Invariant intact:** the G2 grep guard (`openrouter.ai|api.openai.com|api.anthropic.com` = ZERO)
  and the "no reimplemented loop/storage" ban are untouched. This ADR only sharpens the home line.

## Alternatives considered

1. **Delete the guardrails** — rejected: silent gutting is the workaround Rule 3 + the user forbid.
2. **Build everything in core anyway** — rejected: reimplements SDK runtime (DRY/2x-bug) and is
   blocked by `boundary-check.sh`.
3. **Defer the whole batch to the SDK** — rejected: the home/boundary parts ARE the framework's
   wedge (ADR 0038); shipping them in the SDK would misplace TheoKit's differentiator.
