/** Sub-path entry: @theokit/agents/mcp-relay — expose local tools to a hosted MCP client. */
export {
  createMcpRelayServer,
  MCP_PATH,
  POLL_PATH,
  RESPOND_PATH,
  type McpRelayServerOptions,
  type RelayJob,
} from './mcp-relay/relay-server.js'
export {
  answerRelayJob,
  startMcpRelayConnector,
  type McpRelayConnector,
  type McpRelayConnectorOptions,
  type RelayTool,
} from './mcp-relay/connector.js'
export type { Grant, GrantStore } from '@theokit/http/guards'
