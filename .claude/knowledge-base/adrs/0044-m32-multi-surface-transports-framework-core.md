# ADR 0044 — M32: TUI / MCP / Tauri are authorized framework-core *transport surfaces* (home side)

- **Status:** Accepted (owner sign-off — the GOLD GOAL "TUI / MCP / Tauri são superfícies autorizadas do framework-core", restated 3× this cycle: the GOLD GOAL declaration, the `/roadmap-feature` M32–M34 creation, and the `/goal` to execute the M33–M34 CYCLE; 2026-07-08)
- **Date:** 2026-07-08
- **Milestone:** M32 (Phase 0 — the FOUNDATIONAL gate; blocks M33/M34)
- **Extends:** ADR-0040 (runtime-vs-home boundary) · ADR-0042 (MCP server transport is framework-side) · ADR-0039 (M5 terminal harness reuse)
- **Evidence base:** `.claude/knowledge-base/discoveries/blueprints/universal-handler-architecture-blueprint.md` (12-cluster deep research, 4 adversarial critics — **4 of 5 original recommendations were REFUTED**; this ADR encodes only the *narrower verdict-adjusted* scope that survived, plus the un-refuted D5).
- **Revisits:** `rules/system-design-guardrails.md` G1 (dependency DAG) + G13 (forbidden expansion vectors) + `CLAUDE.md` "Out of scope"

## Context

The GOLD GOAL asks TheoKit to serve **one construction on web + TUI + MCP + Tauri** — so the framework is a real full-stack app platform (login/cadastro/CRUD on web) whose app logic is *also* exposed to a terminal, to agents (MCP), and to a desktop shell. The deep-research blueprint's foundational finding (§8.7): **no ADR currently authorizes TUI/MCP/Tauri as framework-core surfaces** — and "every downstream design inherits its risk from this unmade call." This ADR makes the call so M33 (the typed-ctx + in-process caller contract) and M34 (MCP hardening) can proceed on solid ground.

The tension a naïve reading raises: `sdk-runtime.md` ("`@theokit/sdk` is the ONLY agent runtime") + the ROADMAP out-of-scope ("Reimplementing the agent loop / own multi-agent orchestration"). This ADR does **not** touch that invariant.

## Decision

### D1 — Authorize TUI / MCP / Tauri as framework-core **transport surfaces** — the *home* side, per ADR-0040's already-accepted line

TheoKit framework core (`packages/theo`) MAY own the **transport/exposure of APP logic** onto TUI, MCP, and Tauri — because that is the **home** side of the runtime-vs-home boundary ADR-0040 already established (core owns "auth, sessions, human gates, **HTTP exposure**, deploy"; the SDK owns the LLM loop / provider I/O / tool-dispatch / conversation-storage engine / response streaming). A surface that projects a `route()`/`tool()` unit onto a transport is **exposure**, not runtime.

This is an **extension, not a new scope grant**: ADR-0042 already ruled the **MCP server transport is framework-side** ("It is a transport, not a runtime"), and ADR-0039 already ships the **TUI** as framework-side reuse of the same core handler. This ADR generalizes both under one principle and adds Tauri (deferred, D5).

### D2 — What stays SDK-side (the invariant HOLDS — no workaround, Rule 3)

Unchanged from ADR-0040: no `packages/` code may reimplement the LLM loop, call a provider API directly (G2 grep guard stays), reimplement the tool-dispatch loop, or reimplement the conversation storage engine / response streaming. The **MCP *client* runtime** (consuming external `mcpServers`) stays SDK-side (ADR-0042). A surface exposes app logic; it never runs the agent.

### D3 — Surface authorization status + re-evaluation triggers

