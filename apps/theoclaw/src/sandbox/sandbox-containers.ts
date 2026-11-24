import { listSandboxContainers as listLabelled, removeSandboxContainers as removeLabelled, type DockerRunner } from '@theokit/agents/sandbox'

import { SANDBOX_LABEL, SESSION_LABEL } from './sandbox-mode.js'

/** One sandbox container theoclaw made. */
export interface SandboxContainer {
  readonly id: string
  readonly name: string
  readonly status: string
  readonly image: string
  readonly session: string
}

/** The containers carrying theoclaw's label, running or not; containers without it are never returned. */
export async function listSandboxContainers(runner: DockerRunner): Promise<SandboxContainer[]> {
  const found = await listLabelled({ [SANDBOX_LABEL]: '1' }, { runner })
  return found.map(({ id, name, state, image, labels }) => ({ id, name, status: state, image, session: labels[SESSION_LABEL] ?? '' }))
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
  const labels = { [SANDBOX_LABEL]: '1', ...(options.session === undefined ? {} : { [SESSION_LABEL]: options.session }) }
  await removeLabelled(labels, { runner, includeRunning: true })
  return { removed: matching, declined: false }
}
