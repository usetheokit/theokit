import { spawn } from 'node:child_process'

import { DockerSandbox } from '@theokit/agents/sandbox'
import type { DockerRunner, DockerRunResult, SandboxBackend, SandboxMode } from '@theokit/agents/sandbox'

import { TheoClawConfigError } from '../control-plane/errors.js'

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

/** The label every container theoclaw makes carries, and the one holding its session key. */
export const SANDBOX_LABEL = 'theoclaw.sandbox'
export const SESSION_LABEL = 'theoclaw.session'

/** What a test injects: the `docker` process. */
export interface DockerBackendDeps {
  readonly dockerRunner?: DockerRunner
}

const QUICK = { timeoutMs: 10_000, maxOutputBytes: 64 * 1024 } as const

/**
 * Makes the SDK's throwaway container something `sandbox list` can find. The SDK runs each command
 * with `docker run --rm`, so nothing is left to list; this runner labels the container, keeps it
 * after it exits, and removes the session's earlier finished ones, so one container per session stays
 * until `sandbox recreate` removes it. `session` is the key of the session the backend was built for:
 * the chat sessions share the default session's backend (`main`), and only a session whose sandbox
 * mode differs (`THEOCLAW_SANDBOX_SESSIONS`) builds its own, so `--session` matches those keys only.
 */
function keepLabelled(base: DockerRunner, session: string): DockerRunner {
  return async (args, opts) => {
    const at = args.indexOf('--name')
    // Not a command's `docker run` with a name: leave it alone.
    if (args[0] !== 'run' || at < 0 || args[at + 1] === undefined) return base(args, opts)
    const name = args[at + 1]
    const rest = args.slice(1).filter((arg) => arg !== '--rm')
    const result = await base(['run', '--label', `${SANDBOX_LABEL}=true`, '--label', `${SESSION_LABEL}=${session}`, ...rest], opts)
    await pruneFinished(base, session, name).catch(() => undefined)
    return result
  }
}

async function pruneFinished(base: DockerRunner, session: string, keep: string | undefined): Promise<void> {
  const listed = await base(
    ['ps', '-a', '--filter', `label=${SANDBOX_LABEL}=true`, '--filter', `label=${SESSION_LABEL}=${session}`, '--filter', 'status=exited', '--format', '{{.Names}}'],
    QUICK,
  )
  const old = listed.stdout.split('\n').map((line) => line.trim()).filter((line) => line !== '' && line !== keep)
  if (old.length > 0) await base(['rm', '-f', ...old], QUICK)
}

/**
 * A `DockerSandbox` over `workDir` honoring `mode`. `workspace-write` mounts it read-write; `read-only`
 * mounts it read-only (the SDK always writes `:rw`, so the runner turns that into `:ro`). The container
 * has no way to be unconfined, so `danger-full-access` is refused, never downgraded.
 */
export function createDockerBackend(mode: SandboxMode, workDir: string, deps: DockerBackendDeps = {}, session = 'main'): SandboxBackend {
  if (mode === 'danger-full-access') {
    throw new TheoClawConfigError(
      'THEOCLAW_SANDBOX_BACKEND=docker cannot honor THEOCLAW_SANDBOX=danger-full-access: a container is always confined; choose workspace-write or read-only, or THEOCLAW_SANDBOX_BACKEND=bwrap',
      { variable: 'THEOCLAW_SANDBOX_BACKEND' },
    )
  }
  const base = deps.dockerRunner ?? dockerProcess
  const mounted: DockerRunner =
    mode === 'read-only'
      ? (args, opts) => base(args.map((arg) => (arg.endsWith(':/workspace:rw') ? `${arg.slice(0, -3)}:ro` : arg)), opts)
      : base
  const runner = keepLabelled(mounted, session)
  return new DockerSandbox({ workDir, runner })
}
