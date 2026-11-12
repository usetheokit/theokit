import type { DockerRunner } from '@theokit/agents/sandbox'

import { SANDBOX_LABEL, SESSION_LABEL } from './sandbox-backend.js'

/** One sandbox container theoclaw made. */
export interface SandboxContainer {
  readonly id: string
  readonly name: string
  readonly status: string
  readonly image: string
  readonly session: string
}

const LIMITS = { timeoutMs: 30_000, maxOutputBytes: 1 << 20 }

async function docker(runner: DockerRunner, args: readonly string[]): Promise<string> {
  const result = await runner(args, LIMITS)
  if (result.timedOut || result.code !== 0) {
    throw new Error(`docker ${args[0] ?? ''} failed${result.timedOut ? ' (timed out)' : ''}: ${result.stderr.trim() || `exit ${String(result.code)}`}`)
  }
  return result.stdout
}

/** The containers carrying theoclaw's label, running or not; containers without it are never returned. */
export async function listSandboxContainers(runner: DockerRunner): Promise<SandboxContainer[]> {
  const format = `{{.ID}}\t{{.Names}}\t{{.State}}\t{{.Image}}\t{{.Label "${SESSION_LABEL}"}}`
  const out = await docker(runner, ['ps', '-a', '--filter', `label=${SANDBOX_LABEL}=1`, '--format', format])
  return out
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => {
      const [id = '', name = '', status = '', image = '', session = ''] = line.split('\t')
      return { id, name, status, image, session }
    })
}

export interface RecreateOptions {
  /** Remove every container, or only those of this session. */
  readonly session?: string
  readonly force: boolean
  /** Asked before a running container is removed without `force`. */
  readonly confirm: (running: readonly SandboxContainer[]) => Promise<boolean>
}

export interface RecreateResult {
  readonly removed: readonly SandboxContainer[]
  /** True when a running container was left because the person said no. */
  readonly declined: boolean
}

/** Removes the matching containers; the next command of that session starts a fresh one. */
export async function recreateSandboxContainers(runner: DockerRunner, options: RecreateOptions): Promise<RecreateResult> {
  const all = await listSandboxContainers(runner)
  const matching = options.session === undefined ? all : all.filter((container) => container.session === options.session)
  if (matching.length === 0) return { removed: [], declined: false }
  const running = matching.filter((container) => container.status === 'running')
  if (running.length > 0 && !options.force && !(await options.confirm(running))) return { removed: [], declined: true }
  await docker(runner, ['rm', '-f', ...matching.map((container) => container.id)])
  return { removed: matching, declined: false }
}
