/**
 * @MCP() — declares Model Context Protocol servers available to an agent.
 *
 * Compiles to SDK's mcpServers in Agent.create({ mcpServers }).
 * Each key is a server name; the value is the server configuration.
 *
 * @example
 * ```ts
 * @Agent({ name: 'dev', route: '/api/agents/dev' })
 * @MCP({
 *   github: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'] },
 *   filesystem: { command: 'npx', args: ['-y', '@mcp/server-filesystem', '/workspace'] },
 * })
 * class DevAgent { ... }
 * ```
 */
import { setMeta, getMeta } from '../metadata/index.js'

const MCP_CONFIG = Symbol.for('theokit:agents:mcp')

export interface McpServerConfig {
  /** Command to start the MCP server. */
  command: string
  /** Arguments passed to the command. */
  args?: string[]
  /** Environment variables for the server process. */
  env?: Record<string, string>
  /** Working directory for the server process. */
  cwd?: string
}

export type McpServersMap = Record<string, McpServerConfig>

export function MCP(servers: McpServersMap): ClassDecorator {
  return (target: Function) => {
    setMeta(MCP_CONFIG, target, servers)
  }
}

export function getMcpConfig(target: Function): McpServersMap | undefined {
  return getMeta<McpServersMap>(MCP_CONFIG, target)
}
