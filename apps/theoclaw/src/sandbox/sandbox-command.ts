import { createInterface } from 'node:readline'

import type { DockerRunner } from '@theokit/agents/sandbox'

import { UsageError } from '../cli-args.js'
import type { CliIo } from '../cli.js'
import { readSandboxBackend, dockerProcess } from './sandbox-backend.js'
import { formatSandboxes, listSandboxes, parseRecreate, recreateSandboxes } from './sandbox-containers.js'
import type { SandboxContainer } from './sandbox-containers.js'

/** What a test injects: the `docker` process and the answer to the question. */
export interface SandboxCommandDeps {
  readonly dockerRunner?: DockerRunner
  readonly confirm?: (running: readonly SandboxContainer[]) => Promise<boolean>
}

const USAGE = 'theoclaw sandbox: expected list | recreate [--all | --session <id>] [--force]'

async function askYes(io: CliIo, running: readonly SandboxContainer[]): Promise<boolean> {
  if (!io.isTTY) return false
  io.stdout.write(`${running.length} sandbox container(s) running: ${running.map((c) => c.name).join(', ')}\n`)
  const rl = createInterface({ input: io.stdin, output: io.stdout })
  try {
    const answer = await new Promise<string>((resolve) => rl.question('Remove them anyway? [y/N] ', resolve))
    return /^y(es)?$/i.test(answer.trim())
  } finally {
    rl.close()
  }
}

/** `theoclaw sandbox list | recreate`: manages the docker backend's containers; nothing to manage with bwrap. */
export async function sandboxCommand(args: readonly string[], io: CliIo, deps: SandboxCommandDeps = {}): Promise<number> {
  const [verb, ...rest] = args
  if (verb !== 'list' && verb !== 'recreate') throw new UsageError(USAGE)
  const options = verb === 'recreate' ? parseRecreate(rest) : null
  if (verb === 'list' ? rest.length > 0 : options === null) throw new UsageError(USAGE)
  if (readSandboxBackend(io.env) !== 'docker') {
    io.stdout.write('THEOCLAW_SANDBOX_BACKEND is bwrap: there are no sandbox containers to manage\n')
    return 0
  }
  const runner = deps.dockerRunner ?? dockerProcess
  try {
    if (options === null) {
      io.stdout.write(formatSandboxes(await listSandboxes(runner)))
      return 0
    }
    const confirm = deps.confirm ?? ((running) => askYes(io, running))
    const { removed, kept } = await recreateSandboxes(runner, options, confirm)
    for (const c of removed) io.stdout.write(`removed ${c.name}\n`)
    for (const c of kept) io.stderr.write(`kept ${c.name} (running; use --force)\n`)
    if (removed.length === 0 && kept.length === 0) io.stdout.write('no sandbox containers matched\n')
    return kept.length > 0 ? 1 : 0
  } catch (error) {
    io.stderr.write(`theoclaw sandbox: ${error instanceof Error ? error.message : String(error)}\n`)
    return 1
  }
}
