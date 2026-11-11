#!/usr/bin/env node
import './runtime.js'
import { spawn } from 'node:child_process'
import { readFileSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { Writable } from 'node:stream'
import { fileURLToPath } from 'node:url'

import { backupInstance, BackupRefusal, restoreInstance, uploadBackup, downloadBackup } from './backup/backup.js'
import { InstanceLockedError } from './backup/instance-lock.js'
import { describeError, TheoClawConfigError } from './control-plane/errors.js'
import { daemonInstall, type DaemonIo, daemonStatus, daemonUninstall } from './daemon.js'
import { runCommand, type Runner } from './run-command.js'
import { parseOnboard, parseUpdate, UsageError } from './cli-args.js'
import { type OnboardInput, onboard } from './onboard.js'
import { doctor } from './ops/doctor.js'
import { logsCommand } from './ops/logs.js'
import { statusCommand } from './ops/status.js'
import { loginWhatsApp } from './channels/whatsapp-qr.js'
import { readControlClientSettings } from './control-client/settings.js'
import { loadConfiguration } from './config-file.js'
import { whatsappSessionDir } from './channels/platforms.js'
import { securityCommand } from './security-audit.js'
import { update } from './update.js'
import { serveMcpStdio } from './mcp/serve-tools.js'

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

  theoclaw start [--config <path>] [--profile <name>]
                            run TheoClaw in the foreground with the configuration file
  theoclaw acp [--config <path>] [--profile <name>]
                            serve the /control agent over the Agent Client Protocol on stdio, for an editor such as Zed
  theoclaw onboard          write the configuration file, asking for each setting
      --yes --model <id> --api-key-env <NAME> --port <n> --owners <platform:id,...>
      [--workspace <absolute dir>] [--force]
  theoclaw daemon install   run TheoClaw as a login service, started now and at login:
                            a systemd user unit, a launchd agent or a Task Scheduler task
  theoclaw daemon uninstall stop and remove that service
  theoclaw daemon status    exit 0 when the service is running, 3 otherwise
  theoclaw update [--channel stable|dev]
                            fetch and fast-forward the checkout on its channel, rebuild, restart
  theoclaw security audit [--fix]
                            report risky configuration; --fix narrows file permissions; exit 3 while findings remain
  theoclaw doctor [--fix]   check the configuration offline (--fix: file modes, missing state directory); exit 3 on a failed check, never printing a value
  theoclaw status           the instance, its model and channels, and whether the service runs; exit 3 when it does not
  theoclaw logs [--lines <n>] [--file <path>]
                            the last log lines (file, launchd log or user journal), secrets masked
  theoclaw backup <dir>     copy state and workspace; --live snapshots SQLite while running; THEOCLAW_BACKUP_TARGET uploads offsite
  theoclaw restore <dir>    verify a backup and copy it into an empty instance
  theoclaw whatsapp login   link WhatsApp Web by QR (THEOCLAW_WHATSAPP_BACKEND=baileys; needs the baileys package installed); exit 1 if not linked
  theoclaw tui [--session <id>]
                            the terminal UI on the running instance, with the token and port from the configuration file
  theoclaw mcp              serve TheoClaw's tools as an MCP server on stdin/stdout (claude mcp add theoclaw -- theoclaw mcp)
  theoclaw import <claude-code|hermes> [--dry-run] [--source <dir>] [--project <dir>] [--home <dir>]
                            copy a Claude Code or Hermes setup into the state directory; --dry-run lists the files and writes none
  theoclaw --help           this text
  theoclaw --version        print the version
`

/**
 * The entry as a child in its own process group, so a terminal's SIGINT reaches only this process,
 * which forwards it once; the exit code is the child's, or 1 with the signal named.
 */
function startChild(args: readonly string[], io: CliIo, entry: string = io.entry, env: NodeJS.ProcessEnv = io.env): Promise<number> {
  const child = spawn(process.execPath, [entry, ...args], { stdio: 'inherit', detached: true, env })
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
      io.stderr.write(`theoclaw: cannot start ${entry}: ${describeError(error)}\n`)
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

/** The one directory argument of `backup` and `restore`. */
function directoryArgument(name: string, args: readonly string[]): string {
  const [dir, ...extra] = args
  if (dir === undefined || dir.startsWith('-') || extra.length > 0) throw new UsageError(`theoclaw ${name}: expected one directory`)
  return dir
}

/** `backup` and `restore` (B-400 FR-008, FR-009): exit 0, or 1 with the refusal on stderr. */
function backupCommand(name: 'backup' | 'restore'): Command {
  return async (args, io) => {
    const live = name === 'backup' && args.includes('--live')
    const dir = directoryArgument(name, live ? args.filter((arg) => arg !== '--live') : args)
    try {
      const target = io.env.THEOCLAW_BACKUP_TARGET
      if (name === 'restore' && target) await downloadBackup(dir, target, io.env.THEOCLAW_BACKUP_TOKEN)
      const run = name === 'backup' ? backupInstance : restoreInstance
      const { files } = run(io.env, dir, { homeDir: io.homeDir, live })
      if (name === 'backup' && target) await uploadBackup(dir, target, io.env.THEOCLAW_BACKUP_TOKEN)
      io.stdout.write(`theoclaw: ${name === 'backup' ? 'backed up' : 'restored'} ${files.length} files ${name === 'backup' ? 'to' : 'from'} ${dir}\n`)
      return 0
    } catch (error) {
      if (!(error instanceof BackupRefusal) && !(error instanceof InstanceLockedError)) throw error
      io.stderr.write(`theoclaw: ${error.message}\n`)
      return 1
    }
  }
}

/** `whatsapp login`: print the pairing QR and wait for the scan; the pairing is kept in the session directory. */
async function whatsappCommand(args: readonly string[], io: CliIo): Promise<number> {
  if (args.length !== 1 || args[0] !== 'login') throw new UsageError('theoclaw whatsapp: expected login')
  const env: NodeJS.ProcessEnv = { ...io.env }
  loadConfiguration(env, io.homeDir)
  const sessionDir = whatsappSessionDir(env)
  if (sessionDir === undefined) throw new TheoClawConfigError('whatsapp login needs THEOCLAW_WHATSAPP_SESSION_DIR or THEOCLAW_STATE_DIR')
  const linked = await loginWhatsApp(sessionDir, (text) => io.stdout.write(`${text}\n`))
  if (!linked) {
    io.stderr.write('theoclaw: WhatsApp was not linked (the QR was not scanned in time, or the connection failed)\n')
    return 1
  }
  io.stdout.write(`theoclaw: WhatsApp linked; set THEOCLAW_WHATSAPP_BACKEND=baileys and run theoclaw start\n`)
  return 0
}

/** `tui`: the terminal UI as a child; the token and port come from the configuration file unless the environment sets them. */
function tuiCommand(args: readonly string[], io: CliIo): Promise<number> {
  const [flag, id, ...extra] = args
  if (args.length > 0 && (flag !== '--session' || id === undefined || id.startsWith('-') || extra.length > 0)) {
    throw new UsageError('theoclaw tui: expected [--session <id>]')
  }
  const env: NodeJS.ProcessEnv = { ...io.env }
  if (id !== undefined) env.THEOCLAW_SESSION = id
  loadConfiguration(env, io.homeDir)
  readControlClientSettings(env) // a bad token, port or session id ends here with exit 1, before the child starts
  return startChild([], io, join(dirname(io.entry), 'tui', 'main.js'), env)
}

const COMMANDS: Readonly<Record<string, Command>> = {
  start: startChild,
  // The ACP server is its own leaf entry beside `main.js`: stdin and stdout are the protocol, so the child inherits them.
  acp: (args, io) => startChild(args, io, join(dirname(io.entry), 'main-acp.js')),
  onboard: async (args, io) => {
    await onboard(parseOnboard(args), io)
    return 0
  },
  daemon,
  update: (args, io) => update(parseUpdate(args), io, io.runner),
  security: securityCommand,
  doctor: (args, io) => {
    if (args.some((arg) => arg !== '--fix')) throw new UsageError('theoclaw doctor: expected [--fix]')
    return Promise.resolve(doctor(io, { fix: args.includes('--fix') }))
  },
  status: (_args, io) => statusCommand(io, io.runner),
  logs: (args, io) => logsCommand(args, io, io.runner),
  whatsapp: whatsappCommand,
  tui: tuiCommand,
  mcp: async (args, io) => {
    if (args.length > 0) throw new UsageError('theoclaw mcp: expected no arguments')
    await serveMcpStdio({ env: io.env, homeDir: io.homeDir, cwd: io.cwd, stdin: io.stdin as unknown as NodeJS.ReadableStream, stdout: io.stdout })
    return 0
  },
  import: (args, io) => {
    const [kind, ...rest] = args
    if (kind !== 'claude-code' && kind !== 'hermes') throw new UsageError('theoclaw import: expected claude-code or hermes')
    const env: NodeJS.ProcessEnv = { ...io.env }
    loadConfiguration(env, io.homeDir)
    return startChild(['--from', kind, ...rest], { ...io, env }, join(dirname(io.entry), 'import-main.js'))
  },
  backup: backupCommand('backup'),
  restore: backupCommand('restore'),
  '--version': (_args, io) => {
    const pkg = JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8')) as { version: string }
    io.stdout.write(`${pkg.version}\n`)
    return Promise.resolve(0)
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
    cwd: process.cwd(),
    platform: process.platform,
    nodePath: process.execPath,
    uid: process.getuid?.(),
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
