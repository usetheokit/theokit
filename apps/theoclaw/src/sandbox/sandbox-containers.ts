import { createInterface } from 'node:readline/promises'
import type { Writable } from 'node:stream'

import type { DockerRunner } from '@theokit/agents/sandbox'

import { UsageError } from '../cli-args.js'
import { describeError } from '../control-plane/errors.js'
import type { OnboardInput } from '../onboard.js'
import { dockerProcess, readSandboxBackend, SANDBOX_LABEL, SESSION_LABEL } from './sandbox-backend.js'

/** What `theoclaw sandbox` needs of the CLI. */
export interface SandboxCommandIo {
  readonly env: NodeJS.ProcessEnv
  readonly stdin: OnboardInput
  readonly stdout: Writable
  readonly stderr: Writable
  readonly isTTY: boolean
}

export interface SandboxCommandDeps {
  readonly dockerRunner?: DockerRunner
}

export interface SandboxContainer {
  readonly name: string
  readonly status: string
  readonly image: string
  readonly session: string
}

type Parsed = { verb: 'list' } | { verb: 'recreate'; session: string | undefined; force: boolean }

const USAGE = 'theoclaw sandbox: expected list | recreate [--all | --session <id>] [--force]'

export function parseSandboxArgs(args: readonly string[]): Parsed {
  const [verb, ...rest] = args
  if (verb === 'list' && rest.length === 0) return { verb: 'list' }
  if (verb !== 'recreate') throw new UsageError(USAGE)
  let all = false
  let force = false
  let session: string | undefined
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]
    if (arg === '--all') all = true
    else if (arg === '--force') force = true
    else if (arg === '--session') {
      const value = rest[++i]
      if (value === undefined || value === '' || value.startsWith('-')) throw new UsageError(USAGE)
      session = value
    } else throw new UsageError(USAGE)
  }
  if (all === (session !== undefined)) throw new UsageError('theoclaw sandbox recreate: give exactly one of --all or --session <id>')
  return { verb: 'recreate', session, force }
}

const DOCKER_OPTS = { timeoutMs: 30_000, maxOutputBytes: 1024 * 1024 } as const

async function docker(runner: DockerRunner, args: readonly string[]): Promise<string> {
  const result = await runner(args, DOCKER_OPTS)
  if (result.timedOut || result.code !== 0) throw new Error(`docker ${args[0] ?? ''} failed: ${result.stderr.trim() || 'no output'}`)
  return result.stdout
}

/** The containers theoclaw made (those with its label), newest first as docker prints them. */
export async function listSandboxContainers(runner: DockerRunner): Promise<SandboxContainer[]> {
  const format = `{{.Names}}\t{{.State}}\t{{.Image}}\t{{.Label "${SESSION_LABEL}"}}`
  const out = await docker(runner, ['ps', '-a', '--filter', `label=${SANDBOX_LABEL}=1`, '--format', format])
  return out
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => {
      const [name = '', status = '', image = '', session = ''] = line.split('\t')
      return { name, status, image, session }
    })
}

async function confirm(io: SandboxCommandIo, running: number): Promise<boolean> {
  if (!io.isTTY) return false
  const rl = createInterface({ input: io.stdin, output: io.stdout, terminal: false })
  try {
    const answer = await rl.question(`${running} sandbox container(s) are running. Remove them? [y/N] `)
    return /^y(es)?$/i.test(answer.trim())
  } finally {
    rl.close()
  }
}

export async function sandboxCommand(args: readonly string[], io: SandboxCommandIo, deps: SandboxCommandDeps = {}): Promise<number> {
  const parsed = parseSandboxArgs(args)
  if (readSandboxBackend(io.env) !== 'docker') {
    io.stdout.write('theoclaw sandbox: the bwrap backend keeps no containers; there is nothing to manage\n')
    return 0
  }
  const runner = deps.dockerRunner ?? dockerProcess
  try {
    const all = await listSandboxContainers(runner)
    if (parsed.verb === 'list') {
      for (const c of all) io.stdout.write(`${c.name}  Status: ${c.status}  Image: ${c.image}  Session: ${c.session}\n`)
      const running = all.filter((c) => c.status === 'running').length
      io.stdout.write(`Total: ${all.length} (${running} running)\n`)
      return 0
    }
    const chosen = parsed.session === undefined ? all : all.filter((c) => c.session === parsed.session)
    const running = chosen.filter((c) => c.status === 'running').length
    if (running > 0 && !parsed.force && !(await confirm(io, running))) {
      io.stderr.write('theoclaw sandbox: not removed; a container is running (use --force)\n')
      return 1
    }
    if (chosen.length > 0) await docker(runner, ['rm', '-f', ...chosen.map((c) => c.name)])
    io.stdout.write(`Removed: ${chosen.length}\n`)
    return 0
  } catch (error) {
    io.stderr.write(`theoclaw sandbox: ${describeError(error)}\n`)
    return 1
  }
}
