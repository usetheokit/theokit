/**
 * M16 (theokit-ai-first) — serve an agent as an MCP server over HTTP at `/api/agents/<name>/mcp`.
 *
 * Answers the two core MCP methods over JSON-RPC 2.0: `initialize` (server info + capabilities) and
 * `tools/list` (the agent's tools as MCP descriptors, via `buildMcpToolDescriptors`). M30 adds
 * `resources/list` + `resources/read` for `ui://` App resources. Unknown methods return `-32601`
 * (method not found). Web Standards Response (G8). The stdio transport + full method set stay
 * SDK-side (sdk-runtime.md); this exposes the agent over the app's own HTTP route.
 */
import { type CompiledTool, compileLoadedAgentModule } from '@theokit/agents'
import { runPreToolCall } from '@theokit/sdk'
import type { CustomTool, Plugin, PreToolCallContext } from '@theokit/sdk'

import { type AppResource, buildResourceDescriptors, readAppResource } from './mcp-app-resources.js'

const MCP_PATH = /^\/api\/agents\/([^/]+)\/mcp$/

/**
 * The MCP protocol revision THIS server transport implements (M34). The protocol version is a
 * property of the server that speaks it (this handler), not of the manifest data generator — so the
 * handler owns it. Current MCP revision (`2025-06-18`); replaces the stale `2024-11-05` the manifest
 * generator carried.
 */
const MCP_PROTOCOL_VERSION = '2025-06-18'

/** Revisions negotiated by default, newest first. */
const DEFAULT_PROTOCOL_VERSIONS: readonly string[] = ['2025-06-18', '2025-03-26', '2024-11-05']

/** Options for {@link handleMcpToolsHttp}. */
export interface McpHttpOptions extends McpToolsOptions {
  /** Supported revisions, newest first. Default ['2025-06-18', '2025-03-26', '2024-11-05']. */
  readonly protocolVersions?: readonly string[]
}

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

/** Options for the MCP tool handlers. */
export interface McpToolsOptions {
  /** pre_tool_call hooks of these plugins run before each tools/call; a block answers a tool result with isError true and the plugin message. */
  plugins?: readonly Plugin[]
  /** The agent id handed to the hooks; `runId` is generated per call. Defaults to the server name. */
  hookContext?: { agentId: string }
}

