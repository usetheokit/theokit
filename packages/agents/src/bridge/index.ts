export {
  createAgentExecutionContext,
  isAgentContext,
  type AgentExecutionContext,
  type AgentRunInfo,
} from './agent-execution-context.js'

export {
  walkAgentMetadata,
  validateUniqueRoutes,
  AgentWarningCode,
  type AgentWalkResult,
  type ToolboxWalkResult,
  type ToolWalkResult,
} from './walk-agent-metadata.js'

export {
  compileTools,
  compileAgent,
  type CompiledTool,
  type CompiledAgentOptions,
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

export { createSdkAgentStream, toAgentFactory, type SdkAgentHandle } from './sdk-adapter.js'
export { buildModelSelection } from './model-selection.js'
export {
  createThinkTagExtractor,
  extractThinkTagStream,
  type Segment,
} from './think-tag-extractor.js'
export { translateSdkEvent, type SdkMessage } from './event-translator.js'
export { translateToUIMessageStream } from './ui-message-stream-translator.js'
// M31 builder-only: `agent()` (below) is the public authoring surface; `defineAgent` is now
// internal (the agent() builder's `.build()` delegates to it via source path), removed from the
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
export { agent, contextualTool, type AgentBuilder, type ContextualTool } from './agent-builder.js'
export {
  compileAgentModule,
  streamAgentUIMessages,
  AgentDefinitionError,
} from './agent-endpoint.js'

export {
  delegate,
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
