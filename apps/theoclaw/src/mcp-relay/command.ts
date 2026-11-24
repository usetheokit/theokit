import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createMcpRelayServer, startMcpRelayConnector } from '@theokit/agents/mcp-relay'
import { createGrantStore, GuardConfigError, type GrantStore } from '@theokit/http/guards'
import type { CustomTool } from '@theokit/sdk'

import { UsageError } from '../cli-args.js'
import type { CliIo } from '../cli.js'
import { readBearerToken } from '../control-plane/bearer.js'
import { resolveControlHost, type BindEnvironment } from '../control-plane/bind.js'
import { TheoClawConfigError } from '../control-plane/errors.js'
import { handleMcpRequest } from '../mcp/serve-tools.js'
import { BUILT_TOOL_NAMES, CONTROL_TOOL_NAMES } from '../tools/tool-names.js'
import { buildTools } from '../tools/tool-registry.js'
import { resolveToolSettings, type ToolSettings } from '../tools/tool-settings.js'

/** The tools a grant gets when none are named: read-only ones only. */
export const DEFAULT_GRANT_TOOLS: readonly string[] = ['list_dir', 'read_file']

export function grantsPath(
  env: Readonly<Record<string, string | undefined>>,
  homeDir: string,
): string {
  const explicit = env.THEOCLAW_STATE_DIR?.trim()
  const state =
    explicit || join(env.XDG_STATE_HOME?.trim() || join(homeDir, '.local', 'state'), 'theoclaw')
  return join(state, 'mcp-relay-grants.json')
}

/** The instance side of the hosted MCP relay (OC-116): `THEOCLAW_MCP_RELAY_URL` and `_TOKEN`. */
export interface McpRelaySettings {
  readonly url: string
  readonly token: string
}

/** Both variables set switches the connector on; neither set leaves it off; one alone is refused. */
export function readMcpRelaySettings(env: BindEnvironment): McpRelaySettings | undefined {
  const rawUrl = env.THEOCLAW_MCP_RELAY_URL
  const token = readBearerToken(env, 'THEOCLAW_MCP_RELAY_TOKEN')
  if ((rawUrl === undefined || rawUrl === '') && token === undefined) return undefined
  if (rawUrl === undefined || rawUrl === '') {
    throw new TheoClawConfigError('THEOCLAW_MCP_RELAY_URL must be set with THEOCLAW_MCP_RELAY_TOKEN', {
      variable: 'THEOCLAW_MCP_RELAY_URL',
    })
  }
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw new TheoClawConfigError('THEOCLAW_MCP_RELAY_URL does not parse', {
      variable: 'THEOCLAW_MCP_RELAY_URL',
    })
  }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new TheoClawConfigError('THEOCLAW_MCP_RELAY_URL must be https: (or http: on the loopback)', {
      variable: 'THEOCLAW_MCP_RELAY_URL',
    })
  }
  if (token === undefined) {
    throw new TheoClawConfigError('THEOCLAW_MCP_RELAY_TOKEN must be set with THEOCLAW_MCP_RELAY_URL', {
      variable: 'THEOCLAW_MCP_RELAY_TOKEN',
    })
  }
  return { url: rawUrl.replace(/\/$/, ''), token }
}

/** Values the output mask hides. */
export function mcpRelaySecrets(settings: McpRelaySettings | undefined): string[] {
  return settings === undefined ? [] : [settings.token]
}

/** Answers one relayed JSON-RPC body through the same handler and veto as `/mcp`. */
export function mcpRelayDispatch(
  toolSettings: ToolSettings,
): (tools: readonly CustomTool[], body: unknown) => Promise<unknown> {
  return async (tools, body) => {
    const response = await handleMcpRequest(
      tools,
      toolSettings,
      new Request('http://mcp-relay.invalid/mcp', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
    )
    const text = await response.text()
    return text === '' ? null : (JSON.parse(text) as unknown)
  }
}

/**
 * A grant file in the format before the framework store (`tokenHash`, `tools`) is refused with the
 * re-grant steps; the framework store would call it malformed and refuse every client.
 */
function refuseLegacyGrants(path: string): void {
  if (!existsSync(path)) return
  let grants: unknown
  try {
    grants = (JSON.parse(readFileSync(path, 'utf8')) as { grants?: unknown }).grants
  } catch {
    return
  }
  if (
    Array.isArray(grants) &&
    grants.some((g) => typeof g === 'object' && g !== null && 'tokenHash' in g)
  ) {
    throw new UsageError(
      `theoclaw mcp-relay: ${path} is in the old grant format (tokenHash, tools). Move it aside and run "theoclaw mcp-relay grant <name>" again for each client; the old tokens cannot be converted.`,
    )
  }
}

function openGrants(path: string): GrantStore {
  refuseLegacyGrants(path)
  return createGrantStore(path)
}

function checkTools(tools: readonly string[]): void {
  const known = new Set([...BUILT_TOOL_NAMES, ...CONTROL_TOOL_NAMES])
  const unknown = tools.filter((t) => !known.has(t))
  if (tools.length === 0 || unknown.length > 0) {
    throw new UsageError(
      `theoclaw mcp-relay: ${unknown.length > 0 ? `unknown tool: ${unknown.join(', ')}` : 'no tools named'}`,
    )
  }
}

const USAGE =
  'theoclaw mcp-relay: expected grant <name> [--tools a,b] | list | revoke <name|id> | serve --port <n> [--host <h>] | smoke'

async function serve(rest: readonly string[], io: CliIo): Promise<number> {
  let port: number | undefined
  let host: string | undefined
  for (let i = 0; i < rest.length; i += 2) {
    const value = rest[i + 1]
    if (value === undefined || value.startsWith('-')) throw new UsageError(USAGE)
    if (rest[i] === '--port' && /^\d+$/.test(value) && Number(value) <= 65_535) port = Number(value)
    else if (rest[i] === '--host' && host === undefined) host = value
    else throw new UsageError(USAGE)
  }
  if (port === undefined) throw new UsageError(USAGE)
  const instanceToken = readBearerToken(io.env, 'THEOCLAW_MCP_RELAY_TOKEN')
  if (instanceToken === undefined) {
    throw new TheoClawConfigError('THEOCLAW_MCP_RELAY_TOKEN is not set', {
      variable: 'THEOCLAW_MCP_RELAY_TOKEN',
    })
  }
  const address = resolveControlHost(
    host === undefined ? io.env : { ...io.env, THEOCLAW_HOST: host },
  )
  const server = createMcpRelayServer({
    instanceToken,
    grants: openGrants(grantsPath(io.env, io.homeDir)),
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, address, resolve)
  })
  const bound = server.address()
  io.stdout.write(
    `mcp-relay listening on ${address}:${typeof bound === 'object' && bound !== null ? bound.port : port}\n`,
  )
  await new Promise<void>((resolve) => {
    for (const signal of ['SIGINT', 'SIGTERM'] as const) io.signals.on(signal, () => resolve())
    server.once('close', resolve)
  })
  server.closeAllConnections()
  await new Promise<void>((resolve) => server.close(() => resolve()))
  return 0
}

