# ADR 0041 — M18–M30 deferred-gap closure: re-scope the out-of-scope items (owner GATE)

- **Status:** Accepted (owner sign-off — "TUDO (A+B+C, força total)", 2026-07-07)
- **Date:** 2026-07-07
- **Milestones:** M18–M30 (closing every DEFERRED gap in `docs/agents/feature-backlog.md`)
- **Revisits:** `ROADMAP.md § Explicitly out of scope`, `CLAUDE.md` Out-of-scope, `system-design-guardrails.md` G13
- **Extends:** ADR 0040 (runtime-vs-home boundary) — same principle, wider batch

## Context

The M9–M17 batch closed the P1/P2 gaps. The owner now directs closing **every** remaining DEFERRED
gap (Category A framework-legit, B locked-out-of-scope, C YAGNI). Several Category-B items are
`Explicitly out of scope` in `ROADMAP.md` or brush `G13` forbidden vectors, so — per the Golden Rule
Change Protocol — moving them into milestones requires an owner-signed ADR. This is that gate.

## Decision

### D1 — The runtime invariant HOLDS; only the out-of-scope *list* is amended

The G2/`sdk-runtime.md` invariant is untouched: no code in `packages/` reimplements the LLM loop,
calls a provider API directly (grep guard stays), reimplements the tool-dispatch loop, or the
conversation storage engine. The G13 forbidden **package names** (`packages/{workflows,memory,mcp,
orchestrator}/`) remain forbidden. What this ADR amends is which *capabilities* may become milestones
— always under existing packages, always as thin adapters over the SDK, never as forbidden packages.

### D2 — Per-item layer assignment (the re-scope)

| Milestone | Item | Layer / how it stays legal |
|---|---|---|
| **M18** | Tool output shaping (`toModelOutput`/`transform`) | `packages/agents` — a tool-result transform at the boundary (what the model sees vs the app/transcript). No runtime change. |
| **M19** | Processor pipeline completion (`processInputStream`/`processAPIError`) | `packages/agents` — extend `createToolHooksPlugin` over SDK stream/error hooks. Observability, not a new loop. |
| **M20** | HITL custom approval payload | `packages/agents`+`theokit` — extend the approval event/registry payload. Home concern. |
| **M21** | Separate structuring model | `../theokit-sdk` — `generateObject` accepts a cheaper `structuringModel`. SDK API + publish. |
| **M22** | Skills — inline `createSkill()` + custom directory | `packages/agents` — a code-defined skill + a `skillsDir` option. Filesystem discovery already exists. |
| **M23** | Structured output — multi-schema providers (Valibot/ArkType/JSON Schema) | `../theokit-sdk` — `generateObject` accepts non-Zod schemas via a normalizer. SDK API + publish. |
| **M24** | MCP follow-ups (dynamic toolsets + registries + `requireToolApproval`) | `packages/agents`+`theokit` — per-request MCP creds resolver + registry helpers + approval propagation. HTTP/home + config. NOT `packages/mcp/`. |
| **M25** | Multi-agent — background execution + task-completion scoring | `packages/agents` — `delegate()` async mode + an injected scorer callback. Observability/orchestration-sugar over the EXISTING primitive, NOT a new orchestrator (ADR 0038/0040 line holds: no second loop, no new store). |
| **M26** | Workflows as tools | `packages/agents` — a thin adapter wrapping the SDK's `Workflow` as a `CustomTool`. NOT `packages/workflows/`; the workflow engine stays SDK-side. Gated on the SDK exposing `Workflow`. |
| **M27** | Channels (Slack/Discord/Telegram) + webhook routes | `theokit` — auto-generated webhook HTTP routes with signature validation (the app's HTTP surface = home). The gateway packages already exist in the SDK; this wires them. The "not core" note in the backlog is **superseded by this ADR** for these platforms. |
| **M28** | SDK Agents wrappers (Claude/OpenAI/Cursor SDKs) | `packages/agents` — thin adapters exposing third-party agent SDKs behind a `CustomTool`/uniform surface, mirroring M17 ACP. The runtime stays theirs; TheoKit only wires. |
| **M29** | Code mode sandbox (`createCodeMode`) | `theokit` (adapter) — a sandboxed code-execution tool, extending the M17 subprocess pattern with an isolation boundary. Security-gated: `onPermissionRequest`-style required gate. |
| **M30** | MCP Apps (iframe UIs) | `packages/agents`+`theokit` — `ui://` resource HTML served in a sandboxed iframe. Formerly OUT_OF_SCOPE (Mastra-Studio-specific); re-scoped by owner. |

Rule preserved from ADR 0040: a capability lands in **core** only when it touches the boundary/home
and REUSES (never reimplements) SDK runtime primitives. Runtime cores (M21, M23, and any workflow/
provider engine work) live in `../theokit-sdk` behind its publish train.

### D3 — Roadmap "out of scope" amended

`ROADMAP.md § Explicitly out of scope` loses the channels/sdk-agents/code-mode/mcp-apps lines (they
become M27/M28/M29/M30). The three genuine invariants stay off-limits: **turning theokit into an
SDK**, **reimplementing the agent loop / a parallel orchestrator**, and **an own provider abstraction**.

## Consequences

- **Positive:** every documented gap becomes a tracked milestone; nothing is silently dropped.
- **Cost:** M21, M23, M26 (partial) carry an SDK **publish dependency**. M27/M29 add real HTTP/security
  surface that must be maintained forever (G13 "scope is a budget" — accepted by owner).
- **YAGNI note (honest):** M22-inline-skill, M23-multi-schema are low-demand (SKILL.md / Zod already
  cover the common case). They ship because the owner chose full coverage, not because demand exists.
- **Invariant intact:** the G2 grep guard and the no-reimplemented-loop/storage ban are untouched.

## Alternatives considered

1. **Category A only** — rejected by owner (wanted full coverage).
2. **Leave B out-of-scope** — rejected: owner amended the out-of-scope list via this ADR.
