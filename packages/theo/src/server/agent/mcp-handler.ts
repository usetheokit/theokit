/**
 * M16 (theokit-ai-first) — serve an agent as an MCP server over HTTP at `/api/agents/<name>/mcp`.
 *
 * Answers the two core MCP methods over JSON-RPC 2.0: `initialize` (server info + capabilities) and
 * `tools/list` (the agent's tools as MCP descriptors, via `buildMcpToolDescriptors`). M30 adds
 * `resources/list` + `resources/read` for `ui://` App resources. Unknown methods return `-32601`
 * (method not found). Web Standards Response (G8). The stdio transport + full method set stay
 * SDK-side (sdk-runtime.md); this exposes the agent over the app's own HTTP route.
 */
import { type CompiledTool, compileAgentModule } from '@theokit/agents'

import { type AppResource, buildResourceDescriptors, readAppResource } from './mcp-app-resources.js'

const MCP_PATH = /^\/api\/agents\/([^/]+)\/mcp$/

/**
 * The MCP protocol revision THIS server transport implements (M34). The protocol version is a
 * property of the server that speaks it (this handler), not of the manifest data generator — so the
 * handler owns it. Current MCP revision (`2025-06-18`); replaces the stale `2024-11-05` the manifest
 * generator carried.
 */
const MCP_PROTOCOL_VERSION = '2025-06-18'

/** An MCP `tools/list` descriptor with the tool's REAL input schema retained (M34 — no longer dropped). */
interface McpToolDescriptor {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

/** Build tool descriptors from the compiled tools, retaining each tool's real JSON-Schema input (M34). */
function toolDescriptors(tools: readonly CompiledTool[]): McpToolDescriptor[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    // The compiled tool already carries a JSON Schema (via `z.toJSONSchema()` in defineAgentTool).
    // Fall back to a permissive object only when a tool genuinely declared no schema.
    inputSchema:
      t.inputSchema && typeof t.inputSchema === 'object'
        ? (t.inputSchema as Record<string, unknown>)
        : { type: 'object', properties: {} },
  }))
}

/** An MCP `CallToolResult` — `content[]` + `isError` (the shape MCP clients expect). */
interface CallToolResult {
  content: { type: 'text'; text: string }[]
  isError?: boolean
}

/** Return the agent name when `urlPath` is the MCP endpoint, else `null`. */
export function isMcpPath(urlPath: string): string | null {
  const match = MCP_PATH.exec(urlPath)
  return match ? decodeURIComponent(match[1]) : null
}

interface JsonRpcRequest {
  jsonrpc: '2.0'
  id: number | string | null
  method: string
  params?: unknown
}

function isJsonRpcRequest(body: unknown): body is JsonRpcRequest {
  return (
    typeof body === 'object' &&
    body !== null &&
    (body as { jsonrpc?: unknown }).jsonrpc === '2.0' &&
    typeof (body as { method?: unknown }).method === 'string'
  )
}

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}

/**
 * Execute an MCP `tools/call` against the compiled tools (M34). Finds the tool by name, runs its
 * handler with the supplied `arguments`, and shapes the result into a `CallToolResult`. An unknown
 * tool or a throwing handler yields `{ isError: true }` (MCP convention — the model sees the failure)
 * rather than a JSON-RPC crash.
 */
async function callTool(
  tools: readonly CompiledTool[],
  toolName: unknown,
  args: unknown,
): Promise<CallToolResult> {
  if (typeof toolName !== 'string') {
    return {
      content: [{ type: 'text', text: 'tools/call requires a string `name`.' }],
      isError: true,
    }
  }
  const tool = tools.find((t) => t.name === toolName)
  if (!tool) {
    return { content: [{ type: 'text', text: `Unknown tool: ${toolName}` }], isError: true }
  }
  try {
    const result = await tool.handler(args)
    const text = typeof result === 'string' ? result : JSON.stringify(result)
    return { content: [{ type: 'text', text }] }
  } catch (err) {
    return {
      content: [
        { type: 'text', text: err instanceof Error ? err.message : 'Tool execution failed' },
      ],
      isError: true,
    }
  }
}

/** `resources/read` (M30) — extracted to keep `handleMcpJsonRpc` within the complexity budget. */
function handleResourcesRead(
  id: number | string | null,
  params: unknown,
  appResources: readonly AppResource[],
): Response {
  const uri = (params as { uri?: unknown } | undefined)?.uri
  if (typeof uri !== 'string') {
    return jsonResponse({
      jsonrpc: '2.0',
      id,
      error: { code: -32602, message: 'resources/read requires a string `uri` param.' },
    })
  }
  const contents = readAppResource(appResources, uri)
  if (contents === null) {
    return jsonResponse({
      jsonrpc: '2.0',
      id,
      error: { code: -32602, message: `Resource not found: ${uri}` },
    })
  }
  return jsonResponse({ jsonrpc: '2.0', id, result: contents })
}

/**
 * Handle one MCP JSON-RPC request for an agent module. Always returns a 200 JSON-RPC envelope.
 *
 * M30 — `appResources` (optional) are the agent's declared `ui://` App resources; when present the
 * server advertises `capabilities.resources` and answers `resources/list` + `resources/read`.
 */
export async function handleMcpJsonRpc(
  mod: unknown,
  name: string,
  body: unknown,
  appResources: readonly AppResource[] = [],
): Promise<Response> {
  if (!isJsonRpcRequest(body)) {
    return jsonResponse({
      jsonrpc: '2.0',
      id: null,
      error: { code: -32600, message: 'Invalid Request' },
    })
  }
  const { id, method, params } = body
  try {
    const compiled = compileAgentModule(mod, `mcp server for "${name}"`)
    if (method === 'initialize') {
      const capabilities: Record<string, unknown> = { tools: {} }
      if (appResources.length > 0) capabilities.resources = {}
      return jsonResponse({
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities,
          serverInfo: { name, version: '1.0' },
        },
      })
    }
    if (method === 'tools/list') {
      return jsonResponse({
        jsonrpc: '2.0',
        id,
        result: { tools: toolDescriptors(compiled.tools) },
      })
    }
    if (method === 'tools/call') {
      const p = params as { name?: unknown; arguments?: unknown } | undefined
      const result = await callTool(compiled.tools, p?.name, p?.arguments ?? {})
      return jsonResponse({ jsonrpc: '2.0', id, result })
    }
    if (method === 'resources/list') {
      return jsonResponse({
        jsonrpc: '2.0',
        id,
        result: { resources: buildResourceDescriptors(appResources) },
      })
    }
    if (method === 'resources/read') {
      return handleResourcesRead(id, params, appResources)
    }
    return jsonResponse({
      jsonrpc: '2.0',
      id,
      error: { code: -32601, message: `Method not found: ${method}` },
    })
  } catch (err) {
    return jsonResponse({
      jsonrpc: '2.0',
      id,
      error: { code: -32603, message: err instanceof Error ? err.message : 'Internal error' },
    })
  }
}