/** One-command check: relay, connector and `list_dir` on loopback with a throwaway grant and directory. */
async function smoke(io: CliIo): Promise<number> {
  const dir = mkdtempSync(join(tmpdir(), 'mcp-relay-smoke-'))
  const instanceToken = 'smoke-instance-token-0123456789abcdef'
  const toolSettings = resolveToolSettings({}, dir)
  writeFileSync(join(toolSettings.toolRoot, 'smoke.txt'), 'ok')
  const grants = join(dir, 'grants.json')
  const store = createGrantStore(grants)
  const { credential: token } = await store.create('smoke', DEFAULT_GRANT_TOOLS)
  const relay = createMcpRelayServer({ instanceToken, grants: store, pollMs: 50, timeoutMs: 5000 })
  await new Promise<void>((resolve) => relay.listen(0, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${(relay.address() as AddressInfo).port}`
  const connector = startMcpRelayConnector({
    url,
    token: instanceToken,
    tools: () => buildTools(toolSettings),
    dispatch: mcpRelayDispatch(toolSettings),
  })
  try {
    const res = await fetch(`${url}/mcp`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'list_dir', arguments: { path: '.' } },
      }),
    })
    const text = await res.text()
    if (res.status !== 200 || !text.includes('smoke.txt')) {
      io.stderr.write(`mcp-relay smoke: failed (HTTP ${res.status})\n`)
      return 1
    }
    io.stdout.write('mcp-relay smoke: ok (list_dir through relay and connector)\n')
    return 0
  } finally {
    await connector.stop()
    relay.closeAllConnections()
    await new Promise<void>((resolve) => relay.close(() => resolve()))
    rmSync(dir, { recursive: true, force: true })
  }
}

export async function mcpRelayCommand(args: readonly string[], io: CliIo): Promise<number> {
  const [verb, ...rest] = args
  if (verb === 'serve') return serve(rest, io)
  if (verb === 'smoke' && rest.length === 0) return smoke(io)
  const store = openGrants(grantsPath(io.env, io.homeDir))
  try {
    if (verb === 'grant') {
      const [name, flag, value, ...extra] = rest
      const bare = flag === undefined && value === undefined
      if (
        name === undefined ||
        name.startsWith('-') ||
        extra.length > 0 ||
        (!bare && (flag !== '--tools' || value === undefined))
      ) {
        throw new UsageError(USAGE)
      }
      const tools =
        value === undefined
          ? DEFAULT_GRANT_TOOLS
          : value
              .split(',')
              .map((t) => t.trim())
              .filter((t) => t !== '')
      checkTools(tools)
      const { grant, credential } = await store.create(name, tools)
      io.stdout.write(
        `granted ${grant.name} (${grant.id}): ${grant.scopes.join(', ')}\ntoken (shown once): ${credential}\n`,
      )
      return 0
    }
    if (verb === 'list' && rest.length === 0) {
      for (const g of await store.list()) {
        io.stdout.write(
          `${g.name}\t${g.id}\t${g.scopes.join(',')}\tcreated ${g.createdAt}\t${g.revokedAt === undefined ? 'active' : `revoked ${g.revokedAt}`}\n`,
        )
      }
      return 0
    }
    if (verb === 'revoke' && rest.length === 1 && !rest[0]!.startsWith('-')) {
      const target = rest[0]!
      // The framework store revokes by name; the CLI also takes the id.
      const grant = (await store.list()).find(
        (g) => g.revokedAt === undefined && (g.name === target || g.id === target),
      )
      if (grant === undefined || !(await store.revoke(grant.name))) {
        throw new UsageError(`theoclaw mcp-relay: no active grant "${target}"`)
      }
      io.stdout.write(`revoked ${grant.name} (${grant.id})\n`)
      return 0
    }
    throw new UsageError(USAGE)
  } catch (error) {
    if (error instanceof GuardConfigError) throw new UsageError(`theoclaw mcp-relay: ${error.message}`)
    throw error
  }
}
