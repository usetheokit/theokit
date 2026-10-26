import { type ChildProcess, spawn } from 'node:child_process'
import { accessSync, constants, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { connect, createServer } from 'node:net'
import { tmpdir, userInfo } from 'node:os'
import { delimiter, join } from 'node:path'

/**
 * A real SSH local forward the test owns (B-512, plan D2): an `sshd` started as the current user
 * from a temp directory, with a host key, a client key and `authorized_keys` generated per run, and
 * an `ssh -N -L` client that reads only that directory, never `~/.ssh`. Node built-ins only (the
 * vitest hook is `forward-cleanup.ts`); deadlines are `Date.now()` checks or `AbortSignal.timeout`.
 */
export const FORWARD_DEADLINE_MS = 10_000
export const CLOSE_GRACE_MS = 2_000
/** After SIGKILL, how long a child's stdio may take to close; the budget's 500 ms over the grace. */
const KILL_GRACE_MS = 500

export class SshHarnessError extends Error { override readonly name = 'SshHarnessError' }

export type ChildName = 'sshd' | 'ssh'
export interface SpawnRecord { readonly name: ChildName; readonly pid: number; readonly tempDir: string; readonly spawnedAt: number }
export interface OutputOrigin { readonly source: ChildName; readonly pid: number; readonly stream: 'stdout' | 'stderr' }
export interface ForwardOptions {
  readonly targetPort: number
  readonly binDir?: string
  readonly onSpawn?: (record: SpawnRecord) => void
  readonly onOutput?: (origin: OutputOrigin, chunk: string) => void
}
export interface SshForward {
  readonly localPort: number
  readonly sshdPort: number
  readonly tempDir: string
  /** SIGTERM to both children at once, SIGKILL after CLOSE_GRACE_MS, then the temp dir is removed. Idempotent. */
  close(): Promise<void>
  sshdLog(): string
  sshStderr(): string
  spawnedArgs(): { readonly sshd: readonly string[]; readonly ssh: readonly string[] }
}

interface Tracked { readonly name: ChildName; readonly child: ChildProcess; readonly closed: Promise<void>; output: string; done: boolean }

const tracked = new Map<ChildProcess, Tracked>()
const openForwards = new Set<SshForward>()
let exitHandlerInstalled = false

/** The absolute path of an executable `name` in `binDir`, or else in each `PATH` entry. */
export function findBinary(name: string, binDir?: string): string {
  const dirs = binDir === undefined ? (process.env.PATH ?? '').split(delimiter).filter((d) => d !== '') : [binDir]
  for (const dir of dirs) {
    const candidate = join(dir, name)
    try {
      accessSync(candidate, constants.X_OK)
      return candidate
    } catch {
      // Not here (or not executable): the next directory is searched, and the miss is reported below.
    }
  }
  throw new SshHarnessError(`ssh harness: binary not found: ${name} (searched: ${dirs.join(delimiter)})`)
}

function exitDescription(child: ChildProcess): string {
  return child.signalCode === null ? `exit code ${child.exitCode}` : `signal ${child.signalCode}`
}

function tail(text: string, lines = 5): string {
  return text.trim().split('\n').slice(-lines).join(' | ')
}

/** Resolves when `child` has exited (at once when it already has). */
function exited(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve()
  // A failed spawn emits `error` and `close` but never `exit` (measured on Node 22).
  return new Promise((resolve) => (child.once('exit', () => resolve()), child.once('error', () => resolve())))
}

function attempt(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host: '127.0.0.1', port })
    const settle = (connected: boolean) => (): void => {
      socket.destroy()
      resolve(connected)
    }
    socket.once('connect', settle(true))
    socket.once('error', settle(false))
  })
}

/**
 * Connect to `127.0.0.1:port`, one awaited attempt after another, until one connects or
 * `deadlineMs` passes. With `child`, it rejects as soon as that child exits, naming its exit code
 * and the tail of its output (EC-2), rather than after the deadline.
 */
export async function waitForForward(port: number, deadlineMs = FORWARD_DEADLINE_MS, child?: ChildProcess): Promise<void> {
  const deadline = Date.now() + deadlineMs
  const exit = child === undefined ? undefined : exited(child).then(() => 'exited' as const)
  for (;;) {
    const outcome = await (exit === undefined ? attempt(port) : Promise.race([attempt(port), exit]))
    if (outcome === true) return
    if (outcome === 'exited' && child !== undefined) {
      const entry = tracked.get(child)
      throw new SshHarnessError(`ssh harness: ${entry?.name ?? 'child'} exited during setup with ${exitDescription(child)}: ${tail(entry?.output ?? '')}`)
    }
    if (Date.now() >= deadline) {
      throw new SshHarnessError(`ssh harness: nothing accepted a connection on 127.0.0.1:${port} within ${deadlineMs} ms`)
    }
  }
}

