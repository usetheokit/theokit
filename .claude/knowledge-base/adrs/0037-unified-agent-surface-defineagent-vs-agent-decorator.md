# ADR 0037 — Unified agent surface: `defineAgent` file convention (canonical) + `@Agent` decorator (advanced)

- **Status:** Accepted
- **Date:** 2026-07-04
- **Milestone:** M2 (theokit-ai-first, Eixo B)
- **Supersedes / relates:** [0031 (M8 decorator runtime + DI strategy)](0031-m8-decorator-runtime-and-di-strategy.md), [0036 (canonical protocol: UIMessageStream)](0036-canonical-protocol-uimessagestream-vs-agui.md)

## Context

Before M2 a TheoKit agent could be declared two incompatible ways, neither of which was a
zero-config file convention wired to the M0/M1 canonical `UIMessageStream`:

1. **`@Agent` class decorator** (`packages/agents/src/decorators/agent.ts`) — DI-heavy
   (`@MainLoop`, `@Toolbox`, `@Memory`, `@Skills`…), auto-mounted by `agentsPlugin`, but its
   generated route (`agent-route-generator.ts`) streams the **proprietary** `AgentEvent` SSE
   (`agent-sse-handler.ts`), not `UIMessageStream`. Declaring a one-line agent forces a class
   + `@MainLoop` (KISS-hostile; `walkAgentMetadata` throws without `@MainLoop`).
2. **`defineAgentEndpoint`** (`packages/theo/src/server/define/define-agent-endpoint.ts`) — an
   imperative handler that also yields the proprietary `AgentEvent`.

M2's goal (roadmap Eixo B) is ONE canonical zero-config surface: `agents/<name>.ts` → SSE
endpoint + typed client, wired to the M0/M1 `UIMessageStream` that `@ai-sdk/react`'s `useChat`
(and `ai`'s `readUIMessageStream`) consumes with no adapter.

## Decision

1. **`defineAgent()` (new, in `@theokit/agents`) is the canonical zero-config surface.** A
   top-level `agents/<name>.ts` default-exports `defineAgent({ input, model, system, tools })`.
   It is a pure normalizer (no LLM at define time — sdk-runtime.md/G2) that lowers to the same
   `CompiledAgentOptions` the decorator path produces (`compileAgentDefinition`).
2. **`@Agent` stays the advanced/DI surface.** An `agents/<name>.ts` file MAY instead
   default-export an `@Agent`-decorated class; the scanner brand-checks the default export
   (`isAgentDefinition` vs `getAgentConfig`) and routes to the right compiler. Both converge on
   `CompiledAgentOptions` → `createSdkAgentStream` → **one** SDK runtime (`@theokit/sdk`).
3. **The convention wires to the M0/M1 canonical protocol, never to `defineAgentEndpoint`.**
   `compileAgentModule` → `streamAgentUIMessages` (`createSdkAgentStream` → the M1
   `translateToUIMessageStream`) → `uiMessageStreamResponse`. A single `mountAgent` wiring point
   serves both `theokit dev` and the built server, so they never drift.
4. **A non-agent module or an unknown route fails fast** with a typed `AgentDefinitionError`
   naming the file (error-handling.md — surface, don't swallow).

## Alternatives considered

- **`@Agent`-only.** Rejected: forces classes + decorators for a one-line agent; the whole
  point of the AI-first surface is a single file that reads like `defineRoute`.
- **The convention targets `defineAgentEndpoint`.** Rejected: re-entrenches the proprietary
  `AgentEvent` that M3 removes; the convention would emit the wrong wire.
- **Location `server/agents/`.** Rejected by the naming/System-Design analysis
  (`.claude/knowledge-base/reference/agent-surface-naming-system-design.md`): agents get a
  top-level `agents/` (sibling of `server/`, Mastra-aligned), `server/` is unchanged.

## Consequences

- `defineAgentEndpoint` + the proprietary `AgentEvent` are now legacy — **M3 is a pure deletion
  + migration codemod** (the replacement shipped here).
- The client consumes `UIMessageStream` via `ai`'s own `readUIMessageStream` (no reinvented
  parser — Rule 9); `useAgent` is typed end-to-end from `defineAgent({ input })` via the
  generated `.theokit/agents.d.ts` (`@theo/agents` module).
- Naming: a `server/` → other-name rename remains explicitly rejected (that doc), not deferred.
