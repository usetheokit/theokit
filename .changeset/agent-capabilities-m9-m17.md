---
"@theokit/agents": minor
"theokit": minor
---

Agent capabilities batch M9–M17.

- **M9 Guardrails** — `defineAgent({ guardrails })`: input/output guards at the boundary (`promptInjectionDetector`, `piiDetector`, `unicodeNormalizer`, `costGuard`, `outputModeration`), input applied fail-fast, output moderated before reaching the client.
- **M10 Lifecycle hooks** — `createToolHooksPlugin({ beforeToolCall, afterToolCall, beforeLLMCall, afterLLMCall })` over the SDK's native tool/LLM hooks.
- **M11 Conversation scoping** — `deriveConversationId`/`parseConversationId` for collision-safe `{resource, thread}` isolation.
- **M12 Delegation hooks** — `onDelegationStart`/`onDelegationComplete` on `delegate()` (+ abortSignal, docs).
- **M13 Per-request skills resolver** — `defineAgent({ skills: (ctx) => string[] })` resolved against the run-context at mount.
- **M14 HITL surface** — `defineAgent({ approvals })`, `GET /api/agents/:name/approvals`, `toolName` forwarded to the registry.
- **M15 A2A** — `buildAgentCard` + served at `/.well-known/<name>/agent-card.json`; `createA2ATool` client with auth.
- **M16 MCP** — `buildMcpToolDescriptors`/`mcpServerInfo` + served at `POST /api/agents/<name>/mcp` (JSON-RPC).
- **M17 ACP** — `AcpMessageDecoder`/`encodeAcpMessage` framing, `AcpClient`, and `createACPTool` + `NodeAcpTransport` (subprocess) with a required `onPermissionRequest` gate.

Governance: ADR-0040 (runtime-vs-home boundary).