async function freePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  await new Promise<void>((resolve) => server.close(() => resolve()))
  if (address === null || typeof address === 'string') throw new SshHarnessError('ssh harness: no free loopback port')
  return address.port
}

function installExitHandler(): void {
  if (exitHandlerInstalled) return
  exitHandlerInstalled = true
  // Last resort only: a run that ends with a child alive must not leave an sshd behind.
  process.once('exit', () => [...tracked.values()].forEach(({ child }) => child.kill('SIGKILL')))
}

function spawnTracked(name: ChildName, bin: string, args: readonly string[], tempDir: string, options: ForwardOptions): Tracked {
  const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] })
  const entry: Tracked = {
    name,
    child,
    output: '',
    done: false,
    closed: new Promise((resolve) =>
      child.once('close', () => {
        entry.done = true
        tracked.delete(child)
        resolve()
      }),
    ),
  }
  tracked.set(child, entry)
  installExitHandler()
  // A spawn failure (ENOENT, EACCES) is recorded in the output; `exited()` resolves on it.
  child.on('error', (error) => (entry.output += `spawn error: ${error.message}\n`))
  for (const stream of ['stdout', 'stderr'] as const) {
    const pipe = child[stream]
    pipe?.setEncoding('utf8')
    pipe?.on('data', (chunk: string) => {
      entry.output += chunk
      options.onOutput?.({ source: name, pid: child.pid ?? -1, stream }, chunk)
    })
  }
  options.onSpawn?.({ name, pid: child.pid ?? -1, tempDir, spawnedAt: Date.now() })
  return entry
}

/** Resolves `late` once `ms` have passed, through an abort signal rather than a timer callback. */
function elapsed(ms: number): Promise<'late'> {
  return new Promise((resolve) => AbortSignal.timeout(ms).addEventListener('abort', () => resolve('late'), { once: true }))
}

/** SIGTERM to every child at once; SIGKILL to any not closed after CLOSE_GRACE_MS. */
async function stopChildren(children: readonly Tracked[]): Promise<void> {
  const alive = children.filter(({ child }) => child.exitCode === null && child.signalCode === null)
  for (const { child } of alive) child.kill('SIGTERM')
  await Promise.race([Promise.all(children.map((entry) => entry.closed)), elapsed(CLOSE_GRACE_MS)])
  const stuck = children.filter((entry) => !entry.done)
  if (stuck.length === 0) return
  for (const { child } of stuck) child.kill('SIGKILL')
  const outcome = await Promise.race([Promise.all(stuck.map((entry) => entry.closed)), elapsed(KILL_GRACE_MS)])
  if (outcome === 'late') {
    const names = stuck.map(({ name, child }) => `${name} (pid ${child.pid})`).join(', ')
    throw new SshHarnessError(`ssh harness: ${names} did not close within ${CLOSE_GRACE_MS + KILL_GRACE_MS} ms of SIGTERM`)
  }
}

async function keygen(bin: string, path: string, remainingMs: number): Promise<void> {
  const child = spawn(bin, ['-q', '-t', 'ed25519', '-N', '', '-C', 'theoclaw-ssh-harness', '-f', path], {
    stdio: ['ignore', 'ignore', 'pipe'],
    signal: AbortSignal.timeout(remainingMs),
  })
  let stderr = ''
  child.stderr?.setEncoding('utf8')
  child.stderr?.on('data', (chunk: string) => (stderr += chunk))
  const failure = await new Promise<Error | undefined>((resolve) => {
    const late = `did not finish within the ${FORWARD_DEADLINE_MS} ms setup deadline`
    child.once('error', (error) => resolve(new SshHarnessError(`ssh harness: ssh-keygen ${error.name === 'AbortError' ? late : `failed: ${error.message}`}`)))
    child.once('close', (code) =>
      resolve(code === 0 ? undefined : new SshHarnessError(`ssh harness: ssh-keygen exited with code ${code}: ${tail(stderr)}`)),
    )
  })
  if (failure !== undefined) throw failure
}

function sshdConfig(dir: string, port: number): string {
  const lines = [`Port ${port}`, 'ListenAddress 127.0.0.1', `HostKey ${join(dir, 'host')}`]
  lines.push(`AuthorizedKeysFile ${join(dir, 'authorized_keys')}`, `PidFile ${join(dir, 'sshd.pid')}`)
  lines.push('UsePAM no', 'StrictModes no', 'PasswordAuthentication no', 'AllowTcpForwarding local', '')
  return lines.join('\n')
}

/** The time left before `step`, refused once the setup deadline has passed (read once, so it never goes negative). */
function budget(remaining: () => number, step: string): number {
  const ms = remaining()
  if (ms <= 0) throw new SshHarnessError(`ssh harness: setup deadline of ${FORWARD_DEADLINE_MS} ms passed before ${step}`)
  return ms
}

