import { createInterface } from 'node:readline/promises'
import type { Readable, Writable } from 'node:stream'

import type { DockerRunner } from '@theokit/agents/sandbox'

import { UsageError } from '../cli-args.js'
import { describeError } from '../control-plane/errors.js'
import { dockerProcess, readSandboxBackend } from './sandbox-backend.js'
import { listSandboxContainers, recreateSandboxContainers } from './sandbox-containers.js'

const USAGE = 'theoclaw sandbox: expected list | recreate (--all | --session <id>) [--force]'

export type SandboxAction = { readonly verb: 'list' } | { readonly verb: 'recreate'; readonly session?: string; readonly force: boolean }

export function parseSandbox(args: readonly string[]): SandboxAction {
  const [verb, ...rest] = args
  if (verb === 'list' && rest.length === 0) return { verb }
  if (verb !== 'recreate') throw new UsageError(USAGE)
  let all = false
  let force = false
  let session: string | undefined
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]
    if (arg === '--all') all = true
    else if (arg === '--force') force = true
    else if (arg === '--session') {
      const id = rest[++i]
      if (id === undefined || id === '' || id.startsWith('-')) throw new UsageError(USAGE)
      session = id
    } else throw new UsageError(USAGE)
  }
  if (all === (session !== undefined)) throw new UsageError(USAGE)
  return session === undefined ? { verb, force } : { verb, session, force }
}

export interface SandboxIo {
  readonly env: NodeJS.ProcessEnv
  readonly stdin: Readable
  readonly stdout: Writable
  readonly stderr: Writable
  readonly isTTY: boolean
  /** Test seam: the `docker` process. */
  readonly docker?: DockerRunner
}

/** `sandbox list` and `sandbox recreate`: exit 0, or 1 with the reason on stderr. */
export async function sandboxCommand(args: readonly string[], io: SandboxIo): Promise<number> {
  const action = parseSandbox(args)
  if (readSandboxBackend(io.env) !== 'docker') {
    io.stdout.write('theoclaw sandbox: THEOCLAW_SANDBOX_BACKEND is bwrap; there are no containers to manage\n')
    return 0
  }
  const runner = io.docker ?? dockerProcess
  try {
    if (action.verb === 'list') {
      const containers = await listSandboxContainers(runner)
      for (const c of containers) {
        io.stdout.write(`${c.name}  Status: ${c.status}  Image: ${c.image}  Backend: docker  Session: ${c.session}\n`)
      }
      const running = containers.filter((c) => c.status === 'running').length
      io.stdout.write(`Total: ${containers.length} (${running} running)\n`)
      return 0
    }
    const result = await recreateSandboxContainers(runner, {
      ...(action.session === undefined ? {} : { session: action.session }),
      force: action.force,
      confirm: async (running) => {
        if (!io.isTTY) {
          io.stderr.write(`theoclaw sandbox: ${running.length} running container(s); pass --force to remove them without asking\n`)
          return false
        }
        const rl = createInterface({ input: io.stdin, output: io.stdout })
        try {
          const answer = await rl.question(`Remove ${running.length} running container(s) (${running.map((c) => c.name).join(', ')})? [y/N] `)
          return /^y(es)?$/i.test(answer.trim())
        } finally {
          rl.close()
        }
      },
    })
    for (const c of result.removed) io.stdout.write(`removed ${c.name}\n`)
    if (result.declined) return 1
    if (result.removed.length === 0) io.stdout.write('theoclaw sandbox: no matching containers\n')
    return 0
  } catch (error) {
    io.stderr.write(`theoclaw sandbox: ${describeError(error)}\n`)
    return 1
  }
}
