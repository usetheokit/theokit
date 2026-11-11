import { randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { Writable } from 'node:stream'
import { isSea } from 'node:sea'

import { UsageError } from '../cli-args.js'
import { loadConfiguration } from '../config-file.js'
import { chatSessions, readMessages } from './sessions-command.js'

/**
 * `theoclaw attach` and `theoclaw resume` (OC-135). `attach` writes a temporary `.mcp.json` whose
 * one server is `theoclaw mcp`, bound to a session and an expiry (one hour), and launches Claude
 * Code with `--strict-mcp-config --mcp-config <file>`; `--print-config` prints the config and
 * leaves the file. `resume` prints the newest chat session's messages, then opens the TUI on it.
 */

export const ATTACH_TTL_MS = 60 * 60 * 1000

export interface AttachIo {
  readonly env: NodeJS.ProcessEnv
  readonly homeDir: string
  readonly entry: string
  readonly stdout: Writable
  readonly stderr: Writable
}

export interface AttachGrant {
  readonly sessionKey: string
  readonly expiresAt: string
  readonly dir: string
  readonly configPath: string
  readonly launch: readonly string[]
}

export function mintGrant(io: AttachIo, session: string | undefined, now = Date.now()): AttachGrant {
  const env: NodeJS.ProcessEnv = { ...io.env }
  loadConfiguration(env, io.homeDir)
  const sessionKey = session ?? chatSessions(env, io.homeDir)[0]?.id ?? 'main'
  const expiresAt = new Date(now + ATTACH_TTL_MS).toISOString()
  const dir = mkdtempSync(join(tmpdir(), 'theoclaw-attach-'))
  const configPath = join(dir, '.mcp.json')
  const cliArgs = isSea() ? ['mcp'] : [join(dirname(io.entry), 'cli.js'), 'mcp']
  const config = {
    mcpServers: {
      theoclaw: {
        command: process.execPath,
        args: cliArgs,
        env: {
          THEOCLAW_ATTACH_SESSION: sessionKey,
          THEOCLAW_ATTACH_EXPIRES_AT: expiresAt,
          THEOCLAW_ATTACH_GRANT: randomBytes(16).toString('hex'),
        },
      },
    },
  }
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 })
  chmodSync(dir, 0o700)
  return { sessionKey, expiresAt, dir, configPath, launch: ['claude', '--strict-mcp-config', '--mcp-config', configPath] }
}

/** Throws when the attach grant in `env` has expired; no grant means a plain `theoclaw mcp`. */
export function assertGrantLive(env: NodeJS.ProcessEnv, now = Date.now()): void {
  const raw = env.THEOCLAW_ATTACH_EXPIRES_AT
  if (raw === undefined || raw === '') return
  const at = Date.parse(raw)
  if (Number.isNaN(at) || at <= now) throw new Error('the theoclaw attach grant has expired; run theoclaw attach again')
}

export function attachCommand(args: readonly string[], io: AttachIo): Promise<number> {
  const print = args.includes('--print-config')
  const rest = args.filter((arg) => arg !== '--print-config')
  const [flag, id, ...extra] = rest
  if (rest.length > 0 && (flag !== '--session' || id === undefined || id.startsWith('-') || extra.length > 0)) {
    throw new UsageError('theoclaw attach: expected [--session <id>] [--print-config]')
  }
  const grant = mintGrant(io, id)
  if (print) {
    io.stdout.write(`${JSON.stringify({ sessionKey: grant.sessionKey, expiresAt: grant.expiresAt, configPath: grant.configPath, launch: grant.launch })}\n`)
    return Promise.resolve(0)
  }
  const [command, ...commandArgs] = grant.launch
  const child = spawn(command!, commandArgs, { stdio: 'inherit', env: io.env })
  return new Promise<number>((resolve) => {
    const done = (code: number): void => {
      rmSync(grant.dir, { recursive: true, force: true })
      resolve(code)
    }
    child.once('error', (error) => {
      io.stderr.write(`theoclaw: cannot start claude: ${error.message}\n`)
      done(1)
    })
    child.once('exit', (code) => done(code ?? 1))
  })
}

/** `theoclaw resume`: prints the newest session and returns its id, or undefined when none exists. */
export function resumeSession(args: readonly string[], io: AttachIo): string | undefined {
  if (args.length > 0) throw new UsageError('theoclaw resume: expected no arguments')
  const env: NodeJS.ProcessEnv = { ...io.env }
  loadConfiguration(env, io.homeDir)
  const latest = chatSessions(env, io.homeDir)[0]
  if (latest === undefined) {
    io.stderr.write('theoclaw: no session to resume\n')
    return undefined
  }
  io.stdout.write(`session: ${latest.id}\n`)
  for (const message of readMessages(latest.transcript)) io.stdout.write(`${message.role}: ${message.text}\n`)
  return latest.id
}
