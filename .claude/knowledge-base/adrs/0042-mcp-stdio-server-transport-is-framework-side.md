# ADR 0042 — MCP stdio SERVER transport is framework-side (refines ADR-0040 M16 note)

- **Status:** Accepted (owner sign-off — "Corrija", 2026-07-07)
- **Date:** 2026-07-07
- **Component:** `theokit` (`packages/theo`) — `theokit mcp <agent>`, `serveMcpStdio`, `handleMcpStdioLine`
- **Refines:** ADR 0040 (runtime-vs-home boundary) — the "M16-stdio-transport → SDK" line in
  `system-design-guardrails.md` G13 / `sdk-runtime.md`
- **Related:** M16 (MCP-over-HTTP serving, framework-side), #89 (@MCP client wiring)

## Context

ADR-0040 §D2 (and the G13 carve-out note) listed **"M16-stdio-transport"** among the capabilities
"whose core is true runtime" and therefore bound for `../theokit-sdk`, not `packages/`. When
implementing the M16 follow-up, that line proved ambiguous, because two distinct things share the
name "MCP stdio transport":

1. **MCP CLIENT stdio (consuming)** — the SDK spawns an EXTERNAL MCP server as a subprocess and talks
   to it over stdin/stdout (declared via `mcpServers: { <name>: { command, args } }`). This is
   genuine runtime: it spawns processes, manages a client session, dispatches tools. It **already
   exists in `@theokit/sdk`**, and #89 wired the `@MCP`-declared servers through to `Agent.create`.
2. **MCP SERVER stdio (exposing)** — TheoKit exposes ITS OWN agent as an MCP server over stdin/stdout,
   so a desktop MCP client (e.g. Claude Desktop) can spawn `theokit mcp <agent>`. This reads
   newline-delimited JSON-RPC and answers `initialize` / `tools/list` / `resources/*`.

The M16 milestone was "expose a TheoKit agent as an MCP server". Its HTTP form
(`POST /api/agents/<name>/mcp` via `handleMcpJsonRpc`) shipped **framework-side** — ADR-0040 itself
lists "HTTP exposure (agent cards, MCP-over-HTTP routes)" as a framework/home concern. The stdio form
of that SAME exposure had no explicit, unambiguous home.

## Decision

**The MCP SERVER stdio transport is framework-side** (`packages/theo`). It is a **transport**, not
runtime:

- It reuses the framework's OWN `handleMcpJsonRpc` — the exact handler the M16 HTTP route uses. It
  makes no LLM call, spawns no MCP client, and reimplements no runtime (G2 / `sdk-runtime.md` intact).
- It is the stdin/stdout sibling of the framework's MCP-over-HTTP route. Placing the two transports
  of the SAME exposure in different repos would split one home concern across the runtime boundary
  for no reason.

**The MCP CLIENT stdio (consuming external servers) stays SDK-side**, unchanged. That is the genuine
runtime the ADR-0040 note was protecting.

### What this refines in ADR-0040

The G13 carve-out line "M16-stdio-transport → SDK" is read as **"the MCP CLIENT stdio runtime"** (item
1 above), which is already SDK-side. The **server-exposure stdio transport** (item 2) is framework-side,
consistent with M16's HTTP route. No G2/G13 invariant changes: no forbidden package name is created
(`serveMcpStdio` lives under `packages/theo/src/server/agent/`), no provider API is called, no loop is
reimplemented.

## Consequences

- `theokit mcp <agent>` ships in `theokit@0.19.0` (server-side stdio transport). Desktop MCP clients
  can spawn a TheoKit agent as an MCP server.
- `handleMcpJsonRpc` remains the single MCP request handler; HTTP and stdio are thin transports over
  it (DRY). A future change to the MCP method set is made once.
- If a later need arises to run the SERVER stdio transport from inside the SDK runtime (e.g. an
  SDK-native `Agent.serveMcpStdio()`), that is a separate, additive SDK feature — it does not
  invalidate this transport, which stays the framework's CLI/HTTP-exposure path.

## When this may change

Per `cycle-rule-schema.md § Golden Rule Change Protocol`. Reopening requires an owner-signed ADR — the
same gate as ADR-0040/0041.
