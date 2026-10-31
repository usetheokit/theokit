#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { Writable } from 'node:stream'
import { fileURLToPath } from 'node:url'

import { describeError, TheoClawConfigError } from './control-plane/errors.js'
import { daemonInstall, type DaemonIo, daemonStatus, daemonUninstall, runCommand, type Runner } from './daemon.js'
import { parseOnboard, parseUpdate, UsageError } from './cli-args.js'
import { type OnboardInput, onboard } from './onboard.js'
import { update } from './update.js'

/**
 * The `theoclaw` command (B-374, plan D2). A second leaf entry beside `src/main.ts`: it never
 * imports the entry or the composition root, so `start` runs the built entry as a child process,
 * which loads the configuration file itself.
 */

/** SIGHUP too: the entry has its own session, so a closed terminal would otherwise orphan it. */
const FORWARDED = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const
type ForwardedSignal = (typeof FORWARDED)[number]

/** Where signals arrive: the real process, or a stand-in in the tests. */
export interface SignalSource {
  on(signal: ForwardedSignal, listener: (signal: NodeJS.Signals) => void): unknown
  removeListener(signal: ForwardedSignal, listener: (signal: NodeJS.Signals) => void): unknown
}

export interface CliIo extends DaemonIo {
  readonly stdin: OnboardInput
  readonly stdout: Writable
  readonly stderr: Writable
  readonly isTTY: boolean
  readonly signals: SignalSource
  /** Runs `systemctl`, `loginctl` and `git` for `daemon` and `update`. */
  readonly runner: Runner
}

const USAGE = `usage: theoclaw <command>

  theoclaw start [args]     run TheoClaw in the foreground with the configuration file
  theoclaw onboard          write the configuration file, asking for each setting
      --yes --model <id> --api-key-env <NAME> --port <n> --owners <platform:id,...>
      [--workspace <absolute dir>] [--force]
  theoclaw daemon install   run TheoClaw as a systemd user unit, started now and at login
  theoclaw daemon uninstall stop and remove that unit
  theoclaw daemon status    exit 0 when the unit is active, 3 otherwise
  theoclaw update [--channel stable|dev]
                            fetch and fast-forward the checkout on its channel, rebuild, restart
  theoclaw --help           this text
`

/**
 * The entry as a child in its own process group, so a terminal's SIGINT reaches only this process,
 * which forwards it once; the exit code is the child's, or 1 with the signal named.
 */
function startChild(args: readonly string[], io: CliIo): Promise<number> {
  const child = spawn(process.execPath, [io.entry, ...args], { stdio: 'inherit', detached: true, env: io.env })
  const forward = (signal: NodeJS.Signals): void => {
    child.kill(signal)
  }
  for (const signal of FORWARDED) io.signals.on(signal, forward)
  return new Promise<number>((resolve) => {
    const settle = (code: number): void => {
      for (const signal of FORWARDED) io.signals.removeListener(signal, forward)
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

const DAEMON_VERBS: Readonly<Record<string, (io: CliIo, runner: Runner) => Promise<number>>> = {
  install: daemonInstall,
  uninstall: daemonUninstall,
  status: daemonStatus,
}

function daemon(args: readonly string[], io: CliIo): Promise<number> {
  const [verb, ...extra] = args
  const run = verb === undefined ? undefined : DAEMON_VERBS[verb]
  if (run === undefined || extra.length > 0) throw new UsageError('theoclaw daemon: expected install, uninstall or status')
  return run(io, io.runner)
}

const COMMANDS: Readonly<Record<string, Command>> = {
  start: startChild,
  onboard: async (args, io) => {
    await onboard(parseOnboard(args), io)
    return 0
  },
  daemon,
  update: (args, io) => update(parseUpdate(args), io, io.runner),
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
    cwd: process.cwd(),
    platform: process.platform,
    nodePath: process.execPath,
    runner: runCommand,
  }
  runCli(process.argv.slice(2), io).then(
    (code) => process.exit(code),
    (error: unknown) => {
      process.stderr.write(`theoclaw: ${describeError(error)}\n`)
      process.exit(1)
    },
  )
}
