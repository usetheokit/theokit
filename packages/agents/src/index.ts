// M31 builder-only: the `@Agent/@Tool/@Toolbox/@HumanInTheLoop/@Guardrails/@Skills/@MainLoop/
// @SubAgents/@Checkpoint/@Mixin/…` decorators are removed from the public API (ADR-0043 D1/D2). The
// `agent()` / `tool()` builders are the single authoring surface. The decorator implementations +
// their metadata getters remain internal (the compiler reads them via source-path imports).
// The decorator OPTION TYPES stay public (the framework + consumers annotate with them — e.g. the
// HITL `TimeoutAction` used by the approval-registry and the `agent().approval(...)` options).
export type { HumanInTheLoopOptions, TimeoutAction } from './types.js'
// M35 — the settled HITL decision type is part of the public approval contract: an `awaitApproval`
// resolver (the HTTP registry or the in-process seam) may return a bare boolean OR this structured value.
export type { HitlDecision } from './bridge/hitl-plugin.js'
export * from './capability/index.js'
export * from './bridge/index.js'
export * from './loop/index.js'
export * from './guardrails/index.js'
export * from './a2a/agent-card.js'
export * from './a2a/mcp-server-manifest.js'
export * from './a2a/a2a-client.js'
export * from './conversation-scope.js'
export * from './skills-resolver.js'
export * from './acp/protocol.js'
export * from './acp/client.js'
export * from './manifest/agent-manifest.js'
export { agentsPlugin, type AgentsPluginOptions } from './theokit-plugin.js'
export type {
  AgentOptions,
  MainLoopOptions,
  MainLoopMeta,
  ToolboxOptions,
  ToolOptions,
  BudgetOptions,
  ApprovalOptions,
  PolicyHandler,
  ReasoningEffort,
} from './types.js'