/** Stop `children`; a stop that fails too is reported beside `error`, never instead of it. */
async function stopKeepingError(children: readonly Tracked[], error: unknown): Promise<void> {
  try {
    await stopChildren(children)
  } catch (stopError) {
    throw new SshHarnessError(`${String(error)}; the rollback failed too: ${String(stopError)}`, { cause: error })
  }
}

/** Start `sshd` on a free port, retried once on a port another process took between probe and bind. */
async function startSshd(bin: string, dir: string, remaining: () => number, options: ForwardOptions): Promise<{ entry: Tracked; port: number; args: string[] }> {
  const hostKey = readFileSync(join(dir, 'host.pub'), 'utf8').split(' ').slice(0, 2).join(' ')
  for (let tries = 0; ; tries += 1) {
    const port = await freePort()
    writeFileSync(join(dir, 'sshd_config'), sshdConfig(dir, port))
    writeFileSync(join(dir, 'known_hosts'), `[127.0.0.1]:${port} ${hostKey}\n`)
    const args = ['-D', '-e', '-f', join(dir, 'sshd_config')]
    const waitMs = budget(remaining, 'the sshd wait')
    const entry = spawnTracked('sshd', bin, args, dir, options)
    try {
      await waitForForward(port, waitMs, entry.child)
      return { entry, port, args }
    } catch (error) {
      await stopKeepingError([entry], error)
      if (tries === 0 && entry.output.includes('Address already in use')) continue
      throw error
    }
  }
}

/**
 * Open `ssh -N -L <local>:127.0.0.1:<targetPort>` through an `sshd` of the run's own. Key
 * generation, the `sshd` wait and the forward wait share one FORWARD_DEADLINE_MS deadline. On any
 * failure every child spawned is stopped and the temp dir removed before the error is rethrown.
 */
export async function openSshForward(options: ForwardOptions): Promise<SshForward> {
  const bins = { sshd: findBinary('sshd', options.binDir), ssh: findBinary('ssh', options.binDir), keygen: findBinary('ssh-keygen', options.binDir) }
  const deadline = Date.now() + FORWARD_DEADLINE_MS
  const remaining = (): number => deadline - Date.now()
  const dir = mkdtempSync(join(tmpdir(), 'theoclaw-ssh-'))
  const children: Tracked[] = []
  try {
    await keygen(bins.keygen, join(dir, 'host'), budget(remaining, 'ssh-keygen'))
    await keygen(bins.keygen, join(dir, 'client'), budget(remaining, 'ssh-keygen'))
    writeFileSync(join(dir, 'authorized_keys'), readFileSync(join(dir, 'client.pub')))
    const sshd = await startSshd(bins.sshd, dir, remaining, options)
    children.push(sshd.entry)
    const localPort = await freePort()
    const sshArgs = [
      '-F', '/dev/null', '-i', join(dir, 'client'),
      '-o', 'IdentitiesOnly=yes', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes',
      '-o', 'GlobalKnownHostsFile=/dev/null', '-o', `UserKnownHostsFile=${join(dir, 'known_hosts')}`,
      '-o', 'ExitOnForwardFailure=yes', '-p', String(sshd.port),
      '-N', '-L', `${localPort}:127.0.0.1:${options.targetPort}`, `${userInfo().username}@127.0.0.1`,
    ]
    const waitMs = budget(remaining, 'the forward wait')
    const ssh = spawnTracked('ssh', bins.ssh, sshArgs, dir, options)
    children.push(ssh)
    try {
      await waitForForward(localPort, waitMs, ssh.child)
    } catch (error) {
      if (!(error instanceof SshHarnessError) || ssh.child.exitCode !== null) throw error
      throw new SshHarnessError(`${error.message}; last sshd log line: ${tail(sshd.entry.output, 1)}`)
    }
    let closing: Promise<void> | undefined
    const forward: SshForward = {
      localPort,
      sshdPort: sshd.port,
      tempDir: dir,
      close: () =>
        (closing ??= stopChildren(children).finally(() => {
          openForwards.delete(forward)
          rmSync(dir, { recursive: true, force: true })
        })),
      sshdLog: () => sshd.entry.output,
      sshStderr: () => ssh.output,
      spawnedArgs: () => ({ sshd: sshd.args, ssh: sshArgs }),
    }
    openForwards.add(forward)
    return forward
  } catch (error) {
    await stopKeepingError(children, error).finally(() => rmSync(dir, { recursive: true, force: true }))
    throw error
  }
}

/** Close every forward still open; the `afterEach` of `useForwardCleanup()` calls it (EC-1). */
export async function closeOpenForwards(): Promise<void> {
  await Promise.all([...openForwards].map((forward) => forward.close()))
}
