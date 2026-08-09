export {
  createAgentExecutionContext,
  isAgentContext,
  type AgentExecutionContext,
  type AgentRunInfo,
} from './agent-execution-context.js'

export {
  compileTools,
  type CompiledTool,
  type CompiledAgentOptions,
  type ToolboxWalkResult,
  type ToolWalkResult,
} from './agent-compiler.js'

export { compileSkills } from './compile-skills.js'
export { compileContextWindow, type CompiledContextWindow } from './compile-context-window.js'
export {
  compileProjectContext,
  projectContextMetadataOnlyKnobs,
} from './compile-project-context.js'

export { streamAgentResponse, type StreamEvent } from './agent-sse-handler.js'

export {
  type AgentStreamEvent,
  type TextDeltaEvent,
  type ToolCallEvent,
  type PartialToolCallEvent,
  type ToolResultEvent,
  type ThinkingEvent,
  type IterationEvent,
  type ApprovalRequiredEvent,
  type ErrorEvent,
  type DoneEvent,
  type AgentTurnMetadata,
  type RunStartedEvent,
  isTextDelta,
  isToolCall,
  isPartialToolCall,
  isToolResult,
  isDone,
  isError,
  isApprovalRequired,
  type ArtifactStartEvent,
  type ArtifactChunkEvent,
  type StateUpdateEvent,
  type CheckpointSavedEvent,
  type FileEditEvent,
} from './agent-stream-events.js'

export {
  generateAgentRoutes,
  type AgentRoute,
  type AgentRouteContext,
} from './agent-route-generator.js'

export {
  createSdkAgentStream,
  toAgentFactory,
  type SdkAgentHandle,
  // M91 — the types that make `send` honest cross alongside it: without them the consumer cannot
  // name the return, and goes back to writing the adapter this milestone exists to delete.
  type SdkSendOptions,
  type SdkTurnHandle,
} from './sdk-adapter.js'
// M96 — the approval posture crosses the boundary: without it being nameable, the consumer cannot
// declare what `toAgentFactory` now requires. `AgentDefinition` (a name already taken just below, by
// the builder's branded type) is untouched — the posture has a name of its own.
export type { ApprovalPosture } from './approval-posture.js'
export type { DefinitionOrThunk } from './definition-or-thunk.js'
// M107 — the read crosses alongside the write. While only the write was public, the consumer
// reassembled the param key by hand to read it, which is a second oracle over the same fact.
export { buildModelSelection, reasoningEffortOf } from './model-selection.js'
export {
  createThinkTagExtractor,
  extractThinkTagStream,
  type Segment,
} from './think-tag-extractor.js'
export { translateSdkEvent, type SdkMessage } from './event-translator.js'
export { presentUIMessageStream } from './present-ui-message-stream.js'
// M31 builder-only: `AgentBuilder.create()` (below) is the public authoring surface; `defineAgent` is now
// internal (the AgentBuilder.create() builder's `.build()` delegates to it via source path), removed from the
// public API. `compileAgentDefinition` + the branded types stay public (the framework adapter
// consumes them).
export {
  compileAgentDefinition,
  isAgentDefinition,
  AGENT_BRAND,
  type AgentDefinition,
  type DefineAgentConfig,
  type InferAgentInput,
  type InferAgentToolNames,
} from './define-agent.js'
// `AgentBuilder` / `ContextualTool` are each a TYPE (generic interface) and a VALUE (static factory:
// `AgentBuilder.create()` / `ContextualTool.of()`) — M57 replaced the free `agent()`/`contextualTool()`
// functions with the SDK's `X.create()` shape. A plain re-export carries both spaces.
export { AgentBuilder, ContextualTool } from './agent-builder.js'
export {
  compileAgentModule,
  streamAgentUIMessages,
  AgentDefinitionError,
} from './agent-endpoint.js'

export {
  delegate,
  DelegationBudgetExceededError,
  // The alias EXISTS to be deprecated; re-exporting it is M91's compatibility contract, not careless
  // usage. It goes in a major.
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  BudgetExceededError,
  DelegationError,
  type DelegateOptions,
  type DelegationResult,
} from './agent-orchestrator.js'

export {
  createToolHooksPlugin,
  type ToolHooks,
  type ToolHooksPlugin,
  type BeforeToolCallContext,
  type AfterToolCallContext,
  type LLMCallContext,
  type ProcessInputContext,
  type ToolCallVeto,
} from './tool-hooks-plugin.js'

export {
  runWithApiErrorHandling,
  createApiErrorHandler,
  type ApiErrorPolicy,
  type ApiErrorDecision,
  type ApiErrorContext,
} from './api-error-handler.js'

export {
  delegateBackground,
  delegateWithScoring,
  type BackgroundDelegation,
  type DelegateFn,
  type Scorer,
  type ScoreVerdict,
  type ScoredDelegation,
} from './delegation-scoring.js'

export {
  resolveMcpServers,
  mcpRegistry,
  mcpToolApprovals,
  type McpSelection,
  type McpRequestContext,
  type McpRegistryConfig,
  type McpApprovalSpec,
} from './mcp-resolver.js'
// M107 — the neighbour that TOUCHES disk. `mcp-resolver` decides which servers a request receives;
// this one reads `<cwd>/.mcp.json`. The layer exposed the rare cases and not the common one, so every
// consumer wrote the loader by hand.
export { loadMcpJson, McpFileError } from './mcp-file.js'