/** Run the plugins' `pre_tool_call` hooks; the refusal text, or `undefined` to allow. A throwing hook refuses (fail closed). */
async function preToolCallRefusal(
  plugins: readonly Plugin[],
  ctx: PreToolCallContext,
): Promise<string | undefined> {
  try {
    return (await runPreToolCall(plugins, ctx))?.message
  } catch (err) {
    return `A pre_tool_call plugin failed, so the call was refused: ${
      err instanceof Error ? err.message : String(err)
    }`
  }
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

type JsonRpcId = number | string | null

interface JsonRpcRequest {
  jsonrpc: '2.0'
  id: JsonRpcId
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

function isIdlessMessage(body: unknown): boolean {
  return (
    typeof body === 'object' &&
    body !== null &&
    !Array.isArray(body) &&
    (body as { jsonrpc?: unknown }).jsonrpc === '2.0' &&
    !('id' in body)
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
  hitl?: ReadonlyMap<string, unknown>,
  guard?: (toolName: string, args: unknown) => Promise<string | undefined>,
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
  // #99 — REFUSE a HITL-gated tool. The approval gate (`compiled.hitl`) lives in the SDK run-loop,
  // not in the raw tool handler; executing the handler here would BYPASS the human approval the web/
  // TUI surfaces enforce. Over MCP there is no approval mechanism, so a gated tool is not callable —
  // return an error result instead of running it unguarded (fail-closed, Rule 8).
  if (hitl?.has(toolName)) {
    return {
      content: [
        {
          type: 'text',
          text: `Tool "${toolName}" requires human approval, which is not available over MCP. Refused.`,
        },
      ],
      isError: true,
    }
  }
  const refusal = await guard?.(toolName, args)
  if (refusal !== undefined) {
    return { content: [{ type: 'text', text: refusal }], isError: true }
  }
  try {
    const result = await tool.handler(args)
    const text = typeof result === 'string' ? result : JSON.stringify(result)
    return { content: [{ type: 'text', text }], isError: false }
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
  id: JsonRpcId,
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

/** What a JSON-RPC dispatch serves: compiled tools, their approval gate, and any App resources. */
interface McpServed {
  tools: readonly CompiledTool[]
  hitl?: ReadonlyMap<string, unknown>
  appResources: readonly AppResource[]
  options?: McpToolsOptions
  protocolVersions?: readonly string[]
}

function rpcResult(id: JsonRpcId, result: unknown): Response {
  return jsonResponse({ jsonrpc: '2.0', id, result })
}

/** The client's requested revision when supported, else the newest supported one. */
function negotiateVersion(params: unknown, supported: readonly string[]): string {
  const versions = supported.length > 0 ? supported : DEFAULT_PROTOCOL_VERSIONS
  const asked = (params as { protocolVersion?: unknown } | null | undefined)?.protocolVersion
  return typeof asked === 'string' && versions.includes(asked) ? asked : versions[0]
}

function initializeResult(
  name: string,
  appResources: readonly AppResource[],
  protocolVersion: string,
): unknown {
  const capabilities: Record<string, unknown> = { tools: {} }
  if (appResources.length > 0) capabilities.resources = {}
  return {
    protocolVersion,
    capabilities,
    serverInfo: { name, version: '1.0' },
  }
}

/** Dispatch one validated request over the served tools. Shared by the agent and tool-list entry points. */
async function dispatchMcp(
  served: McpServed,
  name: string,
  { id, method, params }: JsonRpcRequest,
): Promise<Response> {
  switch (method) {
    case 'initialize':
      return rpcResult(
        id,
        initializeResult(
          name,
          served.appResources,
          negotiateVersion(params, served.protocolVersions ?? [MCP_PROTOCOL_VERSION]),
        ),
      )
    case 'ping':
      return rpcResult(id, {})
    case 'tools/list':
      return rpcResult(id, { tools: toolDescriptors(served.tools) })
    case 'tools/call': {
      const p = params as { name?: unknown; arguments?: unknown } | undefined
      const plugins = served.options?.plugins
      const agentId = served.options?.hookContext?.agentId ?? name
      const guard =
        plugins && plugins.length > 0
          ? (toolName: string, args: unknown) =>
              preToolCallRefusal(plugins, {
                name: toolName,
                args: (args && typeof args === 'object' ? args : {}) as Record<string, unknown>,
                agentId,
                runId: globalThis.crypto.randomUUID(),
              })
          : undefined
      return rpcResult(
        id,
        await callTool(served.tools, p?.name, p?.arguments ?? {}, served.hitl, guard),
      )
    }
    case 'resources/list':
      return rpcResult(id, { resources: buildResourceDescriptors(served.appResources) })
    case 'resources/read':
      return handleResourcesRead(id, params, served.appResources)
    default:
      return jsonResponse({
        jsonrpc: '2.0',
        id,
        error: { code: -32601, message: `Method not found: ${method}` },
      })
  }
}

/** Validate the envelope, then run `serve` and map any throw to a `-32603` error envelope. */
async function runMcp(
  body: unknown,
  serve: (req: JsonRpcRequest) => Promise<Response>,
): Promise<Response> {
  // A message without `id` (notification or client response) gets no JSON-RPC reply.
  if (isIdlessMessage(body)) return new Response(null, { status: 202 })
  if (!isJsonRpcRequest(body)) {
    return jsonResponse({
      jsonrpc: '2.0',
      id: null,
      error: { code: -32600, message: 'Invalid Request' },
    })
  }
  try {
    return await serve(body)
  } catch (err) {
    return jsonResponse({
      jsonrpc: '2.0',
      id: body.id,
      error: { code: -32603, message: err instanceof Error ? err.message : 'Internal error' },
    })
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
  options?: McpToolsOptions,
): Promise<Response> {
  return runMcp(body, (req) => {
    const compiled = compileLoadedAgentModule(mod, `mcp server for "${name}"`)
    return dispatchMcp(
      {
        tools: compiled.tools,
        hitl: compiled.hitl,
        appResources,
        protocolVersions: DEFAULT_PROTOCOL_VERSIONS,
        options,
      },
      name,
      req,
    )
  })
}

/** Throw on the first duplicate tool name: an MCP client could not tell the two apart. */
function assertUniqueToolNames(tools: readonly CustomTool[]): void {
  const seen = new Set<string>()
  for (const t of tools) {
    if (seen.has(t.name)) throw new Error(`Duplicate MCP tool name: "${t.name}"`)
    seen.add(t.name)
  }
}

/**
 * Handle one MCP JSON-RPC request for a plain list of tools (no agent module). Same JSON-RPC
 * handling as {@link handleMcpJsonRpc}; advertises `capabilities.tools` only (no resources).
 *
 * There is NO approval gate: a list of tools carries no human-approval policy, so none is refused as
 * "requires human approval". Whoever passes a tool in decides it may run unattended.
 *
 * @throws when two tools share a name (checked when called, before any request is answered).
 */
export function handleMcpToolsJsonRpc(
  tools: readonly CustomTool[],
  name: string,
  body: unknown,
  options?: McpToolsOptions,
): Promise<Response> {
  assertUniqueToolNames(tools)
  const served: McpServed = {
    tools: tools as readonly CompiledTool[],
    appResources: [],
    protocolVersions: DEFAULT_PROTOCOL_VERSIONS,
    options,
  }
  return runMcp(body, (req) => dispatchMcp(served, name, req))
}

function rpcErrorResponse(status: number, code: number, message: string): Response {
  return new Response(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code, message } }), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}

/**
 * Parse an HTTP body as one JSON-RPC message: `-32700` (400) for bad JSON, `-32600` (400) for a
 * batch. Returns the parsed message, or the error `Response` to send.
 */
export async function parseMcpHttpBody(
  request: Request,
): Promise<{ body: unknown } | { error: Response }> {
  let body: unknown
  try {
    body = JSON.parse(await request.text())
  } catch {
    return { error: rpcErrorResponse(400, -32700, 'Parse error') }
  }
  if (Array.isArray(body)) {
    return { error: rpcErrorResponse(400, -32600, 'Batch requests are not supported') }
  }
  return { body }
}

/**
 * Full HTTP handling of one MCP request over a list of tools: 405 (`allow: POST`) for other
 * methods, 400 for bad JSON (`-32700`) or a batch (`-32600`), 202 with an empty body for a
 * notification, otherwise the JSON-RPC envelope. `initialize` negotiates the protocol version.
 *
 * @throws when two tools share a name.
 */
export async function handleMcpToolsHttp(
  tools: readonly CustomTool[],
  name: string,
  request: Request,
  options: McpHttpOptions = {},
): Promise<Response> {
  assertUniqueToolNames(tools)
  if (request.method !== 'POST') {
    return new Response(null, { status: 405, headers: { allow: 'POST' } })
  }
  const parsed = await parseMcpHttpBody(request)
  if ('error' in parsed) return parsed.error
  const served: McpServed = {
    tools: tools as readonly CompiledTool[],
    appResources: [],
    protocolVersions: options.protocolVersions ?? DEFAULT_PROTOCOL_VERSIONS,
    options,
  }
  return runMcp(parsed.body, (req) => dispatchMcp(served, name, req))
}
