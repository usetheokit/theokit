// M31 builder-only: the `@Agent/@Tool/@Toolbox/@HumanInTheLoop/@Guardrails/@Skills/@MainLoop/
// @SubAgents/@Checkpoint/@Mixin/…` decorators are removed from the public API (ADR-0043 D1/D2). The
// `AgentBuilder.create()` / `tool()` builders are the single authoring surface. The decorator implementations +
// their metadata getters remain internal (the compiler reads them via source-path imports).
// The decorator OPTION TYPES stay public (the framework + consumers annotate with them — e.g. the
// HITL `TimeoutAction` used by the approval-registry and the `AgentBuilder.create().approval(...)` options).
export type { HumanInTheLoopOptions, TimeoutAction } from './types.js'
// M35 — the settled HITL decision type is part of the public approval contract: an `awaitApproval`
// resolver (the HTTP registry or the in-process seam) may return a bare boolean OR this structured value.
export type { HitlDecision } from './bridge/hitl-plugin.js'
// `ConfigurationError` is part of the public contract — consumers `catch` it. It used to reach the
// barrel via a compat re-export inside `capability/capabilities.ts` (removed in M56); export it here
// from its home module so removing that internal re-export does not drop it from the package API.
export { ConfigurationError } from './errors.js'
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

// M58 — layered boundary `SDK → Theokit → AgentBuilder`: the consumer imports the SDK's already-OO
// core primitives from `@theokit/agents`, not from `@theokit/sdk` directly. PASS-THROUGH, never a
// wrapper (parsimony-ladder Rung 9): `Agent.create()` / `Tool.create()` / `Provider` are already the
// target OO shape, so wrapping them would be ceremony without value. The domains with their own
// infra surface (sandbox / persistence / interactive / pty) live on matching subpaths that mirror the
// SDK's own subpath split (`@theokit/agents/{sandbox,persistence,interactive,pty}`).
export { Agent, Squad, Tool, Provider } from '@theokit/sdk'
export type { SDKAgent, CustomTool, SessionRecord } from '@theokit/sdk'
