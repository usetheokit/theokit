import { accessSync, constants, statSync } from 'node:fs'
import { delimiter, join } from 'node:path'

import {
  AcpTransportClosedError,
  NodeAcpTransport,
  type AcpToolConfig,
  type AcpToolTransport,
} from 'theokit/server/agent'

/**
 * `createACPTool` spawns the agent with TheoClaw's whole environment: the model key, the channel
 * tokens and the `/control` bearer token (B-681 is an `env` option upstream). Until that exists the
 * agent is started through `env -i` with only these variables, none of which carries a secret.
 * `HOME` stays so an agent that keeps its own login in its home directory still finds it.
 *
 * This keeps the secrets out of the environment the agent receives and passes to its children. It
 * is not a boundary: the agent runs as the TheoClaw user, so it can still read TheoClaw's own
 * environment from `/proc/<pid>/environ`, as the README says.
 */
const KEPT_VARIABLES: readonly string[] = [
  'PATH',
  'HOME',
  'USER',
  'LOGNAME',
  'SHELL',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'LC_MESSAGES',
  'TERM',
  'TMPDIR',
  'TZ',
  'XDG_CONFIG_HOME',
  'XDG_DATA_HOME',
  'XDG_CACHE_HOME',
  'XDG_STATE_HOME',
]
const ENV_BINARY = '/usr/bin/env'

/**
 * The transport of one ACP call: the agent's own command, run through `env -i` with the kept
 * variables. `env` replaces itself with the agent, so the pid and process group the transport
 * closes are the agent's. A command that is not an executable file (looked up on `PATH` when it has
 * no `/`, as `env` would) is reported closed before anything is spawned, and a channel that closes
 * later is reported against the agent's command, not `env`'s.
 */
export function scrubbedAgentTransport(config: AcpToolConfig): AcpToolTransport {
  if (!runnable(config.command)) return closedTransport(new AcpTransportClosedError(config.command, COULD_NOT_RUN))
  const kept = KEPT_VARIABLES.flatMap((name) => {
    const value = process.env[name]
    return value === undefined ? [] : [`${name}=${value}`]
  })
  const inner = new NodeAcpTransport(ENV_BINARY, ['-i', '--', ...kept, config.command, ...(config.args ?? [])], config.cwd)
  return {
    send: (line) => {
      inner.send(line)
    },
    subscribe: (onData) => {
      inner.subscribe(onData)
    },
    onClose: (listener) => {
      inner.onClose((error) => {
        // `env` execs the agent, so what ended is the agent's process: name it, not `env`.
        listener(namedAfterAgent(config.command, error))
      })
    },
    close: () => inner.close(),
  }
}

const COULD_NOT_RUN = 'could not be found or run'

/** Whether `command` names an executable file, directly or through `PATH`. */
function runnable(command: string): boolean {
  if (command.includes('/')) return executableFile(command)
  return (process.env.PATH ?? '').split(delimiter).some((dir) => dir !== '' && executableFile(join(dir, command)))
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

function namedAfterAgent(command: string, error: AcpTransportClosedError): AcpTransportClosedError {
  return new AcpTransportClosedError(command, error.reason, { cause: error })
}
