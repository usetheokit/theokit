import { spawn } from 'node:child_process'

import { DockerSandbox } from '@theokit/agents/sandbox'
import type { DockerRunner, DockerRunResult, SandboxBackend, SandboxMode } from '@theokit/agents/sandbox'

import { TheoClawConfigError } from '../control-plane/errors.js'
import { MAIN_SESSION_KEY } from './sandbox-mode.js'

/** Every container theoclaw makes carries `theoclaw.sandbox=1` and its session under `theoclaw.session`. */
export const SANDBOX_LABEL = 'theoclaw.sandbox'
export const SESSION_LABEL = 'theoclaw.session'

/** The values `THEOCLAW_SANDBOX_BACKEND` accepts, in the order the refusal names them. */
export const SANDBOX_BACKENDS = ['bwrap', 'docker'] as const
export type SandboxBackendName = (typeof SANDBOX_BACKENDS)[number]

/** `THEOCLAW_SANDBOX_BACKEND`: unset or blank is `bwrap`; anything but `bwrap` or `docker` is refused. */
export function readSandboxBackend(env: Readonly<Record<string, string | undefined>>): SandboxBackendName {
  const value = env.THEOCLAW_SANDBOX_BACKEND?.trim() ?? ''
  if (value === '') return 'bwrap'
  if ((SANDBOX_BACKENDS as readonly string[]).includes(value)) return value as SandboxBackendName
  throw new TheoClawConfigError(`THEOCLAW_SANDBOX_BACKEND must be one of ${SANDBOX_BACKENDS.join(', ')}; got "${value}"`, {
    variable: 'THEOCLAW_SANDBOX_BACKEND',
  })
}

/** The `docker` process, run the way the SDK's own runner runs it. */
export const dockerProcess: DockerRunner = (args, opts) =>
  new Promise<DockerRunResult>((resolve, reject) => {
    const child = spawn('docker', [...args], { stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    let timedOut = false
    const append = (current: string, chunk: Buffer): string => (current.length >= opts.maxOutputBytes ? current : current + chunk.toString('utf8'))
    child.stdout.on('data', (chunk: Buffer) => (stdout = append(stdout, chunk)))
    child.stderr.on('data', (chunk: Buffer) => (stderr = append(stderr, chunk)))
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, opts.timeoutMs)
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ stdout, stderr, code, timedOut })
    })
    child.stdin.on('error', () => undefined)
    child.stdin.end(opts.input)
  })

/**
 * Labels the containers of `session`. The SDK runs each command in a `--rm` container, which would be gone
 * before `sandbox list` could name it, so the runner keeps it (no `--rm`) and, after each command, removes
 * the session's earlier exited containers: one stays per session until `sandbox recreate` removes it.
 */
export function labelDockerRuns(base: DockerRunner, session: string): DockerRunner {
  return async (args, opts) => {
    if (args[0] !== 'run') return base(args, opts)
    const labelled = ['run', '--label', `${SANDBOX_LABEL}=1`, '--label', `${SESSION_LABEL}=${session}`, ...args.slice(1).filter((arg) => arg !== '--rm')]
    const result = await base(labelled, opts)
    const name = args[args.indexOf('--name') + 1]
    try {
      const listed = await base(['ps', '-aq', '--filter', `label=${SESSION_LABEL}=${session}`, '--filter', 'status=exited', '--filter', 'status=created'], {
        timeoutMs: 10_000,
        maxOutputBytes: 1 << 16,
      })
      const stale = listed.stdout.split('\n').filter((id) => id.trim() !== '')
      if (stale.length > 0 && name !== undefined) {
        const keep = await base(['ps', '-aq', '--filter', `name=^${name}$`], { timeoutMs: 10_000, maxOutputBytes: 1 << 16 })
        const kept = new Set(keep.stdout.split('\n').map((id) => id.trim()))
        const drop = stale.filter((id) => !kept.has(id.trim()))
        if (drop.length > 0) await base(['rm', ...drop], { timeoutMs: 30_000, maxOutputBytes: 1 << 16 })
      }
    } catch {
      // Tidying is best effort; the command's own result stands.
    }
    return result
  }
}

/** What a test injects: the `docker` process. */
export interface DockerBackendDeps {
  readonly dockerRunner?: DockerRunner
}

/**
 * A `DockerSandbox` over `workDir` honoring `mode`. `workspace-write` mounts it read-write; `read-only`
 * mounts it read-only (the SDK always writes `:rw`, so the runner turns that into `:ro`). The container
 * has no way to be unconfined, so `danger-full-access` is refused, never downgraded.
 */
export function createDockerBackend(mode: SandboxMode, workDir: string, deps: DockerBackendDeps = {}, session: string = MAIN_SESSION_KEY): SandboxBackend {
  if (mode === 'danger-full-access') {
    throw new TheoClawConfigError(
      'THEOCLAW_SANDBOX_BACKEND=docker cannot honor THEOCLAW_SANDBOX=danger-full-access: a container is always confined; choose workspace-write or read-only, or THEOCLAW_SANDBOX_BACKEND=bwrap',
      { variable: 'THEOCLAW_SANDBOX_BACKEND' },
    )
  }
  const base = labelDockerRuns(deps.dockerRunner ?? dockerProcess, session)
  const runner: DockerRunner =
    mode === 'read-only'
      ? (args, opts) => base(args.map((arg) => (arg.endsWith(':/workspace:rw') ? `${arg.slice(0, -3)}:ro` : arg)), opts)
      : base
  return new DockerSandbox({ workDir, runner })
}
