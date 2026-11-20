import { accessSync, constants, statSync } from 'node:fs'
import { delimiter, isAbsolute, join } from 'node:path'

import { allowlistedEnv } from '@theokit/agents/sandbox'

import {
  AcpTransportClosedError,
  NodeAcpTransport,
  type AcpToolConfig,
  type AcpToolTransport,
} from 'theokit/server/agent'

/**
 * The environment an ACP agent receives: the framework's allowlist (`allowlistedEnv`) plus the locale
 * and XDG variables, with `PATH` cut to its absolute entries. None of it carries a secret: the model
 * key, the channel tokens and the `/control` bearer token stay out. `HOME` stays so an agent that
 * keeps its own login in its home directory still finds it.
 *
 * This keeps the secrets out of the environment the agent receives and passes to its children. It
 * is not a boundary: the agent runs as the TheoClaw user, so it can still read TheoClaw's own
 * environment from `/proc/<pid>/environ`, as the README says.
 */
export function acpAgentEnv(source: Readonly<Record<string, string | undefined>> = process.env): Record<string, string> {
  const env = keptEnv(source)
  // An empty `PATH=` is itself one empty entry, so no absolute entry means no `PATH` at all.
  const searched = absolutePathEntries(source)
  if (searched.length === 0) delete env.PATH
  else env.PATH = searched.join(delimiter)
  return env
}

/** The framework allowlist plus the variables TheoClaw has always kept: `LOGNAME`, `TZ`, `LC_MESSAGES` and the XDG directories. */
export function keptEnv(source: Readonly<Record<string, string | undefined>>): Record<string, string> {
  const env: Record<string, string> = { ...allowlistedEnv(source) }
  for (const name of EXTRA_VARIABLES) {
    const value = source[name]
    if (value !== undefined) env[name] = value
  }
  return env
}

const EXTRA_VARIABLES: readonly string[] = ['LOGNAME', 'TZ', 'LC_MESSAGES', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_CACHE_HOME', 'XDG_STATE_HOME']

/**
 * The transport of one ACP call: the agent's own command, spawned directly with `config.env` (default
 * `acpAgentEnv()`). A command with no `/` is looked up here, on the absolute `PATH` entries only,
 * and the spawn gets the absolute path it resolved to: a bare name would be resolved against an empty
 * or relative entry in the agent's working directory, the tool root (B-706). A command that is not an
 * executable file is reported closed before anything is spawned.
 */
export function agentTransport(config: AcpToolConfig): AcpToolTransport {
  const env = config.env ?? acpAgentEnv()
  const resolved = resolveCommand(config.command, absolutePathEntries())
  if (resolved === undefined) return closedTransport(new AcpTransportClosedError(config.command, COULD_NOT_RUN))
  const inner = new NodeAcpTransport(resolved, [...(config.args ?? [])], config.cwd, env)
  return {
    send: (line) => {
      inner.send(line)
    },
    subscribe: (onData) => {
      inner.subscribe(onData)
    },
    onClose: (listener) => {
      // The process that ended is the agent's, found at `resolved`: name it as the owner configured it.
      inner.onClose((error) => {
        listener(new AcpTransportClosedError(config.command, error.reason, { cause: error }))
      })
    },
    close: () => inner.close(),
  }
}

const COULD_NOT_RUN = 'could not be found or run (a command is an absolute path or a bare name found on PATH)'

/**
 * The executable file `command` names: itself when it has a `/`, else the first one on an absolute
 * `PATH` entry.
 */
function resolveCommand(command: string, searched: readonly string[]): string | undefined {
  // A relative one would be found from TheoClaw's cwd but resolved in the agent's, the tool root.
  if (command.includes('/')) return isAbsolute(command) && executableFile(command) ? command : undefined
  return searched
    .map((dir) => join(dir, command))
    .find((candidate) => !candidate.includes('=') && executableFile(candidate))
}

/** The absolute entries of TheoClaw's `PATH`; an empty entry, `.` or `bin` would resolve in the tool root. */
function absolutePathEntries(source: Readonly<Record<string, string | undefined>> = process.env): string[] {
  return (source.PATH ?? '').split(delimiter).filter((dir) => isAbsolute(dir))
}

function executableFile(path: string): boolean {
  try {
    accessSync(path, constants.X_OK)
    return statSync(path).isFile()
  } catch {
    // Missing, not executable or unreadable: `env` could not run it either.
    return false
  }
}

/** A transport whose channel is already closed with `error`: nothing is sent and nothing spawned. */
function closedTransport(error: AcpTransportClosedError): AcpToolTransport {
  return {
    send: () => undefined,
    subscribe: () => undefined,
    onClose: (listener) => {
      listener(error)
    },
  }
}
