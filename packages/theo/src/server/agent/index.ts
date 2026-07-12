/**
 * `theokit/server/agent` — the agent-seam sub-path (ADR-0001 v3 subpath entrypoints, T2.5).
 *
 * The public agent-domain surface, addressable directly instead of through the deprecated umbrella
 * `theokit/server`. It gathers: the in-process turn seam (M35 — an Ink TUI / Tauri drives one agent turn in
 * ONE process, no HTTP loopback), the agent-tool adapters (workflow / ACP / vendor), the code-mode sandbox,
 * channel webhooks, and MCP stdio / app-resources. The umbrella re-exports this barrel for back-compat until
 * `0.x+2`; new code should import from `theokit/server/agent`.
 */

// Agent-tool adapters — wrap an external runtime (coding agent, SDK workflow) as a `CustomTool`.
export { createWorkflowTool } from './workflow-tool.js'
export type { WorkflowLike, WorkflowToolConfig } from './workflow-tool.js'
export { createACPTool, NodeAcpTransport } from './acp-tool.js'
export type { AcpToolConfig } from './acp-tool.js'
export { createVendorAgentTool } from './vendor-agent-tool.js'
export type { VendorAgentClient, VendorAgentToolConfig } from './vendor-agent-tool.js'

// Code-mode sandbox — agent composes tools in code run inside an INJECTED isolation boundary.
export { createCodeMode, CodeModePermissionDeniedError } from './code-mode.js'
export type { Sandbox, CodeModeApi, CodeModeConfig, CodeModePermission } from './code-mode.js'

// Channel webhook routes (Slack / Telegram / Discord) with per-platform signature validation.
export { handleChannelWebhook, parseChannelPath, isChannelPath } from './channel-webhook.js'
export type { ChannelMessage, ChannelWebhookConfig } from './channel-webhook.js'

// In-process agent-turn seam (M35, Model A): drive an agent turn in one process with inline HITL.
export {
  streamAgentTurnInProcess,
  InProcessApprovalRequiredError,
} from './stream-agent-turn-in-process.js'
export type {
  StreamAgentTurnInProcessInput,
  StreamAgentTurnDeps,
  InProcessApprovalRequest,
  InProcessAwaitApproval,
} from './stream-agent-turn-in-process.js'

// MCP stdio transport + `ui://` app resources served by the MCP server.
export { serveMcpStdio, handleMcpStdioLine, type StdioStreams } from './mcp-stdio.js'
export {
  defineAppResource,
  buildResourceDescriptors,
  readAppResource,
  extractAppResources,
} from './mcp-app-resources.js'
export type {
  AppResource,
  AppResourceInput,
  McpResourceDescriptor,
  McpResourceContents,
} from './mcp-app-resources.js'
