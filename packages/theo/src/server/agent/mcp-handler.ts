/**
 * M16 (theokit-ai-first) — serve an agent as an MCP server over HTTP at `/api/agents/<name>/mcp`.
 *
 * Answers the two core MCP methods over JSON-RPC 2.0: `initialize` (server info + capabilities) and
 * `tools/list` (the agent's tools as MCP descriptors, via `buildMcpToolDescriptors`). M30 adds
 * `resources/list` + `resources/read` for `ui://` App resources. Unknown methods return `-32601`
 * (method not found). Web Standards Response (G8). The stdio transport + full method set stay
 * SDK-side (sdk-runtime.md); this exposes the agent over the app's own HTTP route.
 */
import {
  type AgentManifestEntry,
  buildMcpToolDescriptors,
  compileAgentModule,
  mcpServerInfo,
} from '@theokit/agents'

import { type AppResource, buildResourceDescriptors, readAppResource } from './mcp-app-resources.js'

const MCP_PATH = /^\/api\/agents\/([^/]+)\/mcp$/

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

/** Minimal manifest entry (the subset the MCP generators read) from a compiled agent. */
function toEntry(name: string, mod: unknown): AgentManifestEntry {
  const compiled = compileAgentModule(mod, `mcp server for "${name}"`)
  return {
    name,
    route: `/api/agents/${name}`,
    stream: compiled.stream,
    mainLoop: { method: '', strategy: '' },
    guards: [],
    interceptors: [],
    tools: compiled.tools.map((t) => ({
      name: t.name,
      description: t.description,
      approval: false,
      trace: false,
      audit: false,
    })),
    subAgents: [],
  }
}

/**
 * Handle one MCP JSON-RPC request for an agent module. Always returns a 200 JSON-RPC envelope.
 *
 * M30 — `appResources` (optional) are the agent's declared `ui://` App resources; when present the
 * server advertises `capabilities.resources` and answers `resources/list` + `resources/read`.
 */
export function handleMcpJsonRpc(
  mod: unknown,
  name: string,
  body: unknown,
  appResources: readonly AppResource[] = [],
): Response {
  if (!isJsonRpcRequest(body)) {
    return jsonResponse({
      jsonrpc: '2.0',
      id: null,
      error: { code: -32600, message: 'Invalid Request' },
    })
  }
  const { id, method, params } = body
  try {
    const entry = toEntry(name, mod)
    if (method === 'initialize') {
      const info = mcpServerInfo(entry)
      const capabilities: Record<string, unknown> = { tools: {} }
      if (appResources.length > 0) capabilities.resources = {}
      return jsonResponse({
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: info.protocolVersion,
          capabilities,
          serverInfo: { name: info.name, version: info.version },
        },
      })
    }
    if (method === 'tools/list') {
      return jsonResponse({ jsonrpc: '2.0', id, result: { tools: buildMcpToolDescriptors(entry) } })
    }
    if (method === 'resources/list') {
      return jsonResponse({
        jsonrpc: '2.0',
        id,
        result: { resources: buildResourceDescriptors(appResources) },
      })
    }
    if (method === 'resources/read') {
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
