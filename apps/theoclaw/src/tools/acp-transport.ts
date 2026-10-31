import { NodeAcpTransport, type AcpToolConfig, type AcpToolTransport } from 'theokit/server/agent'

/**
 * `createACPTool` spawns the agent with TheoClaw's whole environment: the model key, the channel
 * tokens and the `/control` bearer token (B-681 is an `env` option upstream). Until that exists the
 * agent is started through `env -i` with only these variables, none of which carries a secret.
 * `HOME` stays so an agent that keeps its own login in its home directory still finds it.
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
 * closes are the agent's, and a missing command exits 127, which the transport reports as closed.
 */
export function scrubbedAgentTransport(config: AcpToolConfig): AcpToolTransport {
  const kept = KEPT_VARIABLES.flatMap((name) => {
    const value = process.env[name]
    return value === undefined ? [] : [`${name}=${value}`]
  })
  return new NodeAcpTransport(ENV_BINARY, ['-i', '--', ...kept, config.command, ...(config.args ?? [])], config.cwd)
}
