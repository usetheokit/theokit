import type { DockerRunner } from '@theokit/agents/sandbox'

import { SANDBOX_LABEL, SESSION_LABEL } from './sandbox-backend.js'

const QUICK = { timeoutMs: 15_000, maxOutputBytes: 1024 * 1024 } as const

/** One sandbox container theoclaw made. */
export interface SandboxContainer {
  readonly name: string
  readonly state: string
  readonly image: string
  readonly session: string
}

export interface RecreateOptions {
  readonly all: boolean
  readonly session?: string
  readonly force: boolean
}

/** `recreate [--all | --session <id>] [--force]`; null when the arguments do not fit. */
export function parseRecreate(args: readonly string[]): RecreateOptions | null {
  let all = false
  let force = false
  let session: string | undefined
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--all') all = true
    else if (arg === '--force') force = true
    else if (arg === '--session') {
      session = args[++i]
      if (session === undefined || session === '' || session.startsWith('-')) return null
    } else return null
  }
  if (all === (session !== undefined)) return null
  return { all, force, ...(session === undefined ? {} : { session }) }
}

async function docker(runner: DockerRunner, args: readonly string[]): Promise<string> {
  const result = await runner(args, QUICK)
  if (result.code !== 0) throw new Error(`docker ${args[0] ?? ''} failed: ${result.stderr.trim() || 'no output'}`)
  return result.stdout
}

/** The containers theoclaw made (they carry its label); any other container is not listed. */
export async function listSandboxes(runner: DockerRunner): Promise<SandboxContainer[]> {
  const out = await docker(runner, [
    'ps', '-a', '--filter', `label=${SANDBOX_LABEL}=true`, '--no-trunc',
    '--format', `{{.Names}}\t{{.State}}\t{{.Image}}\t{{.Label "${SESSION_LABEL}"}}`,
  ])
  return out
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => {
      const [name = '', state = '', image = '', session = ''] = line.split('\t')
      return { name, state, image, session }
    })
}

export function formatSandboxes(containers: readonly SandboxContainer[]): string {
  const lines = containers.map((c) => `${c.name}  Status: ${c.state}  Image: ${c.image}  Session: ${c.session}`)
  const running = containers.filter((c) => c.state === 'running').length
  return `${[...lines, `Total: ${containers.length} (${running} running)`].join('\n')}\n`
}

/** The ones `options` names: every one, or those of the session (its id, or a prefix of it). */
export function matching(containers: readonly SandboxContainer[], options: RecreateOptions): SandboxContainer[] {
  const id = options.session
  return containers.filter((c) => options.all || (id !== undefined && (c.session === id || c.session.startsWith(id))))
}

/**
 * Removes the matching containers. A running one is removed only with `--force` or when `confirm`
 * says yes; otherwise it is kept. Returns what was removed and what was kept.
 */
export async function recreateSandboxes(
  runner: DockerRunner,
  options: RecreateOptions,
  confirm: (running: readonly SandboxContainer[]) => Promise<boolean>,
): Promise<{ removed: SandboxContainer[]; kept: SandboxContainer[] }> {
  const found = matching(await listSandboxes(runner), options)
  const running = found.filter((c) => c.state === 'running')
  const approved = options.force || running.length === 0 || (await confirm(running))
  const removed = found.filter((c) => approved || c.state !== 'running')
  const kept = found.filter((c) => !removed.includes(c))
  if (removed.length > 0) await docker(runner, ['rm', '-f', ...removed.map((c) => c.name)])
  return { removed, kept }
}
