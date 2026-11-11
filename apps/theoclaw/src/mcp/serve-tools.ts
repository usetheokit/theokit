import { createInterface } from 'node:readline'
import type { Readable, Writable } from 'node:stream'

import type { CustomTool } from '@theokit/sdk'
import { handleMcpToolsJsonRpc, serveMcpToolsStdio } from 'theokit/server/agent'

import { TheoClawConfigError } from '../control-plane/errors.js'
import { loadConfiguration } from '../config-file.js'
import { vetoToolCall } from '../tools/path-veto.js'
import { buildTools } from '../tools/tool-registry.js'
import { resolveToolSettings, type ToolSettings } from '../tools/tool-settings.js'

/** The `serverInfo.name` TheoClaw answers an MCP client with. */
export const MCP_SERVER_NAME = 'theoclaw'

/** Protocol revisions this endpoint speaks, newest first; a client's own is echoed, else the newest. */
const MCP_PROTOCOL_VERSIONS: readonly string[] = ['2025-06-18', '2025-03-26', '2024-11-05']

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
      return (
        tool.handler as (
          input: Record<string, unknown>,
          ctx?: unknown,
        ) => ReturnType<CustomTool['handler']>
      )(input, ctx)
    },
  })) as CustomTool[]
}

/** One MCP JSON-RPC request answered over the `/control` tools, for the authenticated `/mcp` route. */
export async function handleMcpRequest(
  tools: readonly CustomTool[],
  settings: ToolSettings,
  request: Request,
): Promise<Response> {
  if (request.method !== 'POST')
    return new Response('method not allowed', { status: 405, headers: { allow: 'POST' } })
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json(
      { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } },
      { status: 400 },
    )
  }
  if (Array.isArray(body))
    return Response.json(
      {
        jsonrpc: '2.0',
        id: null,
        error: { code: -32600, message: 'Batch requests are not supported' },
      },
      { status: 400 },
    )
  const message =
    typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : undefined
  // A notification (a method, no id) or a client's response (no method) takes no reply: 202, empty body.
  if (message !== undefined && message.jsonrpc === '2.0' && !('id' in message))
    return new Response(null, { status: 202 })
  if (message?.jsonrpc === '2.0' && message.method === 'ping')
    return Response.json({ jsonrpc: '2.0', id: message.id, result: {} })
  const reply = await handleMcpToolsJsonRpc(vetoedTools(tools, settings), MCP_SERVER_NAME, body)
  if (message?.method === 'tools/call') {
    const done = (await reply.json()) as { result?: { isError?: boolean } }
    if (done.result !== undefined) done.result.isError ??= false
    return Response.json(done)
  }
  // The handshake reply is the one that names a protocol version: negotiate it against the client's.
  const asked = (message?.params as { protocolVersion?: unknown } | undefined)?.protocolVersion
  if (message === undefined || asked === undefined) return reply
  const envelope = (await reply.json()) as { result?: { protocolVersion?: string } }
  if (envelope.result?.protocolVersion !== undefined) {
    envelope.result.protocolVersion =
      typeof asked === 'string' && MCP_PROTOCOL_VERSIONS.includes(asked)
        ? asked
        : MCP_PROTOCOL_VERSIONS[0]
  }
  return Response.json(envelope)
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
  const env: NodeJS.ProcessEnv = { ...io.env }
  loadConfiguration(env, io.homeDir)
  // A grant from `theoclaw attach` expires: a server started after it, or still running at it, stops.
  const expires =
    env.THEOCLAW_MCP_EXPIRES_AT === undefined ? undefined : Date.parse(env.THEOCLAW_MCP_EXPIRES_AT)
  if (expires !== undefined && !(expires > Date.now()))
    throw new TheoClawConfigError('the MCP grant has expired; run theoclaw attach again', {
      variable: 'THEOCLAW_MCP_EXPIRES_AT',
    })
  const settings = resolveToolSettings(env, io.cwd)
  const tools = vetoedTools(buildTools(settings), settings)
  const lines = createInterface({ input: io.stdin as Readable })
  const timer =
    expires === undefined
      ? undefined
      : setTimeout(() => lines.close(), Math.min(expires - Date.now(), 2 ** 31 - 1))
  try {
    await serveMcpToolsStdio(tools, MCP_SERVER_NAME, {
      lines,
      write: (line) => void io.stdout.write(line),
    })
  } finally {
    clearTimeout(timer)
  }
}
