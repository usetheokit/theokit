import { createInterface } from 'node:readline'
import type { Readable, Writable } from 'node:stream'

import type { CustomTool } from '@theokit/sdk'
import { handleMcpToolsHttp, serveMcpToolsStdio } from 'theokit/server/agent'

import { TheoClawConfigError } from '../control-plane/errors.js'
import { loadConfiguration } from '../config-file.js'
import { pathVetoPlugin } from '../tools/path-veto.js'
import { buildTools } from '../tools/tool-registry.js'
import { resolveToolSettings, type ToolSettings } from '../tools/tool-settings.js'

/** The `serverInfo.name` TheoClaw answers an MCP client with. */
export const MCP_SERVER_NAME = 'theoclaw'

/** One MCP JSON-RPC request answered over the `/control` tools, for the authenticated `/mcp` route. */
export async function handleMcpRequest(
  tools: readonly CustomTool[],
  settings: ToolSettings,
  request: Request,
): Promise<Response> {
  const reply = await handleMcpToolsHttp(tools, MCP_SERVER_NAME, request, {
    plugins: [pathVetoPlugin(settings)],
  })
  // TheoClaw's wording for a refused method: a plain-text body with the framework's `allow` header.
  if (reply.status === 405)
    return new Response('method not allowed', { status: 405, headers: reply.headers })
  return reply
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
  const tools = buildTools(settings)
  const lines = createInterface({ input: io.stdin as Readable })
  const timer =
    expires === undefined
      ? undefined
      : setTimeout(() => lines.close(), Math.min(expires - Date.now(), 2 ** 31 - 1))
  try {
    await serveMcpToolsStdio(
      tools,
      MCP_SERVER_NAME,
      {
        lines,
        write: (line) => void io.stdout.write(line),
      },
      { plugins: [pathVetoPlugin(settings)] },
    )
  } finally {
    clearTimeout(timer)
  }
}
