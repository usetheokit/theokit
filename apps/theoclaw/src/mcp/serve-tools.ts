import { createInterface } from 'node:readline'
import type { Readable, Writable } from 'node:stream'

import type { CustomTool } from '@theokit/sdk'
import { handleMcpToolsJsonRpc, serveMcpToolsStdio } from 'theokit/server/agent'

import { assertGrantLive } from '../sessions/attach.js'
import { loadConfiguration } from '../config-file.js'
import { vetoToolCall } from '../tools/path-veto.js'
import { buildTools } from '../tools/tool-registry.js'
import { resolveToolSettings, type ToolSettings } from '../tools/tool-settings.js'

/** The `serverInfo.name` TheoClaw answers an MCP client with. */
export const MCP_SERVER_NAME = 'theoclaw'

/**
 * `tools` with the state-directory veto in front of each handler. An MCP call skips the SDK's
 * `pre_tool_call` plugins, so the veto the agents get from `pathVetoPlugin` is applied here (OC-67).
 */
export function vetoedTools(tools: readonly CustomTool[], settings: ToolSettings): CustomTool[] {
  return tools.map((tool) => ({
    ...tool,
    handler: (input: Record<string, unknown>, ctx?: unknown) => {
      const refusal = vetoToolCall(tool.name, input, settings)
      if (refusal !== undefined) throw new Error(refusal)
      return (tool.handler as (input: Record<string, unknown>, ctx?: unknown) => ReturnType<CustomTool['handler']>)(input, ctx)
    },
  })) as CustomTool[]
}

/** One MCP JSON-RPC request answered over the `/control` tools, for the authenticated `/mcp` route. */
export async function handleMcpRequest(tools: readonly CustomTool[], settings: ToolSettings, request: Request): Promise<Response> {
  if (request.method !== 'POST') return new Response('method not allowed', { status: 405, headers: { allow: 'POST' } })
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, { status: 400 })
  }
  return handleMcpToolsJsonRpc(vetoedTools(tools, settings), MCP_SERVER_NAME, body)
}

export interface McpCommandIo {
  readonly env: NodeJS.ProcessEnv
  readonly homeDir: string
  readonly cwd: string
  readonly stdin: Readable | NodeJS.ReadableStream
  readonly stdout: Writable
}

/**
 * `theoclaw mcp`: TheoClaw's tools served over MCP on stdin and stdout until stdin ends. The tool
 * set is `buildTools` for the configured environment, so host-changing tools exist only under
 * `THEOCLAW_HOST_TOOLS=on`, exactly as for an agent.
 */
export async function serveMcpStdio(io: McpCommandIo): Promise<void> {
  assertGrantLive(io.env)
  const env: NodeJS.ProcessEnv = { ...io.env }
  loadConfiguration(env, io.homeDir)
  const settings = resolveToolSettings(env, io.cwd)
  const tools = vetoedTools(buildTools(settings), settings)
  const lines = createInterface({ input: io.stdin as Readable })
  await serveMcpToolsStdio(tools, MCP_SERVER_NAME, { lines, write: (line) => void io.stdout.write(line) })
}
