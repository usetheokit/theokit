/**
 * M16 (theokit-ai-first) — MCP server manifest generation (ADR-0040 § D2, home concern).
 *
 * Exposes a TheoKit agent's tools to external MCP clients as `tools/list` descriptors, so the app
 * can advertise its agents over its OWN HTTP routes. Pure data transform — no LLM, no runtime, and
 * NO stdio transport (that stays SDK-side per sdk-runtime.md). Serving these over `GET /mcp` and the
 * JSON-RPC envelope are follow-ups (mount path).
 */
import type { AgentManifestEntry } from '../manifest/agent-manifest.js'

/** The MCP protocol revision these descriptors target. */
export const MCP_PROTOCOL_VERSION = '2024-11-05'

/** A JSON-schema object (the shape MCP expects for a tool's `inputSchema`). */
export interface McpJsonSchema {
  type: 'object'
  properties: Record<string, unknown>
  required?: string[]
}

/** An MCP `tools/list` tool descriptor. */
export interface McpToolDescriptor {
  name: string
  description: string
  inputSchema: McpJsonSchema
}

/** MCP `initialize` server info. */
export interface McpServerInfo {
  name: string
  version: string
  protocolVersion: string
}

/**
 * Map an agent's tools to MCP tool descriptors. The manifest tool carries name + description; the
 * per-tool JSON schema is not retained in the manifest, so a permissive empty-object schema is
 * emitted (MCP clients accept it and pass through arbitrary args). Wiring the real per-tool schema
 * is a follow-up once the manifest carries it.
 */
export function buildMcpToolDescriptors(entry: AgentManifestEntry): McpToolDescriptor[] {
  return entry.tools.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: { type: 'object', properties: {} },
  }))
}

/** Build the MCP `initialize` server-info block for an agent. */
export function mcpServerInfo(entry: AgentManifestEntry): McpServerInfo {
  return { name: entry.name, version: '1.0', protocolVersion: MCP_PROTOCOL_VERSION }
}
