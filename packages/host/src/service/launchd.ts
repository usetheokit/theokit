import { mkdirSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

import { replaceFileAtomic } from '@theokit/sdk/persistence'

import { ServiceCommandError, ServiceDefinitionError } from './errors.js'
import { logLines, tailFile, type LogsOptions } from './logs.js'
import { runCommand, type Runner } from './runner.js'
import {
  assertLabel,
  validateSpec,
  type ServiceBackend,
  type ServiceBackendOptions,
  type ServiceSpec,
  type ServiceState,
} from './spec.js'
import { escapeXml } from './xml-escape.js'

const str = (value: string): string => `<string>${escapeXml(value)}</string>`

/**
 * The text of a LaunchAgent plist. KeepAlive restarts the job only after a non-zero exit, so
 * `restartSelf` (exit code 75) is restarted while a clean stop stays stopped. Every value is
 * XML-escaped; the label is escaped rather than refused, the backend checks it before it writes.
 */
export function launchdPlist(spec: ServiceSpec, options: { logFile: string }): string {
  validateSpec({ ...spec, label: 'x' })
  const env = Object.entries(spec.env ?? {})
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    '<dict>',
    '  <key>Label</key>',
    `  ${str(spec.label)}`,
    '  <key>ProgramArguments</key>',
    '  <array>',
    ...[spec.command, ...(spec.args ?? [])].map((part) => `    ${str(part)}`),
    '  </array>',
    ...(env.length === 0
      ? []
      : [
          '  <key>EnvironmentVariables</key>',
          '  <dict>',
          ...env.flatMap(([name, value]) => [
            `    <key>${escapeXml(name)}</key>`,
            `    ${str(value)}`,
          ]),
          '  </dict>',
        ]),
    '  <key>WorkingDirectory</key>',
    `  ${str(spec.workingDirectory)}`,
    '  <key>RunAtLoad</key>',
    '  <true/>',
    '  <key>KeepAlive</key>',
    '  <dict>',
    '    <key>SuccessfulExit</key>',
    '    <false/>',
    '  </dict>',
    '  <key>StandardOutPath</key>',
    `  ${str(options.logFile)}`,
    '  <key>StandardErrorPath</key>',
    `  ${str(options.logFile)}`,
    '</dict>',
    '</plist>',
    '',
  ].join('\n')
}

export function createLaunchdBackend(options: ServiceBackendOptions = {}): ServiceBackend {
  const runner: Runner = options.runner ?? runCommand
  const home = options.homeDir ?? homedir()

  const definitionPath = (spec: { readonly label: string }): string => {
    assertLabel(spec.label)
    return join(home, 'Library', 'LaunchAgents', `${spec.label}.plist`)
  }

  const domain = (): string => {
    if (options.uid === undefined)
      throw new ServiceDefinitionError('uid', 'launchd needs the user id')
    return `gui/${options.uid}`
  }

  const launchctl = async (args: readonly string[]): Promise<void> => {
    const result = await runner('launchctl', args)
    if (result.code !== 0) {
      throw new ServiceCommandError(`launchctl ${args[0]}`, result.code, result.stderr.trim())
    }
  }

  return {
    platform: 'darwin',
    definitionPath,

    async install(spec) {
      const target = domain()
      assertLabel(spec.label)
      const logFile = options.logFile ?? join(home, 'Library', 'Logs', `${spec.label}.log`)
      const text = launchdPlist(spec, { logFile })
      const path = definitionPath(spec)
      mkdirSync(dirname(path), { recursive: true })
      mkdirSync(dirname(logFile), { recursive: true })
      // The plist holds ServiceSpec.env, so it stays private.
      await replaceFileAtomic(path, text)
      // A service that is not loaded makes bootout fail; that is not an error.
      await runner('launchctl', ['bootout', `${target}/${spec.label}`])
      try {
        await launchctl(['bootstrap', target, path])
      } catch (error) {
        rmSync(path, { force: true })
        throw error
      }
    },

    async uninstall(label) {
      const target = domain()
      const path = definitionPath({ label })
      const out = await runner('launchctl', ['bootout', `${target}/${label}`])
      if (out.code !== 0) {
        // Keep the plist unless launchd confirms the service is not loaded.
        const print = await runner('launchctl', ['print', `${target}/${label}`])
        const absent =
          print.code === 113 || /could not find service/i.test(print.stderr + print.stdout)
        if (!absent) throw new ServiceCommandError('launchctl bootout', out.code, out.stderr.trim())
      }
      rmSync(path, { force: true })
    },

    async status(label) {
      const target = domain()
      assertLabel(label)
      const result = await runner('launchctl', ['print', `${target}/${label}`])
      if (result.code !== 0) return 'not-installed'
      const state: ServiceState = /\bstate = running\b/.test(result.stdout) ? 'running' : 'stopped'
      return state
    },

    async logs(label, logOptions?: LogsOptions) {
      assertLabel(label)
      const lines = logLines(logOptions)
      return await tailFile(options.logFile ?? join(home, 'Library', 'Logs', `${label}.log`), lines)
    },

    async restart(label) {
      assertLabel(label)
      await launchctl(['kickstart', '-k', `${domain()}/${label}`])
    },
  }
}
