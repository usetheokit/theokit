import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

import { replaceFileAtomic } from '@theokit/sdk/persistence'

import { ServiceCommandError } from './errors.js'
import { runCommand, type Runner } from './runner.js'
import {
  assertLabel,
  validateSpec,
  type ServiceBackend,
  type ServiceBackendOptions,
  type ServiceSpec,
  type ServiceState,
} from './spec.js'

/** `%` starts a specifier in every directive, so it is doubled everywhere. */
function specifiers(value: string): string {
  return value.replaceAll('%', '%%')
}

/**
 * systemd.syntax(7): a value with whitespace, a quote or a backslash is double-quoted, and `%` is
 * doubled. `$` is doubled only in ExecStart=, the directive here that expands variables.
 */
function quoted(value: string, variables: boolean): string {
  // An empty word would vanish from the line, and systemd would drop the argument.
  if (value === '') return '""'
  const escaped = variables ? specifiers(value).replaceAll('$', '$$$$') : specifiers(value)
  return /[\s"\\]/.test(escaped)
    ? `"${escaped.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`
    : escaped
}

/** The text of a `systemd --user` service unit. Throws ServiceDefinitionError for a value it cannot hold. */
export function systemdUnit(spec: ServiceSpec): string {
  validateSpec(spec)
  const exec = [spec.command, ...(spec.args ?? [])].map((part) => quoted(part, true)).join(' ')
  return [
    '[Unit]',
    `Description=${specifiers(spec.description ?? spec.label)}`,
    '',
    '[Service]',
    'Type=simple',
    `ExecStart=${exec}`,
    ...Object.entries(spec.env ?? {}).map(
      ([name, value]) => 'Environment=' + quoted(name + '=' + value, false),
    ),
    // WorkingDirectory= takes the rest of the line as the path and removes no quotes.
    `WorkingDirectory=${specifiers(spec.workingDirectory)}`,
    'Restart=on-failure',
    '',
    '[Install]',
    'WantedBy=default.target',
    '',
  ].join('\n')
}

export function createSystemdBackend(options: ServiceBackendOptions = {}): ServiceBackend {
  const runner: Runner = options.runner ?? runCommand
  const home = options.homeDir ?? homedir()

  // The user manager reads ~/.config/systemd/user, whatever XDG_CONFIG_HOME says.
  const definitionPath = (spec: { readonly label: string }): string => {
    assertLabel(spec.label)
    return join(home, '.config', 'systemd', 'user', `${spec.label}.service`)
  }

  const systemctl = async (args: readonly string[]): Promise<void> => {
    const result = await runner('systemctl', ['--user', ...args])
    if (result.code !== 0) {
      throw new ServiceCommandError(
        `systemctl --user ${args.join(' ')}`,
        result.code,
        result.stderr.trim(),
      )
    }
  }

  return {
    platform: 'linux',
    definitionPath,

    async install(spec) {
      const text = systemdUnit(spec)
      const path = definitionPath(spec)
      const unit = `${spec.label}.service`
      mkdirSync(dirname(path), { recursive: true })
      const previous = existsSync(path) ? readFileSync(path, 'utf8') : undefined
      await replaceFileAtomic(path, text, { mode: 0o644 })
      try {
        // `enable --now` leaves a running unit as it is, so the restart moves it onto the new file.
        await systemctl(['daemon-reload'])
        await systemctl(['enable', '--now', '--', unit])
        await systemctl(['restart', '--', unit])
      } catch (error) {
        try {
          if (previous === undefined) rmSync(path, { force: true })
          else await replaceFileAtomic(path, previous, { mode: 0o644 })
          await runner('systemctl', ['--user', 'daemon-reload'])
        } catch (rollback) {
          if (error instanceof Error) {
            error.message += ` (restoring the previous unit also failed: ${rollback instanceof Error ? rollback.message : String(rollback)})`
          }
        }
        throw error
      }
    },

    async uninstall(label) {
      const path = definitionPath({ label })
      const unit = `${label}.service`
      const installed = existsSync(path)
      const disabled = await runner('systemctl', ['--user', 'disable', '--now', '--', unit])
      // A unit with no file has nothing to disable; with a file, a failure means it may still run.
      if (installed && disabled.code !== 0) {
        throw new ServiceCommandError(
          `systemctl --user disable --now -- ${unit}`,
          disabled.code,
          disabled.stderr.trim(),
        )
      }
      rmSync(path, { force: true })
      await systemctl(['daemon-reload'])
    },

    async status(label) {
      if (!existsSync(definitionPath({ label }))) return 'not-installed'
      const result = await runner('systemctl', ['--user', 'is-active', '--', `${label}.service`])
      const answer = result.stdout.trim()
      let state: ServiceState = 'unknown'
      if (answer === 'active') state = 'running'
      else if (answer === 'inactive' || answer === 'failed') state = 'stopped'
      return state
    },

    async restart(label) {
      assertLabel(label)
      await systemctl(['restart', '--', `${label}.service`])
    },
  }
}
