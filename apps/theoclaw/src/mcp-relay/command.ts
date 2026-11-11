import { UsageError } from '../cli-args.js'
import type { CliIo } from '../cli.js'
import { readBearerToken } from '../control-plane/bearer.js'
import { resolveBindAddress } from '../control-plane/bind.js'
import { TheoClawConfigError } from '../control-plane/errors.js'
import { createMcpRelay } from './relay-server.js'
import { GrantError, GrantStore, grantsPath } from './grants.js'

const USAGE =
  'theoclaw mcp-relay: expected grant <name> [--tools a,b] | list | revoke <name|id> | serve --port <n> [--host <h>]'

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
  const address = resolveBindAddress(
    host === undefined ? io.env : { ...io.env, THEOCLAW_HOST: host },
  )
  const server = createMcpRelay({ instanceToken, grantsPath: grantsPath(io.env, io.homeDir) })
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

export async function mcpRelayCommand(args: readonly string[], io: CliIo): Promise<number> {
  const [verb, ...rest] = args
  if (verb === 'serve') return serve(rest, io)
  const store = new GrantStore(grantsPath(io.env, io.homeDir))
  try {
    store.load()
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
          ? undefined
          : value
              .split(',')
              .map((t) => t.trim())
              .filter((t) => t !== '')
      const { grant, token } = store.create(name, tools)
      io.stdout.write(
        `granted ${grant.name} (${grant.id}): ${grant.tools.join(', ')}\ntoken (shown once): ${token}\n`,
      )
      return 0
    }
    if (verb === 'list' && rest.length === 0) {
      for (const g of store.list()) {
        io.stdout.write(
          `${g.name}\t${g.id}\t${g.tools.join(',')}\tcreated ${g.createdAt}\t${g.revokedAt === undefined ? 'active' : `revoked ${g.revokedAt}`}\n`,
        )
      }
      return 0
    }
    if (verb === 'revoke' && rest.length === 1 && !rest[0]!.startsWith('-')) {
      const grant = store.revoke(rest[0]!)
      io.stdout.write(`revoked ${grant.name} (${grant.id})\n`)
      return 0
    }
    throw new UsageError(USAGE)
  } catch (error) {
    if (error instanceof GrantError) throw new UsageError(`theoclaw mcp-relay: ${error.message}`)
    throw error
  }
}
