#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { Writable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

import { describeError, TheoClawConfigError } from './control-plane/errors.js'
import { type OnboardInput, type OnboardOptions, onboard } from './onboard.js'

/**
 * The `theoclaw` command (B-374, plan D2). A second leaf entry beside `src/main.ts`: it never
 * imports the entry or the composition root, so `start` runs the built entry as a child process,
 * which loads the configuration file itself.
 */

/** Where signals arrive: the real process, or a stand-in in the tests. */
export interface SignalSource {
  on(signal: 'SIGINT' | 'SIGTERM', listener: (signal: NodeJS.Signals) => void): unknown
  removeListener(signal: 'SIGINT' | 'SIGTERM', listener: (signal: NodeJS.Signals) => void): unknown
}

export interface CliIo {
  readonly env: NodeJS.ProcessEnv
  readonly homeDir: string
  readonly stdin: OnboardInput
  readonly stdout: Writable
  readonly stderr: Writable
  readonly isTTY: boolean
  /** The built process entry, `dist/main.js` beside this file. */
  readonly entry: string
  readonly signals: SignalSource
}

const USAGE = `usage: theoclaw <command>

  theoclaw start [args]     run TheoClaw in the foreground with the configuration file
  theoclaw onboard          write the configuration file, asking for each setting
      --yes --model <id> --api-key-env <NAME> --port <n> --owners <platform:id,...>
      [--workspace <absolute dir>] [--force]
  theoclaw --help           this text
`

/** Bad usage: the command line itself is wrong, which is exit 2 rather than a refusal. */
class UsageError extends Error {}

function parseOnboard(args: readonly string[]): OnboardOptions {
  let values
  try {
    ;({ values } = parseArgs({
      args: [...args],
      strict: true,
      allowPositionals: false,
      options: {
        yes: { type: 'boolean' },
        force: { type: 'boolean' },
        model: { type: 'string' },
        'api-key-env': { type: 'string' },
        port: { type: 'string' },
        owners: { type: 'string' },
        workspace: { type: 'string' },
      },
    }))
  } catch (error) {
    throw new UsageError(`theoclaw onboard: ${describeError(error)}`)
  }
  return {
    yes: values.yes === true,
    force: values.force === true,
    model: values.model,
    apiKeyEnv: values['api-key-env'],
    port: values.port,
    owners: values.owners,
    workspace: values.workspace,
  }
}

/**
 * The entry as a child in its own process group, so a terminal's SIGINT reaches only this process,
 * which forwards it once; the exit code is the child's, or 1 with the signal named.
 */
function startChild(args: readonly string[], io: CliIo): Promise<number> {
  const child = spawn(process.execPath, [io.entry, ...args], { stdio: 'inherit', detached: true, env: io.env })
  const forward = (signal: NodeJS.Signals): void => {
    child.kill(signal)
  }
  io.signals.on('SIGINT', forward)
  io.signals.on('SIGTERM', forward)
  return new Promise<number>((resolve) => {
    const settle = (code: number): void => {
      io.signals.removeListener('SIGINT', forward)
      io.signals.removeListener('SIGTERM', forward)
      resolve(code)
    }
    child.once('error', (error) => {
      io.stderr.write(`theoclaw: cannot start ${io.entry}: ${describeError(error)}\n`)
      settle(1)
    })
    child.once('exit', (code, signal) => {
      if (code !== null) return settle(code)
      io.stderr.write(`theoclaw: the entry stopped on ${signal ?? 'an unknown signal'}\n`)
      settle(1)
    })
  })
}

type Command = (args: readonly string[], io: CliIo) => Promise<number>

const COMMANDS: Readonly<Record<string, Command>> = {
  start: startChild,
  onboard: async (args, io) => {
    await onboard(parseOnboard(args), io)
    return 0
  },
  '--help': (_args, io) => {
    io.stdout.write(USAGE)
    return Promise.resolve(0)
  },
}

export async function runCli(argv: readonly string[], io: CliIo): Promise<number> {
  const [name, ...rest] = argv
  const command = name === undefined ? undefined : COMMANDS[name]
  if (command === undefined) {
    io.stderr.write(USAGE)
    return 2
  }
  try {
    return await command(rest, io)
  } catch (error) {
    if (error instanceof UsageError) {
      io.stderr.write(`${error.message}\n${USAGE}`)
      return 2
    }
    if (error instanceof TheoClawConfigError) {
      io.stderr.write(`theoclaw: ${error.message}\n`)
      return 1
    }
    throw error
  }
}

function isMain(): boolean {
  const script = process.argv[1]
  if (script === undefined) return false
  try {
    return realpathSync(script) === fileURLToPath(import.meta.url)
  } catch {
    return false
  }
}

if (isMain()) {
  const io: CliIo = {
    env: process.env,
    homeDir: homedir(),
    stdin: process.stdin,
    stdout: process.stdout,
    stderr: process.stderr,
    isTTY: process.stdin.isTTY === true && process.stdout.isTTY === true,
    entry: join(dirname(fileURLToPath(import.meta.url)), 'main.js'),
    signals: process,
  }
  runCli(process.argv.slice(2), io).then(
    (code) => process.exit(code),
    (error: unknown) => {
      process.stderr.write(`theoclaw: ${describeError(error)}\n`)
      process.exit(1)
    },
  )
}
