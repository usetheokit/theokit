---
"theokit": major
---

BREAKING — remove the pre-M2 proprietary agent surface (M3 clean break, no compat layer).

Deleted: the `AgentEvent` SSE protocol (`theokit/core/contracts` `AgentEvent` + variants), the server producers `defineAgentEndpoint` / `streamAgentRun` / `createConversationHistory` (and the `theokit/server/agent` subpath export, removed entirely), and the client cluster `useAgentStream` / `deriveLiveText` / `deriveError` / `consumeAgentStream` / `parseSSEChunk` / `useAgentToolCards` / `foldAgentToolCards` / `defaultResolveEnvelope` (`theokit/client`).

Use the M2 surface (shipped in 0.13.0): create a top-level `agents/<name>.ts` that `export default defineAgent({ input, model, system, tools })` (from `@theokit/agents`) — auto-served at `POST /api/agents/<name>` on the ai-sdk `UIMessageStream` wire — and consume it with `useAgent` / `consumeUIMessageStream` (`theokit/client`). `defineAgentTool`, `provider-resolver`, and the `@Agent` decorator are unchanged.

Migration guide: `docs/migration/0.13-to-0.14-agent-surface.md`.