| Surface | Status | Basis |
|---|---|---|
| **web** | ✅ core (shipped) | the conventional full-stack surface — routes/actions/pages/auth |
| **MCP (server transport)** | ✅ **authorized core** | ADR-0042 (already framework-side); M34 hardens it (`tools/call`, auth, default-DENY, closes #97) |
| **TUI** | ✅ **authorized core** | ADR-0039 (already ships reuse of the core handler); M33's in-process caller replaces the HTTP-loopback it uses today |
| **Tauri** | 🟡 **authorized-in-principle, DEFERRED to a later phase** | the `fetch(Request)=>Response` waist cannot express Tauri's push half (`Channel`/`emit`, blueprint §8.3). Realization is **gated** on: (a) M33's in-process caller shipped, (b) a push-transport ADR (blueprint ADR-8), (c) evidence of ≥1 real desktop app need. Default realization = **sidecar reusing the node adapter**, NOT an `adapter-tauri` build target. |

### D4 — Package placement + the G1 DAG boundary (the load-bearing constraint)

The universal-unit + its transport projections live in `packages/theo` (framework core). The **G1 dependency DAG is inviolable**: `@theokit/http` MUST NOT import `@theokit/agents` (agents depends on http, never the reverse). A unit that needs both the HTTP shape and agent/tool metadata composes them **at the `packages/theo` layer** (which legally depends on both), never by making `@theokit/http` reach into `@theokit/agents`. This ADR ships with a **boundary-check test** asserting the DAG holds; any straddling code that violates it fails the test.

### D5 — Default-DENY per-surface exposure (the un-refuted blueprint recommendation)

Authorization is **not** auto-exposure. A unit is web-only + auth-required UNLESS it explicitly opts onto a non-web surface with a per-surface capability guard (D5, blueprint §5.6 — the one recommendation no adversarial critic refuted; default-EXPOSE is the Blitz CVE-2022-23631 footgun magnified by the multi-surface thesis). Enforced structurally at the emit layer in M34. Making a surface *authorized* (this ADR) is distinct from a unit *opting onto* it (M34).

### D6 — `build --target` stays emit-only (reject the refuted D4)

`--target` remains **emit/deploy-only and fetch-handler-shaped** (the 9 existing deploy adapters). TUI/MCP/Tauri are **serve-shaped transport wrappers / sidecars over the one core handler** (CLI commands per ADR-0039/0042), **NOT** build targets. Adding them as `--targets` is a category error (blueprint §3 D4 — REFUTED: the cited Astro/Nitro/Next "gold standards" are emit-only + HTTP-bound counter-evidence).

## Consequences

- **Unblocks M33 + M34.** The scope gate is signed; the contract + MCP hardening can proceed.
- **Nothing is reopened SDK-side.** The runtime invariant + MCP-client-runtime placement are untouched (ADR-0040/0042).
- **The G1 DAG becomes a tested invariant** (boundary-check test), so a straddling unit cannot silently violate the locked dependency direction.
- **Tauri is explicitly deferred + gated** — no premature `adapter-tauri`; realization requires the push-transport ADR (ADR-8) + evidence.
- **Honest scope:** this ADR authorizes the *surfaces*; it does not adopt the refuted "universal projector template" (blueprint §8.1) — cross-surface reuse is via a shared plain function + M33's in-process caller (G5 "shared guards, distinct pipelines"), not a single projected unit.

## Alternatives considered

- **(A) Refuse — keep TUI/MCP/Tauri out of core (SDK/wrappers only).** Rejected: contradicts ADR-0039/0042 which already ship TUI + MCP-server framework-side, and blocks the owner's repeatedly-stated GOLD GOAL. Would leave the shipped MCP route (#97) unowned + unhardened.
- **(B) Authorize + adopt the universal projector template.** Rejected: the projector template does not exist in any studied framework (blueprint §8.1, D1 REFUTED); adopting it is greenfield invention mis-sold as prior-art adoption, and collides with G4/G5.
- **(C) Authorize as build `--targets`.** Rejected: D6 (category error; the gold standards are counter-evidence).

## Cross-references

- Blueprint: `universal-handler-architecture-blueprint.md` (§1.2, §3 D1/D4/D5, §7.1 ADR-1, §8.1/§8.3/§8.7)
- ADR-0040 (runtime-vs-home), ADR-0042 (MCP server transport framework-side), ADR-0039 (TUI reuse)
- Guardrails: G1 (DAG), G2 (SDK-only runtime), G13 (expansion vectors)
- Issue: #97 (unauthenticated MCP route — hardened in M34)
- Downstream: M33 (typed-ctx + in-process caller), M34 (MCP hardening + default-DENY)
