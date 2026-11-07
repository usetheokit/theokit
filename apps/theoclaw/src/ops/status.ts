import { loadConfiguration, configurationPath } from '../config-file.js'
import { resolvePlatforms } from '../channels/platforms.js'
import { daemonStatus } from '../daemon.js'
import { resolveInstance } from '../instance.js'
import type { DaemonIo as CliIo } from '../daemon-common.js'
import type { Runner } from '../run-command.js'

/**
 * `theoclaw status` (B-399, OC-95): the instance, the configuration file, the model name and the
 * configured channels, then the service state. Names only: no value of a credential. Exit 0
 * when the service runs, 3 otherwise (as `daemon status`).
 */
export async function statusCommand(io: CliIo, runner: Runner): Promise<number> {
  const env: NodeJS.ProcessEnv = { ...io.env }
  const path = configurationPath(env, io.homeDir)
  const loaded = loadConfiguration(env, io.homeDir)
  const channels = resolvePlatforms(env).configured.map((entry) => entry.platform)
  io.stdout.write(`instance: ${resolveInstance(env, { homeDir: io.homeDir }).label}\n`)
  io.stdout.write(`config: ${path}${loaded === undefined ? ' (absent)' : ''}\n`)
  io.stdout.write(`model: ${env.THEOCLAW_MODEL?.trim() || 'not set'}\n`)
  io.stdout.write(`channels: ${channels.length === 0 ? 'none' : channels.join(', ')}\n`)
  return daemonStatus(io, runner)
}
