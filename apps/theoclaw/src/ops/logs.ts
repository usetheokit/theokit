import { existsSync, readFileSync } from 'node:fs'
import type { Writable } from 'node:stream'

import { redactSecrets } from '@theokit/gateway'

import { maskSecrets } from '../channels/channel-loop.js'
import { loadConfiguration } from '../config-file.js'
import { UsageError } from '../cli-args.js'
import { logPath } from '../daemon-launchd.js'
import { resolveInstance } from '../instance.js'
import type { Runner } from '../run-command.js'

/**
 * `theoclaw logs [--lines <n>] [--file <path>]` (B-399, OC-96): the last lines of the service's
 * log, from `--file` or `THEOCLAW_LOG_FILE`, the launchd log on macOS, else the user journal of
 * the systemd unit. Every line passes the secret mask first: the configured credential values,
 * then the gateway's pattern redaction.
 */

export interface LogsIo {
  readonly env: NodeJS.ProcessEnv
  readonly homeDir: string
  readonly platform: NodeJS.Platform
  readonly stdout: Writable
  readonly stderr: Writable
}

const SECRET_NAME = /(KEY|TOKEN|SECRET|PASSWORD)/

export function configuredSecrets(env: NodeJS.ProcessEnv): string[] {
  return Object.entries(env)
    .filter(([name, value]) => SECRET_NAME.test(name) && (value ?? '').trim().length >= 4)
    .map(([, value]) => value!.trim())
}

export function redactLog(text: string, secrets: readonly string[]): string {
  return redactSecrets(maskSecrets(text, secrets))
}

function parseLogs(args: readonly string[]): { lines: number; file: string | undefined } {
  let lines = 100
  let file: string | undefined
  for (let i = 0; i < args.length; i += 2) {
    const value = args[i + 1]
    if (args[i] === '--lines' && value !== undefined && /^[1-9]\d{0,5}$/.test(value)) lines = Number(value)
    else if (args[i] === '--file' && value !== undefined && !value.startsWith('-')) file = value
    else throw new UsageError('theoclaw logs: expected [--lines <n>] [--file <path>]')
  }
  return { lines, file }
}

export async function logsCommand(args: readonly string[], io: LogsIo, runner: Runner): Promise<number> {
  const { lines, file } = parseLogs(args)
  const env: NodeJS.ProcessEnv = { ...io.env }
  loadConfiguration(env, io.homeDir)
  const secrets = configuredSecrets(env)
  const label = resolveInstance(env, { homeDir: io.homeDir }).label
  const explicit = file ?? env.THEOCLAW_LOG_FILE
  const source = explicit ?? (io.platform === 'darwin' ? logPath(label, io.homeDir) : undefined)
  let text: string
  if (source !== undefined) {
    if (!existsSync(source)) {
      io.stderr.write(`theoclaw logs: ${source} does not exist\n`)
      return 1
    }
    text = readFileSync(source, 'utf8').split('\n').slice(-lines - 1).join('\n')
  } else {
    const answer = await runner('journalctl', ['--user', '-u', `${label}.service`, '-n', String(lines), '--no-pager', '-o', 'cat'])
    if (answer.code !== 0) {
      io.stderr.write(`theoclaw logs: the journal cannot be read (exit ${answer.code}); pass --file or set THEOCLAW_LOG_FILE\n`)
      return 1
    }
    text = answer.stdout
  }
  io.stdout.write(redactLog(text.endsWith('\n') || text === '' ? text : `${text}\n`, secrets))
  return 0
}
