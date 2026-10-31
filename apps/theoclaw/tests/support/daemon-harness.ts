import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'

import { afterEach } from 'vitest'

import type { DaemonIo } from '../../src/daemon.js'
import type { Runner } from '../../src/run-command.js'

const scratch: string[] = []

afterEach(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true })
})

export interface Call {
  readonly command: string
  readonly args: readonly string[]
}

export interface Harness {
  readonly io: DaemonIo
  readonly home: string
  readonly calls: Call[]
  readonly runner: Runner
  readonly stdout: () => string
  readonly stderr: () => string
}

export type Answer = { code?: number; stdout?: string; stderr?: string }

/**
 * A scratch home with a built entry and an onboarded configuration file, and a runner that records
 * every command and answers from `answers` by the command's first two words.
 */
export function harness(options: { env?: NodeJS.ProcessEnv; platform?: NodeJS.Platform; uid?: number; answers?: Record<string, Answer[]>; configure?: boolean; workspace?: boolean } = {}): Harness {
  const home = mkdtempSync(join(tmpdir(), 'theoclaw-daemon-'))
  scratch.push(home)
  const entry = join(home, 'checkout', 'dist', 'main.js')
  mkdirSync(join(home, 'checkout', 'dist'), { recursive: true })
  writeFileSync(entry, '')
  const workspace = join(home, 'work')
  mkdirSync(workspace)
  const env: NodeJS.ProcessEnv = { XDG_CONFIG_HOME: join(home, 'config'), USER: 'someone', ...options.env }
  if (options.configure !== false) {
    const name = env.THEOCLAW_PROFILE === undefined ? 'theoclaw.env' : `theoclaw-${env.THEOCLAW_PROFILE}.env`
    mkdirSync(join(home, 'config', 'theoclaw'), { recursive: true })
    writeFileSync(join(home, 'config', 'theoclaw', name), options.workspace === false ? 'THEOCLAW_PORT="8787"\n' : `THEOCLAW_WORKSPACE="${workspace}"\n`)
  }
  const calls: Call[] = []
  const answers = options.answers ?? {}
  const runner: Runner = (command, args) => {
    calls.push({ command, args })
    const key = [command, ...args.filter((arg) => arg !== '--user')].slice(0, 2).join(' ')
    const queue = answers[key]
    const answer = queue?.shift() ?? {}
    return Promise.resolve({ code: answer.code ?? 0, stdout: answer.stdout ?? '', stderr: answer.stderr ?? '' })
  }
  let out = ''
  let err = ''
  const stdout = new PassThrough()
  const stderr = new PassThrough()
  stdout.on('data', (chunk: Buffer) => (out += chunk.toString()))
  stderr.on('data', (chunk: Buffer) => (err += chunk.toString()))
  const io: DaemonIo = { env, homeDir: home, cwd: home, platform: options.platform ?? 'linux', ...(options.uid === undefined ? {} : { uid: options.uid }), nodePath: '/usr/bin/node', entry, stdout, stderr }
  return { io, home, calls, runner, stdout: () => out, stderr: () => err }
}

export function unitEnvironment(unit: string): Record<string, string> {
  const pairs = [...unit.matchAll(/^Environment=(?:"([^"]*)"|(\S+))$/gm)].map((match) => (match[1] ?? match[2])!)
  return Object.fromEntries(pairs.map((pair) => [pair.slice(0, pair.indexOf('=')), pair.slice(pair.indexOf('=') + 1)]))
}

export function systemctl(h: Harness): string[] {
  return h.calls.filter((call) => call.command === 'systemctl').map((call) => call.args.join(' '))
}
