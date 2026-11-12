import type { PlatformName } from '@theokit/gateway'
import type { McpHttpServerConfig, McpServerConfig } from '@theokit/sdk'

import { TheoClawConfigError } from '../control-plane/errors.js'

type Env = Readonly<Record<string, string | undefined>>

/** `<platform>:<channel id>`: where each MCP event's outcome is posted. Unset: MCP events are off. */
export const MCP_EVENTS_REPLY_TO = 'THEOCLAW_MCP_EVENTS_REPLY_TO'

/** One MCP server whose events start a run. */
export interface McpEventServer {
  readonly name: string
  readonly server: McpHttpServerConfig
}

export interface McpEventsSettings {
  readonly replyTo: { readonly platform: PlatformName; readonly channelId: string }
  readonly servers: readonly McpEventServer[]
  /** Public origin the MCP server reaches the callback receiver at (HTTPS in production). */
  readonly callbackOrigin?: string
  readonly host?: string
  readonly port?: number
  readonly events?: readonly string[]
  readonly instructions?: string
}

function value(env: Env, variable: string): string | undefined {
  const text = (env[variable] ?? '').trim()
  return text === '' ? undefined : text
}

function list(text: string | undefined): string[] | undefined {
  return text === undefined ? undefined : text.split(',').map((item) => item.trim()).filter((item) => item !== '')
}

/**
 * The MCP events settings, or undefined while `THEOCLAW_MCP_EVENTS_REPLY_TO` is unset. The servers
 * are those of `THEOCLAW_EXTERNAL_TOOLS` (`THEOCLAW_MCP_EVENTS_SERVERS` narrows them); only HTTP
 * servers can deliver events. A bad value throws `TheoClawConfigError` naming the variable.
 */
export function readMcpEventsSettings(
  env: Env,
  configured: readonly PlatformName[],
  mcpServers: Readonly<Record<string, McpServerConfig>>,
): McpEventsSettings | undefined {
  const target = value(env, MCP_EVENTS_REPLY_TO)
  if (target === undefined) return undefined
  const separator = target.indexOf(':')
  const platform = separator < 0 ? target : target.slice(0, separator)
  const channelId = separator < 0 ? '' : target.slice(separator + 1).trim()
  if (!(configured as readonly string[]).includes(platform)) {
    throw new TheoClawConfigError(`${MCP_EVENTS_REPLY_TO} names ${platform}, which is not configured`, { variable: MCP_EVENTS_REPLY_TO })
  }
  if (channelId === '') throw new TheoClawConfigError(`${MCP_EVENTS_REPLY_TO} names no channel id after the platform`, { variable: MCP_EVENTS_REPLY_TO })

  const serversVariable = 'THEOCLAW_MCP_EVENTS_SERVERS'
  const names = list(value(env, serversVariable)) ?? Object.keys(mcpServers).filter((name) => 'url' in (mcpServers[name] as McpServerConfig))
  const servers = names.map((name): McpEventServer => {
    const server = mcpServers[name]
    if (server === undefined) throw new TheoClawConfigError(`${serversVariable} names ${name}, which THEOCLAW_EXTERNAL_TOOLS does not define`, { variable: serversVariable })
    if (!('url' in server)) throw new TheoClawConfigError(`${serversVariable} names ${name}, which is not an HTTP server`, { variable: serversVariable })
    return { name, server }
  })
  if (servers.length === 0) {
    throw new TheoClawConfigError(`${MCP_EVENTS_REPLY_TO} is set but THEOCLAW_EXTERNAL_TOOLS defines no HTTP MCP server`, { variable: MCP_EVENTS_REPLY_TO })
  }

  const originVariable = 'THEOCLAW_MCP_EVENTS_CALLBACK_ORIGIN'
  const callbackOrigin = value(env, originVariable)
  if (callbackOrigin !== undefined && !/^https?:\/\/[^/\s]+$/.test(callbackOrigin.replace(/\/+$/, ''))) {
    throw new TheoClawConfigError(`${originVariable} is not an origin (http(s)://host[:port])`, { variable: originVariable })
  }
  const portVariable = 'THEOCLAW_MCP_EVENTS_PORT'
  const portText = value(env, portVariable)
  const port = portText === undefined ? undefined : Number(portText)
  if (port !== undefined && (!Number.isInteger(port) || port < 0 || port > 65535)) {
    throw new TheoClawConfigError(`${portVariable} is not a port number`, { variable: portVariable })
  }
  if (port !== undefined && servers.length > 1 && port !== 0) {
    throw new TheoClawConfigError(`${portVariable} cannot be shared by ${String(servers.length)} servers: one receiver binds it each`, { variable: portVariable })
  }
  const host = value(env, 'THEOCLAW_MCP_EVENTS_HOST')
  const events = list(value(env, 'THEOCLAW_MCP_EVENTS_TYPES'))
  const instructions = value(env, 'THEOCLAW_MCP_EVENTS_INSTRUCTIONS')
  return {
    replyTo: { platform: platform as PlatformName, channelId },
    servers,
    ...(callbackOrigin === undefined ? {} : { callbackOrigin }),
    ...(host === undefined ? {} : { host }),
    ...(port === undefined ? {} : { port }),
    ...(events === undefined ? {} : { events }),
    ...(instructions === undefined ? {} : { instructions }),
  }
}
