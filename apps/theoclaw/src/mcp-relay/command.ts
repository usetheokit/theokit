import { UsageError } from '../cli-args.js'
import type { CliIo } from '../cli.js'
import { GrantError, GrantStore, grantsPath } from './grants.js'

const USAGE = 'theoclaw mcp-relay: expected grant <name> [--tools a,b] | list | revoke <name|id>'

export function mcpRelayCommand(args: readonly string[], io: CliIo): number {
  const [verb, ...rest] = args
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
