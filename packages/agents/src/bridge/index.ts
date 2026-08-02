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
  // M91 — os tipos que tornam `send` honesto atravessam junto: sem eles o consumidor não consegue
  // nomear o retorno, e volta a escrever o adaptador que o milestone existe para apagar.
  type SdkSendOptions,
  type SdkTurnHandle,
} from './sdk-adapter.js'
// M96 — a postura de aprovação atravessa a fronteira: sem ela nomeável, o consumidor não consegue
// declarar o que `toAgentFactory` agora exige. `AgentDefinition` (nome já ocupado logo abaixo, pelo
// tipo brandado do builder) é intocado — a postura tem nome próprio.
export type { ApprovalPosture } from './approval-posture.js'
export type { DefinicaoOuThunk } from './definicao-ou-thunk.js'
export { buildModelSelection } from './model-selection.js'
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
  // O alias EXISTE para ser deprecado; re-exportá-lo é o contrato de compatibilidade do M91, não um
  // uso descuidado. Sai numa major.
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
// M107 — o vizinho que TOCA disco. `mcp-resolver` decide quais servidores uma requisição recebe;
// este lê `<cwd>/.mcp.json`. A camada expunha os casos raros e não o comum, então cada consumidor
// escrevia o carregador à mão.
export { loadMcpJson, McpFileError } from './mcp-file.js'
